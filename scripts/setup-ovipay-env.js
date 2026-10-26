import crypto from 'node:crypto';
import fs from 'node:fs';

const masterKey = crypto.randomBytes(32).toString('hex');
const jwtSecret = crypto.randomBytes(32).toString('hex');
const adminPassword = crypto.randomBytes(16).toString('hex');

const envContent = `# OVIPAY PRODUCTION CONFIGURATION
NODE_ENV=production
YOUPI_MODE=localhost
YOUPI_ALLOW_LOCALHOST_MODE=true

# HOST & PORTS
YOUPI_BIND_HOST=127.0.0.1
PAYMENT_API_PORT=6100
CHECKOUT_PORTAL_PORT=7000
MERCHANT_ADMIN_PORT=6001

# URLS
BASE_PAYMENT_API_URL=https://ovipay.oviaxe.com/api
BASE_CHECKOUT_URL=https://ovipay.oviaxe.com
MERCHANT_ORIGINS=https://oviaxe.com,https://www.oviaxe.com

# DATABASE
SQLITE_DB_PATH=/var/www/ovipay/data/ovipay.sqlite

# SECRETS
ENCRYPTION_MASTER_KEY=${masterKey}
JWT_SECRET=${jwtSecret}

# INITIAL ADMIN
INITIAL_ADMIN_EMAIL=admin@oviaxe.com
INITIAL_ADMIN_PASSWORD=${adminPassword}

# PAYMENT TIMING
PAYMENT_ACTIVE_WINDOW_MS=300000
PAYMENT_PROCESSING_WINDOW_MS=30000
`;

fs.writeFileSync('/var/www/ovipay/.env', envContent, 'utf8');
console.log('ENV_FILE_CREATED_SUCCESSFULLY');
console.log('INITIAL_ADMIN_EMAIL=admin@oviaxe.com');
console.log('INITIAL_ADMIN_PASSWORD=' + adminPassword);
