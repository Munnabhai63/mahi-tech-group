import { configureStore } from './reduxFactory.js';
import authReducer from './authSlice.js';
import projectsReducer from './projectsSlice.js';
import sprintReducer from './sprintSlice.js';
import backlogReducer from './backlogSlice.js';
import okrReducer from './okrSlice.js';
import timeReducer from './timeSlice.js';
import notificationsReducer from './notificationsSlice.js';
import offlineQueueReducer from './offlineQueueSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    projects: projectsReducer,
    sprint: sprintReducer,
    backlog: backlogReducer,
    okr: okrReducer,
    time: timeReducer,
    notifications: notificationsReducer,
    offlineQueue: offlineQueueReducer
  }
});

export default store;
