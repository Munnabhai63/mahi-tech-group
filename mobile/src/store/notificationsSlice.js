import { createSlice } from './reduxFactory.js';

export const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: {
    items: [],
    unreadCount: 0,
    loading: false
  },
  reducers: {
    setNotifications: (state, action) => {
      state.items = action.payload || [];
      state.unreadCount = state.items.filter((n) => !n.is_read).length;
    },
    markNotificationAsRead: (state, action) => {
      const item = state.items.find((n) => n.id === action.payload);
      if (item && !item.is_read) {
        item.is_read = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    }
  }
});

export const { setNotifications, markNotificationAsRead } = notificationsSlice.actions;
export default notificationsSlice.reducer;
