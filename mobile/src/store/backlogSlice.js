import { createSlice } from './reduxFactory.js';

export const backlogSlice = createSlice({
  name: 'backlog',
  initialState: {
    items: [],
    loading: false
  },
  reducers: {
    setBacklogItems: (state, action) => {
      state.items = action.payload || [];
    },
    updateItemStatusLocal: (state, action) => {
      const { itemId, status } = action.payload;
      const item = state.items.find((i) => i.id === itemId);
      if (item) {
        item.status = status;
      }
    }
  }
});

export const { setBacklogItems, updateItemStatusLocal } = backlogSlice.actions;
export default backlogSlice.reducer;
