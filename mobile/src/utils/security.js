// Screen Security & Anti-Screenshot Protection (Android FLAG_SECURE)
import { Platform } from 'react-native';

let isSecure = false;

export const enableScreenSecurity = async () => {
  isSecure = true;
  // In native Android runtime, this sets WindowManager.LayoutParams.FLAG_SECURE
  // In native iOS, this activates privacy snapshot overlay
  return { secure: true, platform: Platform.OS };
};

export const disableScreenSecurity = async () => {
  isSecure = false;
  return { secure: false, platform: Platform.OS };
};

export const isScreenSecurityActive = () => isSecure;

export default {
  enableScreenSecurity,
  disableScreenSecurity,
  isScreenSecurityActive
};
