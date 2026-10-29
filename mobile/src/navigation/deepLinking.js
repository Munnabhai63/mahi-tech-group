// Deep Linking Configuration for Mahi Tech Group Mobile App
export const linkingConfig = {
  prefixes: ['mahitech://', 'https://app.mahitechgroup.com'],
  config: {
    screens: {
      Auth: {
        screens: {
          Splash: 'splash',
          Login: 'login',
          BiometricSetup: 'biometric-setup'
        }
      },
      Main: {
        screens: {
          Home: 'home',
          Projects: 'projects',
          Notifications: 'notifications',
          MyWork: 'my-work',
          Profile: 'profile'
        }
      }
    }
  }
};

export default linkingConfig;
