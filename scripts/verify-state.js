const paymentId = '96c92ff3-f011-4aeb-b1e6-d02db5a7680b';
const res = await fetch(`http://127.0.0.1:6100/api/v1/checkout/${paymentId}/state`);
const state = await res.json();
const upiUri = state?.upiUri || `upi://pay?pa=${encodeURIComponent(state?.payeeVpa || 'merchant@upi')}&pn=${encodeURIComponent(state?.merchantName || 'Store')}&am=${encodeURIComponent(state?.amount || '100.00')}&cu=INR&tn=${encodeURIComponent(paymentId)}`;

console.log('PAYMENT STATE VERIFICATION:');
console.log('Merchant / Business Name:', state.merchantName);
console.log('Payee UPI ID (VPA):', state.payeeVpa);
console.log('Amount:', state.amount, 'INR');
console.log('Support Email:', state.supportEmails);
console.log('App Name:', state.branding?.appName);
console.log('Exact UPI URI in QR Code:', upiUri);
console.log('Checkout URL:', `https://ovipay.oviaxe.com/checkout/${paymentId}`);
