import React, { useState } from 'react';
import { AppNavigator } from './src/navigation/AppNavigator.js';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return React.createElement(AppNavigator, {
    isAuthenticated,
    onAuthSuccess: () => setIsAuthenticated(true)
  });
}
