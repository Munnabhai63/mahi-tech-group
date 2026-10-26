import fs from 'node:fs';

console.log('=== Starting Seamless QR & Layout Patch ===');

// 1. PATCH server.js
const serverPath = '/var/www/ovipay/apps/checkout-portal/src/server.js';
let serverContent = fs.readFileSync(serverPath, 'utf8');

// Fix indicator fallback: from ISSUES/RED to WORKING/GREEN
serverContent = serverContent.replace(
  /const indicator = state\?\.upiServerIndicator \|\| \{[^}]+\};/,
  "const indicator = state?.upiServerIndicator || { status: 'WORKING', tier: 'GREEN', label: 'Server Is Working', isWorking: true };"
);

// Ensure alertStyle is none when GREEN
serverContent = serverContent.replace(
  /const alertStyle = tier === 'GREEN' \? 'none' : 'flex';/,
  "const alertStyle = (tier === 'GREEN' || !tier) ? 'none' : 'flex';"
);

// Add BUILD_TIME to template variables if not present
if (!serverContent.includes('BUILD_TIME:')) {
  serverContent = serverContent.replace(
    'UPI_URI: upiUri,',
    "BUILD_TIME: Date.now().toString(36),\n      UPI_URI: upiUri,"
  );
}

fs.writeFileSync(serverPath, serverContent, 'utf8');
console.log('[1/3] server.js patched successfully');

// 2. PATCH payment-methods.html
const methodsPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/payment-methods.html';
let methodsContent = fs.readFileSync(methodsPath, 'utf8');

const upiViewRegex = /<!-- VIEW A: PURE UPI QR INTERFACE -->[\s\S]*?<!-- UPI Payment Instructions Guide -->/;

const newUpiView = `<!-- VIEW A: PURE UPI QR INTERFACE -->
              <div id="viewUpiContent">
                <h2 class="ypg-page-title" style="margin-bottom: 6px; font-size: 16px;">UPI QR Payment</h2>

                <!-- Header Row: Section Label + Pulse Dot Status + Timer -->
                <div class="ypg-section-label-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                  <span class="ypg-section-heading" style="font-size: 12.5px; font-weight: 700; color: #475569;">Scan &amp; Pay via UPI</span>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <div class="ypg-server-health-indicator {{SERVER_HEALTH_CLASS}}" id="upiServerHealthIndicator">
                      <span class="ypg-pulse-dot" id="serverPulseDot"></span>
                      <span id="serverStatusLabel">{{SERVER_HEALTH_LABEL}}</span>
                    </div>
                    <div class="ypg-countdown-pill" id="activeTimerBadge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span id="activeTimerText">05:00</span>
                    </div>
                  </div>
                </div>

                <!-- UPI Server Downtime Warning (Hidden by default when server is working) -->
                <div class="{{DOWNTIME_ALERT_CLASS}}" id="serverDowntimeAlert" style="display:{{DOWNTIME_ALERT_STYLE}};">
                  <div class="ypg-downtime-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  </div>
                  <div class="ypg-downtime-info">
                    <div class="ypg-downtime-heading">{{DOWNTIME_HEADING}}</div>
                    <div class="ypg-downtime-msg" id="serverDowntimeMsg">
                      {{DOWNTIME_MSG}}
                    </div>
                    <button type="button" class="ypg-btn-downtime-alt" id="btnDowntimeCashAlt"
                      onclick="switchMethodFromDowntime()" style="display:{{DOWNTIME_ALT_BTN_DISPLAY}};">
                      {{DOWNTIME_ALT_BTN_LABEL}}
                    </button>
                  </div>
                </div>

                <!-- Core UPI QR Card (FIRST & PROMINENT) -->
                <div class="ypg-qr-card-container" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; gap: 14px; align-items: center; margin-bottom: 12px; width: 100%; box-sizing: border-box;">
                  <!-- Left: QR Box -->
                  <div class="ypg-qr-image-box" id="qrImageContainer" style="width: 124px; height: 124px; min-width: 124px; min-height: 124px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
                    <div style="font-size:11px; color:#94a3b8; text-align:center;">Loading QR...</div>
                  </div>

                  <!-- Right: Prompt, UPI App Logos -->
                  <div class="ypg-qr-details-col" style="flex: 1; min-width: 0;">
                    <div class="ypg-qr-prompt-title" style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Scan with any UPI App</div>

                    <!-- Brand Logos Row -->
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:2px 0 6px 0;">
                      <div class="ypg-upi-logos-row" style="display:flex; gap:6px; align-items:center;">
                        <div class="ypg-app-icon" title="Google Pay" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; border-radius:50%; background:#fff; padding:2px;"><img src="/icons/gpay.png" style="width:16px; height:16px; object-fit:contain;" alt="GPay" /></div>
                        <div class="ypg-app-icon" title="PhonePe" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; border-radius:50%; background:#fff; padding:2px;"><img src="/icons/phonepe.png" style="width:16px; height:16px; object-fit:contain;" alt="PhonePe" /></div>
                        <div class="ypg-app-icon" title="Paytm" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; border-radius:50%; background:#fff; padding:2px;"><img src="/icons/paytm.png" style="width:16px; height:16px; object-fit:contain;" alt="Paytm" /></div>
                        <div class="ypg-app-icon" title="CRED" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; border-radius:50%; background:#fff; padding:2px;"><img src="/icons/cred.png" style="width:16px; height:16px; object-fit:contain;" alt="CRED" /></div>
                        <div class="ypg-app-icon" title="BHIM UPI" style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid #e2e8f0; border-radius:50%; background:#fff; padding:2px;"><img src="/icons/bhim.png" style="width:16px; height:16px; object-fit:contain;" alt="BHIM" /></div>
                      </div>
                    </div>

                    <div style="font-size: 11.5px; color: #64748b; line-height: 1.35;">
                      Scan QR using PhonePe, Google Pay, Paytm, or BHIM to pay instantly.
                    </div>
                  </div>
                </div>

                <!-- Instant 1-Click UPI Mobile Payment & App Selector -->
                <div class="ypg-upi-intent-container" style="width: 100%; box-sizing: border-box; margin-bottom: 8px;">
                  <div class="ypg-qr-divider" style="display:flex; align-items:center; margin:4px 0 10px 0; text-align:center;">
                    <span style="font-size:10.5px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; padding:0 8px;">Or Pay via UPI Apps</span>
                  </div>

                  <button type="button" class="ypg-btn-upi-intent-main" onclick="openUpiApp('any')" title="Pay via any UPI App" style="width:100%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; border:none; border-radius:10px; padding:10px 14px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; cursor:pointer; box-shadow:0 2px 8px rgba(16, 185, 129, 0.25); margin-bottom:8px; font-family:inherit;">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      <span style="font-size: 13.5px; font-weight: 700;">Pay ₹{{AMOUNT}} with any UPI App</span>
                    </div>
                    <span style="font-size:11px; font-weight:500; opacity:0.9;">1-Click Instant Open • PhonePe, GPay, Paytm</span>
                  </button>

                  <div class="ypg-instant-apps-grid" style="display:grid; grid-template-columns: repeat(5, 1fr); gap:6px; width:100%; box-sizing:border-box;">
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('phonepe')" title="Pay with PhonePe" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; min-width:0;">
                      <img src="/icons/phonepe.png" alt="PhonePe" style="width:22px !important; height:22px !important; max-width:22px !important; max-height:22px !important; object-fit:contain !important; border-radius:4px;" />
                      <span style="font-size:10px; font-weight:600; color:#334155; white-space:nowrap;">PhonePe</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('gpay')" title="Pay with Google Pay" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; min-width:0;">
                      <img src="/icons/gpay.png" alt="GPay" style="width:22px !important; height:22px !important; max-width:22px !important; max-height:22px !important; object-fit:contain !important; border-radius:4px;" />
                      <span style="font-size:10px; font-weight:600; color:#334155; white-space:nowrap;">GPay</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('paytm')" title="Pay with Paytm" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; min-width:0;">
                      <img src="/icons/paytm.png" alt="Paytm" style="width:22px !important; height:22px !important; max-width:22px !important; max-height:22px !important; object-fit:contain !important; border-radius:4px;" />
                      <span style="font-size:10px; font-weight:600; color:#334155; white-space:nowrap;">Paytm</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('cred')" title="Pay with CRED" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; min-width:0;">
                      <img src="/icons/cred.png" alt="CRED" style="width:22px !important; height:22px !important; max-width:22px !important; max-height:22px !important; object-fit:contain !important; border-radius:4px;" />
                      <span style="font-size:10px; font-weight:600; color:#334155; white-space:nowrap;">CRED</span>
                    </button>
                    <button type="button" class="ypg-app-tile" onclick="openUpiApp('bhim')" title="Pay with BHIM UPI" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 2px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer; min-width:0;">
                      <img src="/icons/bhim.png" alt="BHIM" style="width:22px !important; height:22px !important; max-width:22px !important; max-height:22px !important; object-fit:contain !important; border-radius:4px;" />
                      <span style="font-size:10px; font-weight:600; color:#334155; white-space:nowrap;">BHIM</span>
                    </button>
                  </div>
                </div>

                <!-- UPI Payment Instructions Guide -->`;

if (upiViewRegex.test(methodsContent)) {
  methodsContent = methodsContent.replace(upiViewRegex, newUpiView);
  fs.writeFileSync(methodsPath, methodsContent, 'utf8');
  console.log('[2/3] payment-methods.html patched successfully');
} else {
  console.log('[!] upiViewRegex did not match payment-methods.html');
}

// 3. PATCH checkout.html (Cache-busting and inline style hardening)
const checkoutHtmlPath = '/var/www/ovipay/apps/checkout-portal/src/views/checkout.html';
let checkoutHtml = fs.readFileSync(checkoutHtmlPath, 'utf8');

checkoutHtml = checkoutHtml.replace(
  /<link rel="stylesheet" href="\/css\/checkout\.css[^"]*">/,
  `<link rel="stylesheet" href="/css/checkout.css?v={{BUILD_TIME}}">
  <style>
    .ypg-app-tile img { width: 22px !important; height: 22px !important; max-width: 22px !important; max-height: 22px !important; object-fit: contain !important; border-radius: 4px !important; }
    .ypg-instant-apps-grid { display: grid !important; grid-template-columns: repeat(5, 1fr) !important; gap: 6px !important; width: 100% !important; }
    .ypg-app-tile { min-width: 0 !important; padding: 6px 2px !important; box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important; }
    .ypg-qr-image-box svg { width: 100% !important; height: 100% !important; display: block !important; }
    .ypg-server-health-indicator.is-working { background: #dcfce7 !important; color: #15803d !important; border: 1px solid #bbf7d0 !important; }
    .ypg-server-health-indicator.is-working .ypg-pulse-dot { background: #22c55e !important; box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25) !important; }
  </style>`
);

fs.writeFileSync(checkoutHtmlPath, checkoutHtml, 'utf8');
console.log('[3/3] checkout.html patched successfully');

console.log('=== Patch complete ===');
