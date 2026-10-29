import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DARK_SURFACE } from '../theme/theme.js';

export const SkeletonLoader = ({ width = '100%', height = 20, borderRadius = 6, style }) => {
  return React.createElement(View, {
    style: [
      styles.skeleton,
      {
        width,
        height,
        borderRadius
      },
      style
    ]
  });
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: DARK_SURFACE,
    opacity: 0.7,
    overflow: 'hidden'
  }
});

export default SkeletonLoader;
