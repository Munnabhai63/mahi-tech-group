/**
 * First-Run Setup Controller — MAHI TECH GROUP
 */

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('setupForm');
  const submitBtn = document.getElementById('submitBtn');
  const errorBox = document.getElementById('errorBox');
  const successBox = document.getElementById('successBox');
  const platformUrlInput = document.getElementById('platformUrl');
  const guidancePanel = document.getElementById('guidancePanel');
  const envSnippetEl = document.getElementById('envSnippet');
  const copyEnvBtn = document.getElementById('copyEnvBtn');
  const setupDesc = document.getElementById('setupDesc');

  // Pre-fill platform URL with current browser origin
  if (platformUrlInput && !platformUrlInput.value) {
    platformUrlInput.value = window.location.origin;
  }

  // Pre-flight check: verify if setup is actually required
  try {
    const res = await fetch('/api/setup/status');
    if (res.ok) {
      const data = await res.json();
      if (!data.needsSetup) {
        window.location.replace('/');
        return;
      }
    }
  } catch (err) {
    console.warn('Unable to query setup status:', err);
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    successBox.style.display = 'none';
  }

  function hideError() {
    errorBox.style.display = 'none';
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const name = document.getElementById('adminName').value.trim();
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;
      const company_name = document.getElementById('companyName').value.trim();
      const platform_url = document.getElementById('platformUrl').value.trim();

      if (!name || !email || !password) {
        showError('Please complete all required fields.');
        return;
      }

      if (password.length < 8) {
        showError('Password must be at least 8 characters long.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Configuring Platform...</span>';

      try {
        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            password,
            company_name,
            platform_url
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Setup failed');
        }

        // Store authentication token for immediate admin login
        if (data.token) {
          localStorage.setItem('authToken', data.token);
          localStorage.setItem('currentUser', JSON.stringify(data.admin));
        }

        // Switch to guidance panel
        form.style.display = 'none';
        if (setupDesc) setupDesc.style.display = 'none';
        guidancePanel.style.display = 'block';

        if (envSnippetEl && data.env_snippet) {
          envSnippetEl.textContent = data.env_snippet;
        }

        if (copyEnvBtn) {
          copyEnvBtn.addEventListener('click', () => {
            if (navigator.clipboard && data.env_snippet) {
              navigator.clipboard.writeText(data.env_snippet).then(() => {
                copyEnvBtn.innerHTML = '<span>✔ Copied!</span>';
                setTimeout(() => {
                  copyEnvBtn.innerHTML = '<span>Copy .env</span>';
                }, 2000);
              });
            }
          });
        }
      } catch (err) {
        showError(err.message || 'An error occurred during setup');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <span>Complete First-Run Setup</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        `;
      }
    });
  }
});
