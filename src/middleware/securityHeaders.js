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

  // Content Security Policy: everything from same origin; Jitsi Meet is the only
  // trusted external source (frame + script + websocket). 'unsafe-inline' for
  // script/style is required until the remaining inline handlers are refactored out.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://meet.jit.si",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss: https://meet.jit.si",
      "frame-src 'self' https://meet.jit.si",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'"
    ].join('; ')
  );

  // HSTS only once traffic is known to be HTTPS (production behind TLS proxy)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Prevent information disclosure about server framework
  res.removeHeader('X-Powered-By');

  next();
}

export default securityHeaders;
