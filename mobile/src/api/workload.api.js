import apiClient from './axios.config.js';

export const workloadApi = {
  getMemberWorkload: (userId) => apiClient.get(`/api/workload/dashboard/member/${userId}`)
};

export default workloadApi;
