/**
 * Real-time WebSocket Client for MAHI TECH GROUP
 * Multiplexed channel support, heartbeat, exponential reconnect,
 * and live-refetch fallback polling.
 */

import { getAuthToken } from './api.js';

class RealtimeClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pollingTimer = null;
    this.isConnected = false;
    this.isPollingFallback = false;
  }

  connect() {
    const token = getAuthToken();
    if (!token) {
      this.disconnect();
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.stopPollingFallback();
        this.startHeartbeat();
        this.emit('connected', { time: Date.now() });
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pong') return;
          this.emit(payload.event || payload.type || 'message', payload.data || payload);
        } catch {
          /* Raw message */
          this.emit('message', event.data);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] WebSocket error encountered:', err);
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('disconnected', { code: event.code, reason: event.reason });

        // Auto reconnect with exponential backoff
        if (getAuthToken()) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.warn('[WS] Failed to instantiate WebSocket:', err);
      this.startPollingFallback();
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WS] Max reconnect attempts reached. Switching to polling fallback.');
      this.startPollingFallback();
      return;
    }

    const backoff = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  stopHeartbeat() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  startPollingFallback() {
    if (this.isPollingFallback) return;
    this.isPollingFallback = true;
    console.warn('[WS] Connection failed or unavailable. Degrading to 15s polling with live refetch.');
    this.pollingTimer = setInterval(() => {
      if (getAuthToken()) {
        window.dispatchEvent(new CustomEvent('app:refresh', { detail: { source: 'polling' } }));
      }
    }, 15000);
  }

  stopPollingFallback() {
    this.isPollingFallback = false;
    clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    }
    return false;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(callback);
    }
  }

  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[WS] Event handler error:', e); }
      });
    }
    // Also trigger global window event
    window.dispatchEvent(new CustomEvent(`ws:${event}`, { detail: data }));
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.stopPollingFallback();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export const realtime = new RealtimeClient();
