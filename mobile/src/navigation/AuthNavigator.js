import React from 'react';
import { createStackNavigator } from './navigationFactory.js';
import { SplashScreen } from '../screens/SplashScreen.js';
import { LoginScreen } from '../screens/LoginScreen.js';
import { BiometricSetupScreen } from '../screens/BiometricSetupScreen.js';
import { DARK_BACKGROUND } from '../theme/theme.js';

const Stack = createStackNavigator();

export const AuthNavigator = () => {
  return React.createElement(
    Stack.Navigator,
    {
      initialRouteName: 'Splash',
      screenOptions: {
        headerShown: false,
        cardStyle: { backgroundColor: DARK_BACKGROUND }
      }
    },
    React.createElement(Stack.Screen, { name: 'Splash', component: SplashScreen }),
    React.createElement(Stack.Screen, { name: 'Login', component: LoginScreen }),
    React.createElement(Stack.Screen, { name: 'BiometricSetup', component: BiometricSetupScreen })
  );
};

export default AuthNavigator;
