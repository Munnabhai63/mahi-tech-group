import App from './App.js';

let registerRootComponent = null;
try {
  registerRootComponent = require('expo').registerRootComponent;
} catch {
  registerRootComponent = null;
}

if (typeof registerRootComponent === 'function') {
  registerRootComponent(App);
}

export default App;
