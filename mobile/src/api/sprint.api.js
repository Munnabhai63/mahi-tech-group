import apiClient from './axios.config.js';

export const sprintApi = {
  getProjectSprints: (projectId) => apiClient.get(`/api/sprint/project/${projectId}`),
  startSprint: (sprintId) => apiClient.patch(`/api/sprint/${sprintId}/start`),
  completeSprint: (sprintId) => apiClient.patch(`/api/sprint/${sprintId}/complete`)
};

export default sprintApi;
