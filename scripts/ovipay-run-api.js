import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnv);
}

import { startServer } from '../apps/payment-api/src/index.js';
startServer().then(() => {
  console.log('✅ OviPay Payment API started successfully on port', process.env.PAYMENT_API_PORT || 6100);
}).catch(err => {
  console.error('❌ Failed to start OviPay Payment API:', err);
  process.exit(1);
});
