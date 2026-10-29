import { notificationsApi } from '../api/notifications.api.js';
import { secureStorage } from '../utils/cache.js';

export const usePushNotifications = () => {
  const registerToken = async (fcmToken, platform = 'ANDROID', deviceId = 'device-default') => {
    try {
      secureStorage.set('fcm_token', fcmToken);
      secureStorage.set('device_id', deviceId);
      const res = await notificationsApi.registerDeviceToken({
        fcm_token: fcmToken,
        token: fcmToken,
        platform,
        device_type: platform,
        device_id: deviceId
      });
      return res.data;
    } catch (err) {
      console.warn('[Push] Registration error:', err.message);
      return null;
    }
  };

  const unregisterToken = async (deviceId = 'device-default') => {
    try {
      const targetDeviceId = deviceId || secureStorage.getString('device_id') || 'device-default';
      await notificationsApi.unregisterDeviceToken(targetDeviceId);
      secureStorage.delete('fcm_token');
      secureStorage.delete('device_id');
    } catch (err) {
      console.warn('[Push] Unregister error:', err.message);
    }
  };

  return {
    registerToken,
    unregisterToken
  };
};

export default usePushNotifications;
