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

export const TaskCardSkeleton = () => {
  return React.createElement(
    View,
    { style: styles.cardSkeleton },
    React.createElement(SkeletonLoader, { width: '40%', height: 14, borderRadius: 4, style: { marginBottom: 10 } }),
    React.createElement(SkeletonLoader, { width: '85%', height: 18, borderRadius: 4, style: { marginBottom: 12 } }),
    React.createElement(
      View,
      { style: styles.rowSkeleton },
      React.createElement(SkeletonLoader, { width: '25%', height: 20, borderRadius: 10 }),
      React.createElement(SkeletonLoader, { width: '20%', height: 20, borderRadius: 10 })
    )
  );
};

export const OKRSkeleton = () => {
  return React.createElement(
    View,
    { style: styles.cardSkeleton },
    React.createElement(SkeletonLoader, { width: '60%', height: 16, borderRadius: 4, style: { marginBottom: 8 } }),
    React.createElement(SkeletonLoader, { width: '100%', height: 10, borderRadius: 5, style: { marginBottom: 8 } }),
    React.createElement(
      View,
      { style: styles.rowSkeleton },
      React.createElement(SkeletonLoader, { width: '30%', height: 12, borderRadius: 4 }),
      React.createElement(SkeletonLoader, { width: '15%', height: 12, borderRadius: 4 })
    )
  );
};

export const DashboardSkeleton = () => {
  return React.createElement(
    View,
    { style: styles.containerSkeleton },
    React.createElement(SkeletonLoader, { width: '50%', height: 24, borderRadius: 6, style: { marginBottom: 16 } }),
    React.createElement(SkeletonLoader, { width: '100%', height: 75, borderRadius: 12, style: { marginBottom: 20 } }),
    React.createElement(TaskCardSkeleton),
    React.createElement(TaskCardSkeleton),
    React.createElement(OKRSkeleton)
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#334155',
    opacity: 0.6,
    overflow: 'hidden'
  },
  cardSkeleton: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  rowSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  containerSkeleton: {
    padding: 16
  }
});

export default SkeletonLoader;
