import React from 'react';
const { useState, useEffect, useRef, useCallback } = React;
import { secureStorage } from '../utils/cache.js';
import { timeApi } from '../api/time.api.js';
import { enqueueOfflineAction, ActionTypes } from '../utils/offlineQueue.js';
import * as Haptics from 'expo-haptics';

export const TIMER_STORAGE_KEY = 'active_timer_state';

export const getStoredTimerState = () => {
  return secureStorage.getObject(TIMER_STORAGE_KEY) || {
    isRunning: false,
    startTimestamp: null,
    accumulatedSeconds: 0,
    taskId: null,
    taskTitle: null,
    projectId: null,
    description: ''
  };
};

export const saveStoredTimerState = (state) => {
  secureStorage.setObject(TIMER_STORAGE_KEY, state);
};

export const useTimer = ({ isOnline = true } = {}) => {
  const initial = getStoredTimerState();

  const calculateElapsed = (state) => {
    if (!state.isRunning || !state.startTimestamp) {
      return state.accumulatedSeconds || 0;
    }
    const deltaSeconds = Math.max(0, Math.floor((Date.now() - state.startTimestamp) / 1000));
    return (state.accumulatedSeconds || 0) + deltaSeconds;
  };

  const [isRunning, setIsRunning] = useState(initial.isRunning);
  const [activeTask, setActiveTask] = useState(initial.taskTitle);
  const [elapsedSeconds, setElapsedSeconds] = useState(() => calculateElapsed(initial));

  const timerStateRef = useRef(initial);

  // Recalculate timestamp on foreground resume or tick without drift
  const syncElapsedFromTimestamp = useCallback(() => {
    const current = timerStateRef.current;
    if (current.isRunning && current.startTimestamp) {
      const exactElapsed = calculateElapsed(current);
      setElapsedSeconds(exactElapsed);
      return exactElapsed;
    }
    return current.accumulatedSeconds || 0;
  }, []);

  useEffect(() => {
    let intervalId = null;
    if (isRunning) {
      // Immediate recalculation
      syncElapsedFromTimestamp();
      intervalId = setInterval(() => {
        syncElapsedFromTimestamp();
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRunning, syncElapsedFromTimestamp]);

  const start = async ({ projectId, taskId, taskTitle, description }) => {
    const now = Date.now();
    const newState = {
      isRunning: true,
      startTimestamp: now,
      accumulatedSeconds: timerStateRef.current.accumulatedSeconds || 0,
      taskId: taskId || null,
      taskTitle: taskTitle || 'Task #' + (taskId || 'Active'),
      projectId: projectId || null,
      description: description || ''
    };

    timerStateRef.current = newState;
    saveStoredTimerState(newState);
    setIsRunning(true);
    setActiveTask(newState.taskTitle);
    setElapsedSeconds(newState.accumulatedSeconds);

    // Haptic feedback
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Dispatch to server or offline queue
    if (isOnline) {
      try {
        await timeApi.startTimer({
          project_id: projectId,
          task_id: taskId,
          description: description || ''
        });
      } catch (err) {
        // If network failed, fall back to offline queue
        enqueueOfflineAction({
          type: ActionTypes.TIMER_START,
          payload: { projectId, taskId, description }
        });
      }
    } else {
      enqueueOfflineAction({
        type: ActionTypes.TIMER_START,
        payload: { projectId, taskId, description }
      });
    }

    return newState;
  };

  const stop = async () => {
    const finalElapsed = syncElapsedFromTimestamp();
    const stoppedState = {
      isRunning: false,
      startTimestamp: null,
      accumulatedSeconds: 0,
      taskId: null,
      taskTitle: null,
      projectId: null,
      description: ''
    };

    const previousTask = timerStateRef.current;
    timerStateRef.current = stoppedState;
    saveStoredTimerState(stoppedState);
    setIsRunning(false);
    setActiveTask(null);
    setElapsedSeconds(0);

    // Haptic feedback
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}

    if (isOnline) {
      try {
        await timeApi.stopTimer();
      } catch (err) {
        enqueueOfflineAction({
          type: ActionTypes.TIMER_STOP,
          payload: { taskId: previousTask.taskId, finalElapsed }
        });
      }
    } else {
      enqueueOfflineAction({
        type: ActionTypes.TIMER_STOP,
        payload: { taskId: previousTask.taskId, finalElapsed }
      });
    }

    return { elapsedSeconds: finalElapsed };
  };

  return {
    isRunning,
    activeTask,
    elapsedSeconds,
    start,
    stop,
    syncElapsedFromTimestamp,
    getStoredTimerState
  };
};

export default useTimer;
