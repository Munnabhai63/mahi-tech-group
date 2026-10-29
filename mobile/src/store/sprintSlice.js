import { createSlice } from './reduxFactory.js';

export const sprintSlice = createSlice({
  name: 'sprint',
  initialState: {
    activeSprint: null,
    sprints: [],
    loading: false
  },
  reducers: {
    setSprints: (state, action) => {
      state.sprints = action.payload || [];
    },
    setActiveSprint: (state, action) => {
      state.activeSprint = action.payload;
    }
  }
});

export const { setSprints, setActiveSprint } = sprintSlice.actions;
export default sprintSlice.reducer;
