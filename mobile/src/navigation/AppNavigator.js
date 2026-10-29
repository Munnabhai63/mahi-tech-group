import React from 'react';
import { NavigationContainer } from './navigationFactory.js';
import { AuthNavigator } from './AuthNavigator.js';
import { MainNavigator } from './MainNavigator.js';
import { linkingConfig } from './deepLinking.js';

export const AppNavigator = ({ isAuthenticated = false }) => {
  return React.createElement(
    NavigationContainer,
    { linking: linkingConfig },
    isAuthenticated
      ? React.createElement(MainNavigator, null)
      : React.createElement(AuthNavigator, null)
  );
};

export default AppNavigator;
