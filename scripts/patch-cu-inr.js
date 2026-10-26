import fs from 'node:fs';

const serverFile = '/var/www/ovipay/apps/checkout-portal/src/server.js';
let content = fs.readFileSync(serverFile, 'utf8');

const target = "const upiUri = state?.upiUri || `upi://pay?pa=${encodeURIComponent(state?.payeeVpa || 'merchant@upi')}&pn=${encodeURIComponent(state?.merchantName || 'Store')}&am=${encodeURIComponent(state?.amount || '100.00')}&tn=${encodeURIComponent(paymentId)}`;";
const replacement = "const upiUri = state?.upiUri || `upi://pay?pa=${encodeURIComponent(state?.payeeVpa || 'merchant@upi')}&pn=${encodeURIComponent(state?.merchantName || 'Store')}&am=${encodeURIComponent(state?.amount || '100.00')}&cu=INR&tn=${encodeURIComponent(paymentId)}`;";

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(serverFile, content, 'utf8');
  console.log('PATCHED_CHECKOUT_PORTAL_UPI_URI');
} else {
  console.log('ALREADY_PATCHED_OR_NOT_FOUND');
}
