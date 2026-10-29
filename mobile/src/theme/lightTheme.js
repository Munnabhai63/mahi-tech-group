import { colors } from '../constants/colors.js';
import { spacing } from '../constants/spacing.js';
import { typography } from '../constants/typography.js';

export const lightTheme = {
  isDark: false,
  colors: {
    background: '#f8fafc',
    surface: '#ffffff',
    card: '#ffffff',
    primary: '#0284c7',
    accent: '#0284c7',
    border: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    tabBar: '#ffffff',
    tabBarBorder: '#e2e8f0',
    headerBackground: '#ffffff',
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success
  },
  spacing,
  typography
};

export default lightTheme;
