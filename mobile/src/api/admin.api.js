import apiClient from './axios.config.js';

export const adminApi = {
  // Expense Approval
  approveExpense: (expenseId) => apiClient.patch(`/api/finance/expense/${expenseId}/approve`),
  rejectExpense: (expenseId, reason) => apiClient.patch(`/api/finance/expense/${expenseId}/reject`, { reason }),
  getProjectExpenses: (projectId, params) => apiClient.get(`/api/finance/expenses/project/${projectId}`, { params }),

  // Timesheet / Time Entry Approval
  getPendingTimeApprovals: () => apiClient.get('/api/time/approval/pending'),
  approveTimeEntry: (requestId) => apiClient.patch(`/api/time/approval/${requestId}/approve`),
  rejectTimeEntry: (requestId, reason) => apiClient.patch(`/api/time/approval/${requestId}/reject`, {
    decision_note: reason,
    reason
  }),

  // Client Orders Triage
  getClientOrders: (params) => apiClient.get('/api/admin/orders', { params }),
  updateOrderStatus: (orderId, status, notes) => apiClient.patch(`/api/admin/orders/${orderId}/status`, {
    status,
    internal_notes: notes
  })
};

export default adminApi;
