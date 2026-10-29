import apiClient from './axios.config.js';

export const githubApi = {
  getMemberActivity: (userId) => apiClient.get(`/api/github/member/${userId}`)
};

export default githubApi;
