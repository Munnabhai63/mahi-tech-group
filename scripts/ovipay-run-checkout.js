import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnv);
}

import { startCheckoutServer } from '../apps/checkout-portal/src/index.js';
startCheckoutServer().then(() => {
  console.log('✅ OviPay Checkout Portal started successfully on port', process.env.CHECKOUT_PORTAL_PORT || 7000);
}).catch(err => {
  console.error('❌ Failed to start OviPay Checkout Portal:', err);
  process.exit(1);
});
