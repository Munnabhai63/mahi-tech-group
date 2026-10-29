import apiClient from './axios.config.js';

export const okrApi = {
  getDashboard: () => apiClient.get('/api/okr/dashboard'),
  getObjective: (objectiveId) => apiClient.get(`/api/okr/objective/${objectiveId}`),
  submitCheckin: (data) => apiClient.post('/api/okr/checkin/submit', data)
};

export default okrApi;
