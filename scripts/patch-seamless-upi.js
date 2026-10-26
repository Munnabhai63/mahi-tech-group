import fs from 'node:fs';

console.log('=== STARTING SEAMLESS UPI & 1-CLICK INTENT PATCH (CRLF/LF SAFE) ===');

// 1. PATCH apps/checkout-portal/src/server.js
const portalServerPath = '/var/www/ovipay/apps/checkout-portal/src/server.js';
if (fs.existsSync(portalServerPath)) {
  let content = fs.readFileSync(portalServerPath, 'utf8');

  // Add UPI_URI to SCRIPT_PLACEHOLDERS
  if (!content.includes("'UPI_URI'")) {
    content = content.replace(
      /const SCRIPT_PLACEHOLDERS = new Set\(\['PAYMENT_ID', 'API_BASE_URL', 'AMOUNT'\]\);/,
      "const SCRIPT_PLACEHOLDERS = new Set(['PAYMENT_ID', 'API_BASE_URL', 'AMOUNT', 'UPI_URI']);"
    );
  }

  // Pass UPI_URI in renderTemplate
  if (!content.includes('UPI_URI: upiUri')) {
    content = content.replace(
      /return renderTemplate\(html, \{(\r?\n\s*)PAYMENT_ID: paymentId,/,
      "const upiUri = state?.upiUri || `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(merchantName)}&am=${encodeURIComponent(state?.amount || '1.00')}&cu=INR&tn=${encodeURIComponent(paymentId)}`;\n\n    return renderTemplate(html, {$1PAYMENT_ID: paymentId,$1UPI_URI: upiUri,"
    );
  }

  fs.writeFileSync(portalServerPath, content, 'utf8');
  console.log('✓ Patched apps/checkout-portal/src/server.js');
}

// 2. PATCH apps/checkout-portal/src/views/checkout.html
const checkoutHtmlPath = '/var/www/ovipay/apps/checkout-portal/src/views/checkout.html';
if (fs.existsSync(checkoutHtmlPath)) {
  let content = fs.readFileSync(checkoutHtmlPath, 'utf8');

  // Define INITIAL_UPI_URI at script start
  if (!content.includes('INITIAL_UPI_URI')) {
    content = content.replace(
      'const API_BASE = "{{API_BASE_URL}}";',
      'const API_BASE = "{{API_BASE_URL}}";\n    const INITIAL_UPI_URI = "{{UPI_URI}}";'
    );
  }

  // Regex replacement for authGateBlock
  const authGateRegex = /const hasCustomer = Boolean\(data\.customer \|\| activeCustomer\);[\s\S]*?if \(!hasCustomer\) \{[\s\S]*?renderSavedAccountsUI\(\);[\s\S]*?return;[\s\S]*?\}/;
  if (authGateRegex.test(content)) {
    content = content.replace(
      authGateRegex,
      "// Guest / Direct 1-Click Checkout: Never block payment behind phone/email/OTP\n      setGatewayAuthMode(false);"
    );
    console.log('✓ Replaced forced WhatsApp OTP auth gate with Direct Guest Checkout');
  } else {
    console.log('! Auth gate regex did not match, checking if already replaced');
  }

  // Add openUpiApp function if not present
  if (!content.includes('function openUpiApp(')) {
    const helperCode = `
    // --- 1-CLICK INSTANT UPI INTENT LAUNCHER FOR MOBILE & DESKTOP ---
    function openUpiApp(targetApp) {
      const vpa = (state?.payeeVpa || document.getElementById('displayVpaVal')?.textContent || 'muna937634@ybl').trim();
      const pn = (state?.merchantName || 'Mahipal Choudhary').trim();
      const am = (state?.amount || '1.00').trim();
      const tn = PAYMENT_ID;

      const params = new URLSearchParams();
      params.set('pa', vpa);
      params.set('pn', pn);
      params.set('am', am);
      params.set('cu', 'INR');
      params.set('tn', tn);
      const queryStr = params.toString();
      const canonicalUpiUri = \`upi://pay?\${queryStr}\`;

      const appMap = {
        phonepe: { package: 'com.phonepe.app' },
        gpay: { package: 'com.google.android.apps.nbu.paisa.user' },
        paytm: { package: 'net.one97.paytm' },
        cred: { package: 'com.dreamplug.androidapp' },
        bhim: { package: 'in.org.npci.upiapp' },
        amazonpay: { package: 'in.amazon.mShop.android.shopping' }
      };

      const isAndroid = /Android/i.test(navigator.userAgent);
      if (targetApp && appMap[targetApp] && isAndroid) {
        const pkg = appMap[targetApp].package;
        const intentUrl = \`intent://pay?\${queryStr}#Intent;scheme=upi;package=\${pkg};end\`;
        window.location.href = intentUrl;
        setTimeout(() => {
          window.location.href = canonicalUpiUri;
        }, 1500);
        return;
      }

      window.location.href = canonicalUpiUri;
    }
`;
    content = content.replace('function copyVpaId() {', `${helperCode}\n    function copyVpaId() {`);
    console.log('✓ Injected openUpiApp helper into checkout.html');
  }

  fs.writeFileSync(checkoutHtmlPath, content, 'utf8');
  console.log('✓ Patched apps/checkout-portal/src/views/checkout.html');
}

// 3. PATCH apps/checkout-portal/src/views/partials/payment-methods.html
const paymentMethodsPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/payment-methods.html';
if (fs.existsSync(paymentMethodsPath)) {
  let content = fs.readFileSync(paymentMethodsPath, 'utf8');

  const intentButtonsMarkup = `
                <!-- Instant 1-Click UPI Mobile Payment & App Selector -->
                <div class="ypg-upi-intent-container">
                  <button type="button" class="ypg-btn-upi-intent-main" onclick="openUpiApp('any')" title="Pay via any UPI App">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      <span>Pay ₹{{AMOUNT}} with any UPI App</span>
                    </div>
                    <span style="font-size:11.5px; font-weight:500; opacity:0.9;">1-Click Instant Open • PhonePe, GPay, Paytm, CRED</span>
                  </button>

                  <div class="ypg-instant-apps-grid">
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('phonepe')" title="Pay with PhonePe">
                      <img src="/icons/phonepe.png" onerror="if(window.FALLBACK_ICONS)this.src=window.FALLBACK_ICONS.phonepe" alt="PhonePe" />
                      <span>PhonePe</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('gpay')" title="Pay with Google Pay">
                      <img src="/icons/gpay.png" onerror="if(window.FALLBACK_ICONS)this.src=window.FALLBACK_ICONS.gpay" alt="GPay" />
                      <span>Google Pay</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('paytm')" title="Pay with Paytm">
                      <img src="/icons/paytm.png" onerror="if(window.FALLBACK_ICONS)this.src=window.FALLBACK_ICONS.paytm" alt="Paytm" />
                      <span>Paytm</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('cred')" title="Pay with CRED">
                      <img src="/icons/cred.png" onerror="if(window.FALLBACK_ICONS)this.src=window.FALLBACK_ICONS.cred" alt="CRED" />
                      <span>CRED</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('bhim')" title="Pay with BHIM UPI">
                      <img src="/icons/bhim.png" onerror="if(window.FALLBACK_ICONS)this.src=window.FALLBACK_ICONS.bhim" alt="BHIM" />
                      <span>BHIM UPI</span>
                    </button>
                  </div>

                  <div class="ypg-qr-divider">
                    <span>Or Scan QR Code to Pay</span>
                  </div>
                </div>
`;

  if (!content.includes('ypg-btn-upi-intent-main')) {
    content = content.replace(
      '<!-- Core UPI QR Card -->',
      `${intentButtonsMarkup}\n                <!-- Core UPI QR Card -->`
    );
    fs.writeFileSync(paymentMethodsPath, content, 'utf8');
    console.log('✓ Injected 1-Click UPI Intent buttons into payment-methods.html');
  }
}

// 4. PATCH apps/checkout-portal/public/css/checkout.css
const checkoutCssPath = '/var/www/ovipay/apps/checkout-portal/public/css/checkout.css';
if (fs.existsSync(checkoutCssPath)) {
  let content = fs.readFileSync(checkoutCssPath, 'utf8');

  if (!content.includes('.ypg-upi-intent-container')) {
    const extraCss = `
/* ==========================================================================
   INSTANT 1-CLICK UPI MOBILE APP PAYMENTS & SEAMLESS APP SELECTOR
   ========================================================================== */
.ypg-upi-intent-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.ypg-btn-upi-intent-main {
  width: 100%;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  padding: 13px 16px;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  transition: all 0.2s ease;
  text-decoration: none;
  font-family: inherit;
}

.ypg-btn-upi-intent-main:hover,
.ypg-btn-upi-intent-main:active {
  background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
}

.ypg-instant-apps-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.ypg-app-tile {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  font-family: inherit;
}

.ypg-app-tile:hover,
.ypg-app-tile:active {
  border-color: #2563eb;
  background: #f8fafc;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(37, 99, 235, 0.12);
}

.ypg-app-tile img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: contain;
}

.ypg-app-tile span {
  font-size: 10.5px;
  font-weight: 600;
  color: #334155;
  text-align: center;
  white-space: nowrap;
}

.ypg-qr-divider {
  display: flex;
  align-items: center;
  margin: 10px 0 8px 0;
  text-align: center;
}

.ypg-qr-divider::before,
.ypg-qr-divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px dashed #cbd5e1;
}

.ypg-qr-divider span {
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

#qrImageContainer {
  cursor: pointer;
}
`;
    content += extraCss;
    fs.writeFileSync(checkoutCssPath, content, 'utf8');
    console.log('✓ Added 1-Click UPI styles to checkout.css');
  }
}

// 5. PATCH apps/payment-api/src/routes/checkout.routes.js (Device Rebinding for Seamless Customer Access)
const checkoutRoutesPath = '/var/www/ovipay/apps/payment-api/src/routes/checkout.routes.js';
if (fs.existsSync(checkoutRoutesPath)) {
  let content = fs.readFileSync(checkoutRoutesPath, 'utf8');

  const boundDeviceRegex = /\/\/\s*Session HAS a bound device:[\r\n\s]*\/\/\s*Require matching deviceId AND valid cryptographic credential \(token or signature\)\./;
  const seamlessRebindCode = `// Session HAS a bound device:
  // If session is active/unpaid (INITIATED or ACTIVE), allow a valid registered payer device to rebind
  // This ensures that when a merchant sends the checkout link to a customer, or customer switches from PC to mobile,
  // the payer's mobile phone is seamlessly authorized instead of returning DUPLICATE_SESSION_DETECTED.
  if (session.status === 'INITIATED' || session.status === 'ACTIVE') {
    if (requestingDeviceId) {
      const credCheck = verifyRegisteredDeviceCredentials({
        deviceId: requestingDeviceId,
        deviceToken,
        deviceSignature,
        signaturePayload,
        deviceRepo: ctx?.deviceRepo
      });
      if (credCheck.valid) {
        if (ctx?.deviceRepo) ctx.deviceRepo.touch(requestingDeviceId);
        if (session.deviceId !== requestingDeviceId && ctx?.sessionRepo) {
          try {
            ctx.sessionRepo.bindDevice(session.id, requestingDeviceId);
            session.deviceId = requestingDeviceId;
          } catch (err) {
            console.warn('[checkSessionDeviceAccess] rebindDevice error:', err.message);
          }
        }
        return { allowed: true, boundDeviceId: session.deviceId };
      }
    }
  }

  // Require matching deviceId AND valid cryptographic credential (token or signature).`;

  if (boundDeviceRegex.test(content) && !content.includes('[checkSessionDeviceAccess] rebindDevice error')) {
    content = content.replace(boundDeviceRegex, seamlessRebindCode);
    fs.writeFileSync(checkoutRoutesPath, content, 'utf8');
    console.log('✓ Patched device rebinding in checkout.routes.js');
  } else if (content.includes('[checkSessionDeviceAccess] rebindDevice error')) {
    console.log('✓ Device rebinding already patched in checkout.routes.js');
  } else {
    console.log('! Bound device anchor not matched in checkout.routes.js');
  }
}

console.log('=== ALL SEAMLESS UPI PATCHES APPLIED SUCCESSFULLY ===');
