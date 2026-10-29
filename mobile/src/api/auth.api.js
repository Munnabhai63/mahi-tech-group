import apiClient from './axios.config.js';

export const authApi = {
  login: (email, password) => apiClient.post('/api/auth/login', { email, password }),
  getMe: () => apiClient.get('/api/users/me'),
  logout: () => apiClient.post('/api/auth/logout'),
  refreshToken: (token) => apiClient.post('/api/auth/refresh', { token })
};

export default authApi;
