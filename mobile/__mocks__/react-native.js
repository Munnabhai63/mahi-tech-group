import { createElement } from 'react';

export const View = (props) => createElement('View', props, props?.children);
export const Text = (props) => createElement('Text', props, props?.children);
export const TouchableOpacity = (props) => createElement('TouchableOpacity', props, props?.children);
export const Modal = (props) => createElement('Modal', props, props?.children);
export const FlatList = (props) => createElement('FlatList', props, props?.children);
export const ScrollView = (props) => createElement('ScrollView', props, props?.children);
export const TextInput = (props) => createElement('TextInput', props, props?.children);
export const RefreshControl = (props) => createElement('RefreshControl', props, props?.children);
export const ActivityIndicator = (props) => createElement('ActivityIndicator', props, props?.children);
export const Image = (props) => createElement('Image', props, props?.children);
export const SafeAreaView = (props) => createElement('SafeAreaView', props, props?.children);
export const StatusBar = (props) => createElement('StatusBar', props, props?.children);
export const Switch = (props) => createElement('Switch', props, props?.children);
export const Alert = {
  alert: (title, message, buttons) => {
    if (buttons && buttons.length > 0 && typeof buttons[0].onPress === 'function') {
      buttons[0].onPress();
    }
  }
};

export const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {})
};

export const Platform = {
  OS: 'android',
  select: (obj) => obj.android ?? obj.default
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} })
};

export default {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar,
  Switch,
  Alert,
  StyleSheet,
  Platform,
  AppState
};
