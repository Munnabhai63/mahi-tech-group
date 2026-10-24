/**
 * Security headers middleware.
 * Enforces defense-in-depth HTTP headers without breaking external WebRTC (Jitsi Meet) or WebSocket streams.
 */

export function securityHeaders(req, res, next) {
  // Prevent browser MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Guard against clickjacking while allowing same-origin embedding
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Legacy XSS filter protection for older clients
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Control referrer information leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy: allow camera/microphone for Jitsi Meet WebRTC, disable sensitive unused sensors
  res.setHeader(
    'Permissions-Policy',
    'camera=(self "https://meet.jit.si"), microphone=(self "https://meet.jit.si"), geolocation=(), payment=()'
  );

  // Prevent information disclosure about server framework
  res.removeHeader('X-Powered-By');

  next();
}

export default securityHeaders;
