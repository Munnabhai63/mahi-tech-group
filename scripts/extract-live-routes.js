import { createApp } from '../src/app.js';
import fs from 'node:fs';

const app = createApp();

function split(thing) {
  if (typeof thing === 'string') {
    return thing;
  } else if (thing.fast_slash) {
    return '';
  } else {
    var match = thing.toString()
      .replace('\\/?', '')
      .replace('(?=\\/|$)', '$')
      .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^.*+?^${}()|[\]\\\/])*)\$\//);
    return match
      ? match[1].replace(/\\(.)/g, '$1')
      : thing.toString();
  }
}

function getRoutes(app) {
  const routes = [];

  function print(path, layer) {
    if (layer.route) {
      layer.route.stack.forEach(print.bind(null, path + split(layer.route.path)));
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach(print.bind(null, path + split(layer.regexp)));
    } else if (layer.method) {
      routes.push({
        method: layer.method.toUpperCase(),
        path: path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
      });
    }
  }

  app._router.stack.forEach(print.bind(null, ''));
  return routes;
}

const rawRoutes = getRoutes(app);
// Deduplicate routes by method + path
const seen = new Set();
const uniqueRoutes = [];
for (const r of rawRoutes) {
  const key = `${r.method} ${r.path}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueRoutes.push(r);
  }
}

console.log('Total unique live routes:', uniqueRoutes.length);
fs.writeFileSync('scripts/live-routes-dump.json', JSON.stringify(uniqueRoutes, null, 2));
