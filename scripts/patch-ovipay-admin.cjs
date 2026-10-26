const fs = require('fs');

const localPath = 'F:\\UserData\\Downloads\\ai-power-tools\\YouPI-PG\\apps\\merchant-admin\\src\\views\\admin.html';
let content = fs.readFileSync(localPath, 'utf8');

const replacementAuth = `window.__youpiAdminAuth = (function () {
      const KEY = 'youpi_admin_token';
      const nativeFetch = window.fetch.bind(window);
      let pending = null;

      const read = () => {
        try {
          const urlParam = new URLSearchParams(window.location.search).get('token');
          if (urlParam && urlParam.trim()) {
            write(urlParam.trim());
            return urlParam.trim();
          }
          return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';
        } catch (e) {
          return '';
        }
      };

      const write = (t) => {
        try {
          if (t) {
            sessionStorage.setItem(KEY, t);
            localStorage.setItem(KEY, t);
          }
        } catch (e) {}
      };

      const clear = (attempted) => {
        try {
          const current = sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '';
          if (!attempted || current === attempted) {
            sessionStorage.removeItem(KEY);
            localStorage.removeItem(KEY);
          }
        } catch (e) {}
      };

      function isProtected(url) {
        return (/\/api\/v1\/admin\//.test(url) || /\/api\/services/.test(url) || /\/api\/admin\/tickets/.test(url)) && !/\/admin\/sms-gateway\/download-apk/.test(url);
      }

      function prompt(message) {
        if (pending) return pending;
        pending = new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.id = 'adminAuthOverlay';
          overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
          const box = document.createElement('form');
          box.style.cssText = 'background:#fff;color:#0f172a;border-radius:12px;padding:24px;max-width:460px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.4)';
          const title = document.createElement('h3');
          title.textContent = 'Admin token required';
          title.style.margin = '0 0 8px';
          const hint = document.createElement('p');
          hint.textContent = message || 'Enter the admin API token (ADMIN_API_TOKEN, or the contents of data/.secrets/admin_api_token on the server).';
          hint.style.cssText = 'margin:0 0 12px;font-size:14px;color:#475569';
          const input = document.createElement('input');
          input.type = 'text';
          input.name = 'admin_api_key_override';
          input.autocomplete = 'off';
          input.autocapitalize = 'off';
          input.spellcheck = false;
          input.required = true;
          input.placeholder = 'Paste 64-character token here...';
          input.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;font-family:monospace;font-size:13px;';
          const btn = document.createElement('button');
          btn.type = 'submit';
          btn.textContent = 'Unlock';
          btn.style.cssText = 'width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer';
          box.append(title, hint, input, btn);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
          input.focus();
          box.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const val = input.value.trim();
            if (!val) return;
            write(val);
            overlay.remove();
            pending = null;
            if (typeof connectAdminEventsSse === 'function') connectAdminEventsSse();
            if (typeof connectServicesLogsSse === 'function') connectServicesLogsSse();
            resolve();
          });
        });
        return pending;
      }

      async function authedFetch(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!isProtected(url)) return nativeFetch(input, init);
        if (!read()) {
          await prompt();
        }
        const tokenUsed = read();
        const attempt = (tok) => {
          const headers = new Headers((init && init.headers) || (input && input.headers) || {});
          headers.set('Authorization', 'Bearer ' + tok);
          return nativeFetch(input, Object.assign({}, init, { headers }));
        };
        let res = await attempt(tokenUsed);
        if (res.status === 401) {
          if (read() === tokenUsed) {
            clear(tokenUsed);
            await prompt('That token was rejected. Enter the admin API token again.');
          }
          res = await attempt(read());
          if (res.ok && typeof connectAdminEventsSse === 'function') connectAdminEventsSse();
          if (res.ok && typeof connectServicesLogsSse === 'function') connectServicesLogsSse();
        }
        return res;
      }

      window.fetch = authedFetch;
      return { token: read, ensure: () => (read() ? Promise.resolve() : prompt()) };
    })();`;

const regex = /window\.__youpiAdminAuth\s*=\s*\(function\s*\(\)\s*\{[\s\S]*?return\s*\{\s*token:\s*read,\s*ensure:\s*\(\)\s*=>\s*\(read\(\)\s*\?\s*Promise\.resolve\(\)\s*:\s*prompt\(\)\)\s*\};\s*\}\)\(\);/;

if (!regex.test(content)) {
  console.error("Regex match failed!");
  process.exit(1);
}

const updated = content.replace(regex, replacementAuth);
fs.writeFileSync(localPath, updated, 'utf8');
console.log("Successfully replaced auth block in local admin.html!");
