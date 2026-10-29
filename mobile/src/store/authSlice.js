import { createSlice } from './reduxFactory.js';

export const authSlice = createSlice({
  name: 'auth',
  initialState: {
    isAuthenticated: false,
    user: null,
    token: null,
    isBiometricEnabled: false,
    loading: false,
    error: null
  },
  reducers: {
    setCredentials: (state, action) => {
      state.isAuthenticated = true;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.error = null;
    },
    updateUser: (state, action) => {
      state.user = { ...state.user, ...action.payload };
    },
    setBiometricEnabled: (state, action) => {
      state.isBiometricEnabled = Boolean(action.payload);
    },
    logout: (state) => {
      state.isAuthenticated = false;
      state.user = null;
      state.token = null;
    }
  }
});

export const { setCredentials, updateUser, setBiometricEnabled, logout } = authSlice.actions;
export default authSlice.reducer;
