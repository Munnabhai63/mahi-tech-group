const res = await fetch('http://127.0.0.1:6100/api/v1/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    orderId: 'ORDER-MAHIPAL-LIVE-001',
    amount: '1.00',
    currency: 'INR'
  })
});

console.log('Status:', res.status);
const data = await res.json();
console.log('Response:', JSON.stringify(data, null, 2));
