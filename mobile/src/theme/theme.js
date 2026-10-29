// Mahi Tech Group Theme Tokens & Themes
import { darkTheme } from './darkTheme.js';
import { lightTheme } from './lightTheme.js';

// Core Dark Theme Design Tokens per MTG Spec
export const DARK_BACKGROUND = '#0f172a';
export const DARK_SURFACE = '#1e293b';
export const DARK_ACCENT = '#38bdf8';

export const darkTokens = {
  background: '#0f172a',
  surface: '#1e293b',
  card: '#1e293b',
  accent: '#38bdf8',
  primary: '#38bdf8'
};

export const theme = {
  dark: darkTheme,
  light: lightTheme,
  tokens: {
    dark: darkTokens
  }
};

export { darkTheme, lightTheme };
export default theme;
