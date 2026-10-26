import { CheckoutServer } from '/var/www/ovipay/apps/checkout-portal/src/server.js';

const server = new CheckoutServer();
const state = await server.fetchPaymentState('7fc5a48f-d152-4268-a41a-fc3174780c93');
console.log('=== STATE UPISERVERINDICATOR ===');
console.log(state?.upiServerIndicator);

const indicator = state?.upiServerIndicator || { status: 'WORKING', tier: 'GREEN', label: 'Server Is Working', isWorking: true };
const tier = indicator.tier || (indicator.status === 'WORKING' ? 'GREEN' : (indicator.status === 'BUSY' ? 'YELLOW' : 'RED'));
console.log('Resolved indicator:', indicator);
console.log('Resolved tier:', tier);
console.log('alertStyle:', (tier === 'GREEN' || !tier) ? 'none' : 'flex');
