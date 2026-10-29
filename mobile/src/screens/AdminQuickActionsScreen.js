import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { authApi } from '../api/auth.api.js';
import { adminApi } from '../api/admin.api.js';

export const AdminQuickActionsScreen = ({
  navigation,
  initialRole = null,
  isOnline = true
}) => {
  const [role, setRole] = useState(initialRole);
  const [roleVerified, setRoleVerified] = useState(!!initialRole);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [timeApprovals, setTimeApprovals] = useState([]);
  const [clientOrders, setClientOrders] = useState([]);
  const [actionFeedback, setActionFeedback] = useState(null);

  const verifyRoleAndLoad = useCallback(async () => {
    try {
      setError(null);
      if (isOnline) {
        const meRes = await authApi.getMe();
        const currentRole = (meRes.data?.user?.role || meRes.data?.role || '').toLowerCase();
        setRole(currentRole);
        setRoleVerified(true);

        if (currentRole !== 'admin' && currentRole !== 'super_admin') {
          setLoading(false);
          setRefreshing(false);
          return;
        }

        const [timesRes, ordersRes] = await Promise.allSettled([
          adminApi.getPendingTimeApprovals(),
          adminApi.getClientOrders({ limit: 10 })
        ]);

        if (timesRes.status === 'fulfilled') {
          const tList = Array.isArray(timesRes.value.data?.requests)
            ? timesRes.value.data.requests
            : Array.isArray(timesRes.value.data)
              ? timesRes.value.data
              : [];
          setTimeApprovals(tList);
        }

        if (ordersRes.status === 'fulfilled') {
          const oList = Array.isArray(ordersRes.value.data?.orders)
            ? ordersRes.value.data.orders
            : Array.isArray(ordersRes.value.data)
              ? ordersRes.value.data
              : [];
          setClientOrders(oList);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to authenticate admin session');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline]);

  useEffect(() => {
    if (!initialRole) {
      verifyRoleAndLoad();
    } else {
      setRoleVerified(true);
      setLoading(false);
    }
  }, [initialRole, verifyRoleAndLoad]);

  const handleApproveTime = async (reqId) => {
    try {
      await adminApi.approveTimeEntry(reqId);
      setTimeApprovals((prev) => prev.filter((t) => t.id !== reqId));
      setActionFeedback(`Timesheet #${reqId} approved successfully`);
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (err) {
      setActionFeedback(`Approval failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRejectTime = async (reqId) => {
    try {
      await adminApi.rejectTimeEntry(reqId, 'Rejected by Admin via mobile quick triage');
      setTimeApprovals((prev) => prev.filter((t) => t.id !== reqId));
      setActionFeedback(`Timesheet #${reqId} rejected`);
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (err) {
      setActionFeedback(`Rejection failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleTriageOrder = async (orderId, newStatus) => {
    try {
      await adminApi.updateOrderStatus(orderId, newStatus, 'Triaged via mobile admin screen');
      setClientOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      setActionFeedback(`Order #${orderId} moved to ${newStatus}`);
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (err) {
      setActionFeedback(`Order triage failed: ${err.response?.data?.error || err.message}`);
    }
  };

  if (loading && !roleVerified) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Admin Control Center'),
        React.createElement(Text, { style: styles.subtitle }, 'Verifying administrative permissions...')
      ),
      React.createElement(DashboardSkeleton, null)
    );
  }

  const normalizedRole = (role || '').toLowerCase();
  const isAdmin = normalizedRole === 'admin' || normalizedRole === 'super_admin';

  // STRICT RULE: Regular members get 403 Forbidden Screen
  if (roleVerified && !isAdmin) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.forbiddenContainer },
        React.createElement(Text, { style: styles.forbiddenEmoji }, '🔒'),
        React.createElement(Text, { style: styles.forbiddenCode }, '403 Forbidden'),
        React.createElement(Text, { style: styles.forbiddenTitle }, 'Administrative Access Required'),
        React.createElement(
          Text,
          { style: styles.forbiddenMessage },
          `Your verified server role is "${role || 'MEMBER'}". Only accounts with ADMIN or SUPER_ADMIN privileges can access approvals and client order triage.`
        ),
        React.createElement(
          TouchableOpacity,
          {
            style: styles.backBtn,
            onPress: () => (navigation?.goBack ? navigation.goBack() : null)
          },
          React.createElement(Text, { style: styles.backBtnText }, 'Return to Home')
        )
      )
    );
  }

  if (error && !roleVerified) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(ErrorState, { message: error, onRetry: verifyRoleAndLoad })
    );
  }

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      ScrollView,
      {
        style: styles.scroll,
        refreshControl: React.createElement(RefreshControl, {
          refreshing,
          onRefresh: () => {
            setRefreshing(true);
            verifyRoleAndLoad();
          },
          tintColor: DARK_ACCENT
        })
      },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Admin Quick Actions'),
        React.createElement(
          Text,
          { style: styles.subtitle },
          'Server-Verified Admin • Approvals & Client Order Triage'
        )
      ),

      actionFeedback &&
        React.createElement(
          View,
          { style: styles.feedbackBanner },
          React.createElement(Text, { style: styles.feedbackText }, actionFeedback)
        ),

      // Timesheet Approvals
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(
          View,
          { style: styles.sectionHeaderRow },
          React.createElement(Text, { style: styles.sectionTitle }, 'Timesheet Approvals'),
          React.createElement(Text, { style: styles.counterBadge }, `${timeApprovals.length} pending`)
        ),
        timeApprovals.length === 0
          ? React.createElement(
              View,
              { style: styles.card },
              React.createElement(Text, { style: styles.emptyCardText }, 'No pending timesheet approvals')
            )
          : timeApprovals.map((req) =>
              React.createElement(
                View,
                { key: `time_req_${req.id}`, style: styles.approvalCard },
                React.createElement(
                  View,
                  { style: styles.cardHeader },
                  React.createElement(Text, { style: styles.cardName }, req.user_name || `Member #${req.user_id}`),
                  React.createElement(Text, { style: styles.hoursBadge }, `${req.hours || req.duration_hrs || '8'} hrs`)
                ),
                React.createElement(Text, { style: styles.cardDesc }, req.description || 'Logged sprint task hours'),
                React.createElement(
                  View,
                  { style: styles.actionButtonsRow },
                  React.createElement(
                    TouchableOpacity,
                    { style: styles.approveBtn, onPress: () => handleApproveTime(req.id) },
                    React.createElement(Text, { style: styles.approveBtnText }, 'Approve')
                  ),
                  React.createElement(
                    TouchableOpacity,
                    { style: styles.rejectBtn, onPress: () => handleRejectTime(req.id) },
                    React.createElement(Text, { style: styles.rejectBtnText }, 'Reject')
                  )
                )
              )
            )
      ),

      // Client Orders Triage
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(
          View,
          { style: styles.sectionHeaderRow },
          React.createElement(Text, { style: styles.sectionTitle }, 'Client Order Triage'),
          React.createElement(Text, { style: styles.counterBadge }, `${clientOrders.length} orders`)
        ),
        clientOrders.length === 0
          ? React.createElement(
              View,
              { style: styles.card },
              React.createElement(Text, { style: styles.emptyCardText }, 'No client orders to triage')
            )
          : clientOrders.map((order) =>
              React.createElement(
                View,
                { key: `order_${order.id}`, style: styles.orderCard },
                React.createElement(
                  View,
                  { style: styles.orderCardHeader },
                  React.createElement(Text, { style: styles.orderTitle }, order.title || `Order #${order.id}`),
                  React.createElement(Text, { style: styles.orderStatusBadge }, order.status || 'PENDING')
                ),
                React.createElement(
                  Text,
                  { style: styles.orderClient },
                  `Client: ${order.client_name || order.company_name || 'Acme Corp'}`
                ),
                React.createElement(
                  Text,
                  { style: styles.orderScope, numberOfLines: 2 },
                  order.scope_description || order.description || 'Custom engineering deliverable'
                ),
                React.createElement(
                  View,
                  { style: styles.triageActionsRow },
                  React.createElement(
                    TouchableOpacity,
                    {
                      style: [styles.triageBtn, { borderColor: '#38bdf8' }],
                      onPress: () => handleTriageOrder(order.id, 'IN_PROGRESS')
                    },
                    React.createElement(Text, { style: [styles.triageBtnText, { color: '#38bdf8' }] }, 'In Progress')
                  ),
                  React.createElement(
                    TouchableOpacity,
                    {
                      style: [styles.triageBtn, { borderColor: '#10b981' }],
                      onPress: () => handleTriageOrder(order.id, 'FULFILLED')
                    },
                    React.createElement(Text, { style: [styles.triageBtnText, { color: '#10b981' }] }, 'Fulfill')
                  ),
                  React.createElement(
                    TouchableOpacity,
                    {
                      style: [styles.triageBtn, { borderColor: '#ef4444' }],
                      onPress: () => handleTriageOrder(order.id, 'CANCELLED')
                    },
                    React.createElement(Text, { style: [styles.triageBtnText, { color: '#ef4444' }] }, 'Cancel')
                  )
                )
              )
            )
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND
  },
  scroll: {
    flex: 1,
    padding: 16
  },
  header: {
    marginBottom: 20
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4
  },
  feedbackBanner: {
    backgroundColor: '#0c4a6e',
    borderWidth: 1,
    borderColor: '#0284c7',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16
  },
  feedbackText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  section: {
    marginBottom: 24
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  counterBadge: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '600'
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  emptyCardText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  approvalCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  cardName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600'
  },
  hoursBadge: {
    backgroundColor: '#0f172a',
    color: '#38bdf8',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700'
  },
  cardDesc: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 12
  },
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8
  },
  approveBtn: {
    backgroundColor: '#065f46',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10b981'
  },
  approveBtnText: {
    color: '#d1fae5',
    fontSize: 13,
    fontWeight: '700'
  },
  rejectBtn: {
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444'
  },
  rejectBtnText: {
    color: '#fee2e2',
    fontSize: 13,
    fontWeight: '700'
  },
  orderCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  orderTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600'
  },
  orderStatusBadge: {
    backgroundColor: '#0f172a',
    color: '#fbbf24',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '700'
  },
  orderClient: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4
  },
  orderScope: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12
  },
  triageActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8
  },
  triageBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1
  },
  triageBtnText: {
    fontSize: 11,
    fontWeight: '700'
  },
  forbiddenContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32
  },
  forbiddenEmoji: {
    fontSize: 48,
    marginBottom: 16
  },
  forbiddenCode: {
    color: '#ef4444',
    fontSize: 24,
    fontWeight: '800'
  },
  forbiddenTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6
  },
  forbiddenMessage: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20
  },
  backBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 24
  },
  backBtnText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600'
  }
});

export default AdminQuickActionsScreen;
