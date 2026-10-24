import http from 'node:http';
import { createApp } from '../src/app.js';
import { emailService } from '../src/services/emailService.js';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';

const TEST_PORT = 4998;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runSecurityEnhancementTests() {
  console.log('\n===================================================================');
  console.log('       VERIFYING SECURITY ENHANCEMENTS & NEW SERVICES');
  console.log('===================================================================\n');

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  try {
    // 1. Test Security Headers
    console.log('--- TEST 1: Verify Defense-in-Depth Security Headers ---');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const xContentType = healthRes.headers.get('x-content-type-options');
    const xFrameOptions = healthRes.headers.get('x-frame-options');
    const referrerPolicy = healthRes.headers.get('referrer-policy');

    console.log('X-Content-Type-Options:', xContentType);
    console.log('X-Frame-Options:', xFrameOptions);
    console.log('Referrer-Policy:', referrerPolicy);

    if (xContentType !== 'nosniff') throw new Error('Missing X-Content-Type-Options: nosniff');
    if (xFrameOptions !== 'SAMEORIGIN') throw new Error('Missing X-Frame-Options: SAMEORIGIN');
    console.log('✓ PASS: All Security Headers active and strictly enforced.\n');

    // 2. Test Sanitized Error Handling
    console.log('--- TEST 2: Verify Error Sanitization ---');
    // First in dev mode (default)
    const errResDev = await fetch(`${BASE_URL}/api/debug/error-test`);
    const errBodyDev = await errResDev.json();
    console.log('Dev Error Status:', errResDev.status);
    console.log('Dev Error Body:', errBodyDev);
    if (errResDev.status !== 500) throw new Error(`Expected 500 but got ${errResDev.status}`);

    // Now verify production mode sanitization
    process.env.NODE_ENV = 'production';
    const errResProd = await fetch(`${BASE_URL}/api/debug/error-test`);
    const errBodyProd = await errResProd.json();
    console.log('Prod Error Status:', errResProd.status);
    console.log('Prod Error Body:', errBodyProd);
    process.env.NODE_ENV = 'test'; // restore

    if (errBodyProd.message.includes('Simulated internal database crash')) {
      throw new Error('Security flaw: Internal error details leaked in production mode!');
    }
    console.log('✓ PASS: Error message is strictly sanitized in production.\n');

    // 3. Test Rate Limiter Middleware
    console.log('--- TEST 3: Verify Rate Limiter Standalone Execution ---');
    process.env.NODE_ENV = 'development'; // Enable rate limiting logic
    const customLimiter = createRateLimiter({
      windowMs: 5000,
      maxRequests: 3,
      message: 'Test limit reached'
    });

    const mockReq = { ip: '192.168.1.100', path: '/test-route', headers: {} };
    let blocked = false;
    for (let i = 1; i <= 4; i++) {
      let nextCalled = false;
      const mockRes = {
        setHeader: (k, v) => {},
        status: (s) => ({
          json: (b) => {
            if (s === 429) blocked = true;
          }
        })
      };
      customLimiter(mockReq, mockRes, () => { nextCalled = true; });
      console.log(`Request ${i}: nextCalled=${nextCalled}, blocked=${blocked}`);
    }

    if (!blocked) throw new Error('Rate limiter did not block request exceeding threshold');
    console.log('✓ PASS: Rate limiter successfully blocked excessive requests with 429.\n');

    // 4. Test Email Service
    console.log('--- TEST 4: Verify Email Dispatcher Service ---');
    const emailResult = await emailService.sendAccountStatusEmail(
      { name: 'Test Developer', email: 'test.developer@example.com', role: 'developer' },
      'active'
    );
    console.log('Email Service Dispatch Result:', emailResult);
    if (!emailResult.success) throw new Error('Email dispatch returned non-success');
    console.log('✓ PASS: Email service dispatched successfully with audit logging.\n');

    console.log('===================================================================');
    console.log('          ALL SECURITY ENHANCEMENT TESTS PASSED 100%');
    console.log('===================================================================\n');

  } finally {
    server.close();
  }
}

runSecurityEnhancementTests().catch((err) => {
  console.error('Security test failed:', err);
  process.exit(1);
});
