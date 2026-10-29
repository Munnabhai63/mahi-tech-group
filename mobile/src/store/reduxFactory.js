// Universal Redux Toolkit Factory (Isomorphic for Expo & Node.js Verification)

let rtk = null;
try {
  rtk = require('@reduxjs/toolkit');
} catch {
  rtk = null;
}

export const createSlice = (options) => {
  if (rtk?.createSlice) {
    return rtk.createSlice(options);
  }
  const { name, initialState, reducers } = options;
  const actions = {};
  Object.keys(reducers || {}).forEach((key) => {
    actions[key] = (payload) => ({ type: `${name}/${key}`, payload });
  });

  const reducer = (state = initialState, action) => {
    if (!action?.type?.startsWith(`${name}/`)) return state;
    const actionKey = action.type.replace(`${name}/`, '');
    if (reducers && typeof reducers[actionKey] === 'function') {
      const draft = typeof state === 'object' && state !== null ? { ...state } : state;
      const res = reducers[actionKey](draft, action);
      return res !== undefined ? res : draft;
    }
    return state;
  };

  return { name, actions, reducer };
};

export const configureStore = (options) => {
  if (rtk?.configureStore) {
    return rtk.configureStore(options);
  }
  let state = {};
  const reducers = options.reducer || {};
  Object.keys(reducers).forEach((key) => {
    state[key] = reducers[key](undefined, { type: '@@INIT' });
  });

  return {
    getState: () => state,
    dispatch: (action) => {
      Object.keys(reducers).forEach((key) => {
        state[key] = reducers[key](state[key], action);
      });
      return action;
    },
    subscribe: (listener) => () => {}
  };
};

export default { createSlice, configureStore };
