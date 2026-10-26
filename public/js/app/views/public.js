import { state, persistSession, notify, escapeHTML } from '../store.js';

function accessLayout(content, opts = {}) {
  const { wide = false } = opts;
  return '<div class="access-page"><section class="access-intro"><a class="access-brand" href="/" aria-label="MAHI TECH GROUP homepage"><span class="brand-mark">M/</span><span><strong>MAHI TECH GROUP</strong><small>COLLABORATIVE WORKSPACE</small></span></a><div class="access-intro__body"><div class="eyebrow eyebrow--lime">Ideas into shared outcomes</div><h1>One team.<br><em>Many disciplines.</em></h1><p>A role-aware workspace for research, design, development, testing, governance, and the decisions that connect them.</p></div><div class="access-intro__foot"><a href="#/about">About</a><a href="#/legal/terms">Terms</a><a href="#/legal/privacy">Privacy</a></div></section><section class="access-content"><div class="access-topbar"><span class="prototype-badge">Secure platform</span><nav class="access-topbar__links" aria-label="Public access"><a href="#/about">Platform</a><a href="#/login">Member access</a></nav></div><div class="access-form-wrap ' + (wide ? 'access-form-wrap--wide' : '') + '">' + content + '</div></section></div>';
}

export function renderLogin() {
  const content = '<div class="eyebrow">Member access</div><h2>Welcome back to the workspace.</h2><p class="access-form-wrap__intro">Sign in with your registered credentials.</p><div id="login-error" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);color:#fca5a5;border-radius:8px;padding:10px 14px;font-size:0.82rem;margin-bottom:16px;"></div><form id="login-form" class="stack mt-2" novalidate><div class="field"><label for="login-email">Email address</label><input class="input" id="login-email" name="email" type="email" autocomplete="email" placeholder="you@oviaxe.com" required></div><div class="field"><label for="login-password">Password</label><div class="input-wrap input-wrap--action"><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required minlength="8"><button class="btn btn--ghost btn--icon btn--sm" type="button" id="toggle-password" aria-label="Show password">eye</button></div></div><button class="btn btn--primary btn--lg btn--full" type="submit" id="login-submit">Sign In</button></form><p class="access-form-wrap__foot" style="margin-top:16px;">New to the group? <a class="link-btn" href="#/signup">Submit a membership application</a></p><p class="access-form-wrap__foot"><a class="link-btn" href="/forgot-password.html">Forgot your password?</a></p>';
  return { html: accessLayout(content, { wide: true }), mount: mountLogin };
}

function mountLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { showError('Please enter both email and password.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    errorBox.style.display = 'none';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.token && data.user) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        state.session = {
          userId: data.user.id,
          role: data.user.role,
          name: data.user.name,
          email: data.user.email,
          elevated: data.user.role === 'admin',
          authenticated: true,
          loginAt: new Date().toISOString()
        };
        persistSession();
        notify('session');

        window.location.href = data.user.role === 'admin' ? '/admin.html' : '/';
        return;
      }

      let msg = data.error || data.message || 'Login failed';
      if (data.requires_2fa) msg = '2FA code required. Enter your authenticator code.';
      showError(msg);
    } catch (err) {
      showError('Cannot reach the server. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }

  document.getElementById('toggle-password')?.addEventListener('click', () => {
    const pw = document.getElementById('login-password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });
}

export function renderSignup() {
  const content = '<div class="eyebrow">New membership</div><h2>Apply to join the workspace.</h2><p class="access-form-wrap__intro">Fill out the application below. The Administrator will review it and grant access.</p><div id="signup-error" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);color:#fca5a5;border-radius:8px;padding:10px 14px;font-size:0.82rem;margin-bottom:16px;"></div><div id="signup-success" style="display:none;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.35);color:#6ee7b7;border-radius:8px;padding:10px 14px;font-size:0.82rem;margin-bottom:16px;"></div><form id="signup-form" class="stack mt-2" novalidate><div class="field"><label for="signup-name">Full Name</label><input class="input" id="signup-name" type="text" placeholder="Your full name" required></div><div class="field"><label for="signup-email">Email</label><input class="input" id="signup-email" type="email" placeholder="you@oviaxe.com" required></div><div class="field"><label for="signup-password">Password</label><input class="input" id="signup-password" type="password" placeholder="At least 8 characters" minlength="8" required></div><div class="field"><label for="signup-role">Desired Role</label><select class="input" id="signup-role" required><option value="">Select role...</option><option value="researcher">Researcher</option><option value="designer">UI/UX Designer</option><option value="developer">Developer</option><option value="producer">Producer / Tester</option></select></div><button class="btn btn--primary btn--lg btn--full" type="submit">Submit Application</button></form><p class="access-form-wrap__foot">Already a member? <a class="link-btn" href="#/login">Sign in here</a></p>';
  return { html: accessLayout(content), mount: mountSignup };
}

function mountSignup() {
  const form = document.getElementById('signup-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const desired_role = document.getElementById('signup-role').value;
    const errorBox = document.getElementById('signup-error');
    const successBox = document.getElementById('signup-success');
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    if (!name || !email || !password || !desired_role) {
      errorBox.textContent = 'Please fill all fields.';
      errorBox.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, desired_role })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        successBox.textContent = 'Application submitted! The Administrator will review it.';
        successBox.style.display = 'block';
        form.reset();
      } else {
        errorBox.textContent = data.error || 'Signup failed.';
        errorBox.style.display = 'block';
      }
    } catch (err) {
      errorBox.textContent = 'Cannot reach the server.';
      errorBox.style.display = 'block';
    }
  });
}

export function renderApplicationStatus(params) {
  return { html: accessLayout('<div class="eyebrow">Application status</div><h2>Status tracking</h2><p>Application status tracking is available after email verification.</p>') };
}
export function renderAbout() {
  return { html: accessLayout('<div class="eyebrow">Platform</div><h2>About Mahi Tech Group</h2><p>A decentralized team orchestration platform for democratic decision-making, parallel execution, and transparent revenue sharing.</p>') };
}
export function renderContact() {
  return { html: accessLayout('<div class="eyebrow">Support</div><h2>Access & support</h2><p>For support, sign in and use the Support Ticket system in your workspace.</p>') };
}
export function renderLegal(type) {
  const title = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  return { html: accessLayout('<div class="eyebrow">Legal</div><h2>' + title + '</h2><p>View the full document in the Legal Center after signing in.</p>') };
}
