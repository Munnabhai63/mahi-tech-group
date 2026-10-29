import { createSlice } from './reduxFactory.js';

export const timeSlice = createSlice({
  name: 'time',
  initialState: {
    activeTimer: null,
    todayEntries: [],
    loading: false
  },
  reducers: {
    setActiveTimer: (state, action) => {
      state.activeTimer = action.payload;
    },
    setTodayEntries: (state, action) => {
      state.todayEntries = action.payload || [];
    }
  }
});

export const { setActiveTimer, setTodayEntries } = timeSlice.actions;
export default timeSlice.reducer;
