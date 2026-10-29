import * as LocalAuthentication from 'expo-local-authentication';

export const checkBiometricHardware = async () => {
  if (!LocalAuthentication) {
    return { hasHardware: false, isEnrolled: false, supportedTypes: [] };
  }
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return { hasHardware, isEnrolled, supportedTypes };
};

export const authenticateBiometric = async (promptMessage = 'Authenticate to access Mahi Tech Group') => {
  if (!LocalAuthentication) {
    return { success: false, error: 'BIOMETRIC_UNAVAILABLE' };
  }
  const { hasHardware, isEnrolled } = await checkBiometricHardware();
  if (!hasHardware) {
    return { success: false, error: 'NO_HARDWARE' };
  }
  if (!isEnrolled) {
    return { success: false, error: 'NOT_ENROLLED' };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    fallbackLabel: 'Use Passcode',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false
  });

  return result;
};

export const useBiometric = () => {
  return {
    checkHardware: checkBiometricHardware,
    authenticate: authenticateBiometric
  };
};

export default useBiometric;
