import apiClient from './axios.config.js';

export const notificationsApi = {
  getNotifications: () => apiClient.get('/api/notifications'),
  markRead: (id) => apiClient.patch('/api/notifications/mark-read', { id }),
  registerDeviceToken: (data) => apiClient.post('/api/mobile/device-token', data),
  unregisterDeviceToken: (deviceId) => apiClient.delete('/api/mobile/device-token', { data: { device_id: deviceId } })
};

export default notificationsApi;
