import { createSlice } from './reduxFactory.js';

export const projectsSlice = createSlice({
  name: 'projects',
  initialState: {
    items: [],
    selectedProject: null,
    loading: false
  },
  reducers: {
    setProjects: (state, action) => {
      state.items = action.payload || [];
    },
    setSelectedProject: (state, action) => {
      state.selectedProject = action.payload;
    }
  }
});

export const { setProjects, setSelectedProject } = projectsSlice.actions;
export default projectsSlice.reducer;
