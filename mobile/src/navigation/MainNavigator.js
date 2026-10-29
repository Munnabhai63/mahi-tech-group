import React from 'react';
import { createBottomTabNavigator } from './navigationFactory.js';
import { HomeScreen } from '../screens/HomeScreen.js';
import { ProjectsScreen } from '../screens/ProjectsScreen.js';
import { NotificationsScreen } from '../screens/NotificationsScreen.js';
import { MyWorkScreen } from '../screens/MyWorkScreen.js';
import { ProfileScreen } from '../screens/ProfileScreen.js';
import { DARK_BACKGROUND, DARK_ACCENT } from '../theme/theme.js';

const Tab = createBottomTabNavigator();

export const MainNavigator = () => {
  return React.createElement(
    Tab.Navigator,
    {
      initialRouteName: 'Home',
      screenOptions: {
        headerShown: false,
        tabBarStyle: {
          backgroundColor: DARK_BACKGROUND,
          borderTopColor: '#1e293b'
        },
        tabBarActiveTintColor: DARK_ACCENT,
        tabBarInactiveTintColor: '#94a3b8'
      }
    },
    React.createElement(Tab.Screen, { name: 'Home', component: HomeScreen, options: { title: 'Home' } }),
    React.createElement(Tab.Screen, { name: 'Projects', component: ProjectsScreen, options: { title: 'Projects' } }),
    React.createElement(Tab.Screen, { name: 'Notifications', component: NotificationsScreen, options: { title: 'Notifications' } }),
    React.createElement(Tab.Screen, { name: 'MyWork', component: MyWorkScreen, options: { title: 'My Work' } }),
    React.createElement(Tab.Screen, { name: 'Profile', component: ProfileScreen, options: { title: 'Profile' } })
  );
};

export default MainNavigator;
