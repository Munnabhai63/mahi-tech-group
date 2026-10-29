import apiClient from './axios.config.js';

export const expenseApi = {
  submitExpense: (data) => apiClient.post('/api/finance/expense/submit', data),
  getMyExpenses: () => apiClient.get('/api/finance/expenses/my'),
  getCategories: () => apiClient.get('/api/finance/categories')
};

export default expenseApi;
