import { colors } from '../constants/colors.js';
import { spacing } from '../constants/spacing.js';
import { typography } from '../constants/typography.js';

export const darkTheme = {
  isDark: true,
  colors: {
    background: '#0f172a',
    surface: '#1e293b',
    card: '#1e293b',
    primary: '#38bdf8',
    accent: '#38bdf8',
    border: '#334155',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    tabBar: '#0f172a',
    tabBarBorder: '#1e293b',
    headerBackground: '#0f172a',
    danger: colors.danger,
    warning: colors.warning,
    success: colors.success
  },
  spacing,
  typography
};

export default darkTheme;
