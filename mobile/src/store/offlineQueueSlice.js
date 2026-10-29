import { createSlice } from './reduxFactory.js';

export const offlineQueueSlice = createSlice({
  name: 'offlineQueue',
  initialState: {
    queue: [],
    isSyncing: false,
    lastSyncTimestamp: null
  },
  reducers: {
    enqueueAction: (state, action) => {
      state.queue.push(action.payload);
    },
    dequeueAction: (state, action) => {
      state.queue = state.queue.filter((item) => item.id !== action.payload);
    },
    setSyncing: (state, action) => {
      state.isSyncing = Boolean(action.payload);
      if (!action.payload) {
        state.lastSyncTimestamp = new Date().toISOString();
      }
    },
    clearQueue: (state) => {
      state.queue = [];
      state.isSyncing = false;
    }
  }
});

export const { enqueueAction, dequeueAction, setSyncing, clearQueue } = offlineQueueSlice.actions;
export default offlineQueueSlice.reducer;
