import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE } from '../theme/theme.js';

export const BottomSheet = ({ visible = false, onClose, children }) => {
  return React.createElement(
    Modal,
    {
      visible,
      transparent: true,
      animationType: 'slide',
      onRequestClose: onClose
    },
    React.createElement(
      TouchableOpacity,
      {
        style: styles.overlay,
        activeOpacity: 1,
        onPress: onClose
      },
      React.createElement(
        View,
        {
          style: styles.sheet,
          onStartShouldSetResponder: () => true
        },
        React.createElement(View, { style: styles.handle }),
        children
      )
    )
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end'
  },
  sheet: {
    backgroundColor: DARK_SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    minHeight: 200,
    borderTopWidth: 1,
    borderColor: '#334155'
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#64748b',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16
  }
});

export default BottomSheet;
