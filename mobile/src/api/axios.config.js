// Axios HTTP Client Configuration (Zero Hardcoded URLs, Encrypted Token Storage)
import axios from 'axios';
import { config } from '../constants/config.js';
import { secureStorage } from '../utils/cache.js';

export const apiClient = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: config.API_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

// Request Interceptor: Attach JWT Token from Encrypted MMKV
apiClient.interceptors.request.use(
  (requestConfig) => {
    const token = secureStorage.getString('auth_token');
    if (token && !requestConfig.headers.Authorization) {
      requestConfig.headers.Authorization = `Bearer ${token}`;
    }
    return requestConfig;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: 401 Interceptor and Token Refresh Handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = secureStorage.getString('refresh_token');
        if (refreshToken) {
          const res = await axios.post(`${config.API_BASE_URL}/api/auth/refresh`, {
            token: refreshToken
          });
          if (res.data?.token) {
            secureStorage.set('auth_token', res.data.token);
            originalRequest.headers.Authorization = `Bearer ${res.data.token}`;
            return apiClient(originalRequest);
          }
        }
      } catch {
        // Clear invalid tokens on hard refresh failure
        secureStorage.delete('auth_token');
        secureStorage.delete('refresh_token');
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
