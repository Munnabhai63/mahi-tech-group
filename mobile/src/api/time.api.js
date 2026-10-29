import apiClient from './axios.config.js';

export const timeApi = {
  startTimer: (data) => apiClient.post('/api/time/timer/start', data),
  stopTimer: () => apiClient.post('/api/time/timer/stop'),
  getTimerStatus: () => apiClient.get('/api/time/timer/status'),
  createEntry: (data) => apiClient.post('/api/time/entry/create', data),
  getMyEntries: () => apiClient.get('/api/time/entries/my'),
  getMyReport: () => apiClient.get('/api/time/report/my')
};

export default timeApi;
