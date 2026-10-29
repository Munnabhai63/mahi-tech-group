import { useState } from 'react';
import { timeApi } from '../api/time.api.js';

export const useTimer = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [activeTimer, setActiveTimer] = useState(null);

  const start = async (projectId, taskId, description) => {
    const res = await timeApi.startTimer({ project_id: projectId, task_id: taskId, description });
    setIsRunning(true);
    setActiveTimer(res.data);
    return res.data;
  };

  const stop = async () => {
    const res = await timeApi.stopTimer();
    setIsRunning(false);
    setActiveTimer(null);
    return res.data;
  };

  return {
    isRunning,
    activeTimer,
    start,
    stop
  };
};

export default useTimer;
