import { secureStorage } from '../utils/cache.js';
import { authApi } from '../api/auth.api.js';

export const useAuth = () => {
  const getToken = () => secureStorage.getString('auth_token');
  const getUser = () => secureStorage.getObject('user_data');

  const login = async (email, password) => {
    const res = await authApi.login(email, password);
    if (res.data?.token) {
      secureStorage.set('auth_token', res.data.token);
      if (res.data.refreshToken) {
        secureStorage.set('refresh_token', res.data.refreshToken);
      }
      if (res.data.user) {
        // Enforce Security Rule: never store password hash or token details in user object
        const sanitizedUser = { ...res.data.user };
        delete sanitizedUser.password_hash;
        delete sanitizedUser.password;
        delete sanitizedUser.tokens;
        secureStorage.setObject('user_data', sanitizedUser);
      }
    }
    return res.data;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort remote logout
    }
    secureStorage.delete('auth_token');
    secureStorage.delete('refresh_token');
    secureStorage.delete('user_data');
  };

  return {
    getToken,
    getUser,
    login,
    logout
  };
};

export default useAuth;
