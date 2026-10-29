import apiClient from './axios.config.js';

export const notificationsApi = {
  getNotifications: (params) => apiClient.get('/api/notifications', { params }),
  markRead: (id) => apiClient.patch(`/api/notifications/${id}/read`),
  markAllRead: () => apiClient.post('/api/notifications/mark-all-read'),
  registerDeviceToken: (data) => apiClient.post('/api/mobile/device-token', data),
  unregisterDeviceToken: (deviceId) => apiClient.delete('/api/mobile/device-token', { data: { device_id: deviceId } })
};

export default notificationsApi;
