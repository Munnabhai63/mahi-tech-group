const res = await fetch('http://127.0.0.1:6100/api/v1/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    orderId: 'MAHIPAL-UPI-LIVE-' + Math.floor(1000 + Math.random() * 9000),
    amount: '1.00',
    currency: 'INR'
  })
});

const data = await res.json();
console.log('PAYMENT_CREATED_SUCCESSFULLY:');
console.log(JSON.stringify(data, null, 2));
