// Deep Linking Configuration & Resolver for Mahi Tech Group Mobile App
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
          NotificationDetail: 'notifications/:notificationId',
          TaskDetail: 'task/:taskId',
          SprintBoard: 'sprint/:sprintId',
          PageReader: 'wiki/page/:pageId',
          ObjectiveDetail: 'okr/:objectiveId',
          MyExpenses: 'expenses/:expenseId',
          MyWork: 'my-work',
          Profile: 'profile',
          Settings: 'settings',
          AdminQuickActions: 'admin'
        }
      }
    }
  }
};

/**
 * Resolves an incoming FCM notification URL or deep-link string into screen and params
 * e.g. "mahitech://task/t-101" -> { screen: 'TaskDetail', params: { taskId: 't-101' } }
 * e.g. "mahitech://wiki/page/wp-55" -> { screen: 'PageReader', params: { pageId: 'wp-55' } }
 */
export const resolveDeepLink = (url) => {
  if (!url || typeof url !== 'string') return null;

  const cleanUrl = url.replace(/^mahitech:\/\//, '').replace(/^https?:\/\/[^/]+\//, '');
  const parts = cleanUrl.split('/').filter(Boolean);

  if (parts.length === 0) return { screen: 'Home', params: {} };

  const [segment1, segment2, segment3] = parts;

  if (segment1 === 'task' && segment2) {
    return { screen: 'TaskDetail', params: { taskId: segment2 } };
  }
  if (segment1 === 'sprint' && segment2) {
    return { screen: 'SprintBoard', params: { sprintId: segment2 } };
  }
  if (segment1 === 'wiki' && segment2 === 'page' && segment3) {
    return { screen: 'PageReader', params: { pageId: segment3 } };
  }
  if (segment1 === 'okr' && segment2) {
    return { screen: 'ObjectiveDetail', params: { objectiveId: segment2 } };
  }
  if (segment1 === 'expenses' && segment2) {
    return { screen: 'MyExpenses', params: { expenseId: segment2 } };
  }
  if (segment1 === 'notifications') {
    return segment2
      ? { screen: 'NotificationDetail', params: { notificationId: segment2 } }
      : { screen: 'NotificationCenter', params: {} };
  }
  if (segment1 === 'admin') {
    return { screen: 'AdminQuickActions', params: {} };
  }
  if (segment1 === 'profile') {
    return { screen: 'Profile', params: {} };
  }
  if (segment1 === 'settings') {
    return { screen: 'Settings', params: {} };
  }

  return { screen: segment1.charAt(0).toUpperCase() + segment1.slice(1), params: {} };
};

export default {
  linkingConfig,
  resolveDeepLink
};
