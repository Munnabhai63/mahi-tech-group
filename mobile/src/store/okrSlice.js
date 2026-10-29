import { createSlice } from './reduxFactory.js';

export const okrSlice = createSlice({
  name: 'okr',
  initialState: {
    objectives: [],
    loading: false
  },
  reducers: {
    setObjectives: (state, action) => {
      state.objectives = action.payload || [];
    }
  }
});

export const { setObjectives } = okrSlice.actions;
export default okrSlice.reducer;
