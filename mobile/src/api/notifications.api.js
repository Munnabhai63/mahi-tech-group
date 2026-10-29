import apiClient from './axios.config.js';

export const notificationsApi = {
  getNotifications: () => apiClient.get('/api/notifications'),
  markRead: (id) => apiClient.patch('/api/notifications/mark-read', { id }),
  registerDeviceToken: (data) => apiClient.post('/api/device/token/register', data),
  unregisterDeviceToken: (deviceId) => apiClient.delete('/api/device/token/unregister', { data: { device_id: deviceId } })
};

export default notificationsApi;
