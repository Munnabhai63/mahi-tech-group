export const formatCurrency = (amount, currency = 'USD') => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(num);
};

export const formatStoryPoints = (points) => {
  const pts = Number(points);
  if (isNaN(pts)) return '0 pts';
  return `${pts} pt${pts === 1 ? '' : 's'}`;
};

export default {
  formatCurrency,
  formatStoryPoints
};
