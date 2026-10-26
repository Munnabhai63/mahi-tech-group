import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnv);
}

import { startAdminServer } from '../apps/merchant-admin/src/index.js';
startAdminServer().then(() => {
  console.log('✅ OviPay Merchant Admin started successfully on port', process.env.MERCHANT_ADMIN_PORT || 6001);
}).catch(err => {
  console.error('❌ Failed to start OviPay Merchant Admin:', err);
  process.exit(1);
});
