import fs from 'node:fs';

console.log('=== STARTING CHECKOUT LAYOUT TAGS & CSS REPAIR ===');

// 1. FIX splash.html - remove rogue unclosed <div class="ypg-wrapper">
const splashPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/splash.html';
if (fs.existsSync(splashPath)) {
  const cleanSplash = `  <!-- TOAST NOTIFICATION -->
  <div id="ypgToast" class="ypg-toast"><img src="/icons/upi.svg" alt="UPI" style="height:12px; vertical-align:middle; filter:brightness(0) invert(1); margin-right:4px;" /> Direct UPI QR is active for instant banking verification</div>

  <!-- 1. INITIAL OVIPAY LOADING SPLASH -->
  <div id="ypgSplashScreen" class="ypg-splash-screen">
    <div class="ypg-splash-center">
      <div class="ypg-shield-orbit-box">
        <img id="splashBrandLogo" alt="Logo"
          style="display:none; max-width:82px; max-height:82px; border-radius:16px; object-fit:contain; box-shadow:0 8px 24px rgba(0,0,0,0.12);" />
        <!-- Authentic OviPay Shield with 'Y' Monogram -->
        <svg class="ypg-shield-icon-svg" id="splashDefaultShield" viewBox="0 0 100 120" fill="none">
          <defs>
            <linearGradient id="ypgShieldGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#10b981" />
              <stop offset="100%" stop-color="#059669" />
            </linearGradient>
          </defs>
          <path d="M50 4 L92 22 C92 72, 50 116, 50 116 C50 116, 8 72, 8 22 Z" fill="url(#ypgShieldGrad)" />
          <path d="M33 32 L46 54 L46 84 L54 84 L54 54 L67 32 L56 32 L50 44 L44 32 Z" fill="#ffffff" />
          <polygon points="50,44 56,32 61,32 54,49" fill="#34d399" />
        </svg>
        <div class="ypg-orbit-dot"></div>
      </div>
    </div>
    <div class="ypg-splash-footer" id="splashFooterWrap">
      <span>Secured By</span>
      <strong id="splashSecuredByText" style="color:#10b981; font-size:15px; letter-spacing:-0.2px;">OviPay</strong>
    </div>
  </div>
`;
  fs.writeFileSync(splashPath, cleanSplash, 'utf8');
  console.log('✓ Fixed splash.html (removed rogue ypg-wrapper)');
}

// 2. FIX header.html - remove opening ypg-pc-workspace and trailing opening main tag
const headerPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/header.html';
if (fs.existsSync(headerPath)) {
  let content = fs.readFileSync(headerPath, 'utf8');

  // Remove '<div class="ypg-pc-workspace">' from top if present
  content = content.replace(/<!--\s*PC RIGHT WORKSPACE WRAPPER\s*-->[\r\n\s]*<div class="ypg-pc-workspace">/, '');
  content = content.replace(/<div class="ypg-pc-workspace">/, '');

  // Remove trailing '<main class="ypg-body">' or '<div class="ypg-body">'
  content = content.replace(/<!--\s*3\.\s*SCROLLABLE BODY\s*-->[\r\n\s]*<main class="ypg-body">/, '');
  content = content.replace(/<main class="ypg-body">/, '');

  fs.writeFileSync(headerPath, content.trim() + '\n', 'utf8');
  console.log('✓ Fixed header.html (removed wrapper boundaries)');
}

// 3. FIX footer.html - remove trailing closing div for ypg-pc-workspace
const footerPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/footer.html';
if (fs.existsSync(footerPath)) {
  let content = fs.readFileSync(footerPath, 'utf8');

  // Remove trailing '</div><!-- END ypg-pc-workspace -->'
  content = content.replace(/<\/div>\s*<!--\s*END ypg-pc-workspace\s*-->/, '');
  content = content.replace(/<\/footer>[\r\n\s]*<\/div>/, '</footer');

  fs.writeFileSync(footerPath, content.trim() + '\n', 'utf8');
  console.log('✓ Fixed footer.html (removed trailing workspace close)');
}

// 4. FIX checkout.html - wrap workspace cleanly around header, body, and footer
const checkoutHtmlPath = '/var/www/ovipay/apps/checkout-portal/src/views/checkout.html';
if (fs.existsSync(checkoutHtmlPath)) {
  let content = fs.readFileSync(checkoutHtmlPath, 'utf8');

  const targetBodyStructure = `  <!-- YOUPI PG CHECKOUT CARD / DRAWER WRAPPER -->
  <div class="ypg-wrapper">

    <!-- include:partials/sidebar.html -->

    <!-- include:partials/header.html -->

    <!-- 3. SCROLLABLE BODY -->
    <div class="ypg-body">
      <!-- include:partials/auth.html -->
      <!-- include:partials/payment-methods.html -->
    </div>

    <!-- include:partials/footer.html -->

    <!-- include:partials/modals.html -->

  </div>`;

  const cleanBodyStructure = `  <!-- YOUPI PG CHECKOUT CARD / DRAWER WRAPPER -->
  <div class="ypg-wrapper">

    <!-- include:partials/sidebar.html -->

    <!-- PC RIGHT WORKSPACE (Contains Topbar, Header, Body & Footer) -->
    <div class="ypg-pc-workspace">
      <!-- include:partials/header.html -->

      <!-- 3. SCROLLABLE BODY -->
      <div class="ypg-body">
        <!-- include:partials/auth.html -->
        <!-- include:partials/payment-methods.html -->
      </div>

      <!-- include:partials/footer.html -->
    </div><!-- END ypg-pc-workspace -->

    <!-- include:partials/modals.html -->

  </div>`;

  if (content.includes(targetBodyStructure)) {
    content = content.replace(targetBodyStructure, cleanBodyStructure);
  } else {
    // Robust regex replacement
    content = content.replace(
      /<!--\s*include:partials\/sidebar\.html\s*-->[\r\n\s]*<!--\s*include:partials\/header\.html\s*-->[\r\n\s]*<!--\s*3\.\s*SCROLLABLE BODY\s*-->[\r\n\s]*<div class="ypg-body">([\s\S]*?)<\/div>[\r\n\s]*<!--\s*include:partials\/footer\.html\s*-->/,
      `<!-- include:partials/sidebar.html -->\n\n    <!-- PC RIGHT WORKSPACE -->\n    <div class="ypg-pc-workspace">\n      <!-- include:partials/header.html -->\n\n      <!-- 3. SCROLLABLE BODY -->\n      <div class="ypg-body">$1</div>\n\n      <!-- include:partials/footer.html -->\n    </div><!-- END ypg-pc-workspace -->`
    );
  }

  fs.writeFileSync(checkoutHtmlPath, content, 'utf8');
  console.log('✓ Fixed checkout.html wrapper and workspace architecture');
}

// 5. ENHANCE checkout.css - enforce strict flex layout and prevent footer column drift
const checkoutCssPath = '/var/www/ovipay/apps/checkout-portal/public/css/checkout.css';
if (fs.existsSync(checkoutCssPath)) {
  let content = fs.readFileSync(checkoutCssPath, 'utf8');

  const layoutFixCss = `
/* ==========================================================================
   STRICT DESKTOP & MOBILE WORKSPACE LAYOUT STABILITY FIX
   ========================================================================== */
.ypg-wrapper {
  box-sizing: border-box !important;
}

.ypg-pc-workspace {
  flex: 1 1 auto !important;
  height: 100% !important;
  max-height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
  background: #ffffff !important;
  overflow: hidden !important;
  min-width: 0 !important;
  position: relative !important;
}

.ypg-body {
  flex: 1 1 auto !important;
  height: auto !important;
  max-height: none !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  padding: 0 !important;
}

#paymentGatewayInterface:not([hidden]) {
  flex: 1 1 auto !important;
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
  min-height: 0 !important;
  width: 100% !important;
}

.ypg-pc-columns {
  display: flex !important;
  flex-direction: row !important;
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.ypg-pc-methods-list {
  width: 200px !important;
  min-width: 200px !important;
  max-width: 200px !important;
  flex-shrink: 0 !important;
  border-right: 1px solid #f1f5f9 !important;
  padding: 14px 12px !important;
  overflow-y: auto !important;
  background: #ffffff !important;
  box-sizing: border-box !important;
}

.ypg-pc-active-view {
  flex: 1 1 0% !important;
  min-width: 0 !important;
  width: 100% !important;
  height: 100% !important;
  padding: 16px 24px !important;
  overflow-y: auto !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
}

.ypg-sticky-footer {
  width: 100% !important;
  background: #ffffff !important;
  border-top: 1px solid #f1f5f9 !important;
  padding: 10px 20px !important;
  box-sizing: border-box !important;
  flex-shrink: 0 !important;
  margin-top: auto !important;
  position: relative !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  z-index: 50 !important;
}

.ypg-legal-disclaimer {
  font-size: 11px !important;
  color: #94a3b8 !important;
  text-align: center !important;
  margin: 0 auto !important;
  line-height: 1.4 !important;
}

/* Ensure the QR card and Intent container use full available width */
.ypg-qr-card-container {
  width: 100% !important;
  box-sizing: border-box !important;
}

.ypg-upi-intent-container {
  width: 100% !important;
  box-sizing: border-box !important;
}
`;

  if (!content.includes('STRICT DESKTOP & MOBILE WORKSPACE LAYOUT STABILITY FIX')) {
    content += layoutFixCss;
    fs.writeFileSync(checkoutCssPath, content, 'utf8');
    console.log('✓ Added strict layout stability CSS to checkout.css');
  }
}

console.log('=== CHECKOUT LAYOUT REPAIR COMPLETE ===');
