import apiClient from './axios.config.js';

export const backlogApi = {
  getProjectBacklog: (projectId) => apiClient.get(`/api/backlog/project/${projectId}`),
  createItem: (data) => apiClient.post('/api/backlog/item/create', data),
  updateItemStatus: (itemId, status) => apiClient.patch(`/api/backlog/item/${itemId}/status`, { status })
};

export default backlogApi;
