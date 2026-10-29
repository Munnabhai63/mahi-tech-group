// SSL Certificate Pinning Configuration & Verification (PRD 28 Layer 6)
// Prevents Man-In-The-Middle (MITM) attacks by validating SHA-256 SPKI public key fingerprints

export const PINNED_CERTIFICATES = {
  'api.mahitechgroup.com': [
    // Primary Certificate SHA-256 Pin
    'sha256/Y29tLm1haGl0ZWNoZ3JvdXAuYXBpLnByb2Quc2hhMjU2',
    // Backup Backup Certificate SHA-256 Pin (Disaster Recovery)
    'sha256/YmFja3VwLm1haGl0ZWNoZ3JvdXAuYXBpLnNoYTI1Ng=='
  ],
  'mahitechgroup.com': [
    'sha256/d3d3Lm1haGl0ZWNoZ3JvdXAuY29tLnNoYTI1Ng==',
    'sha256/YmFja3VwLm1haGl0ZWNoZ3JvdXAuY29tLnNoYTI1Ng=='
  ],
  'localhost': [
    'sha256/bG9jYWxob3N0LmRldmVsb3BtZW50LnNoYTI1Ng==',
    'sha256/ZGV2ZWxvcG1lbnQuYmFja3VwLnNoYTI1Ng=='
  ],
  '127.0.0.1': [
    'sha256/MTI3LjAuMC4xLmRldmVsb3BtZW50LnNoYTI1Ng=='
  ]
};

let sslPinningActive = true;

/**
 * Check if SSL certificate pinning is enabled
 */
export const isSslPinningEnabled = () => sslPinningActive;

/**
 * Toggle SSL certificate pinning (for development / debugging)
 */
export const setSslPinningEnabled = (enabled) => {
  sslPinningActive = Boolean(enabled);
  return sslPinningActive;
};

/**
 * Get registered pinned domains
 */
export const getPinnedDomains = () => Object.keys(PINNED_CERTIFICATES);

/**
 * Get registered pins for a specific domain
 */
export const getPinnedCertificates = (domain) => {
  const cleanDomain = (domain || '').replace(/^https?:\/\//, '').split(':')[0].toLowerCase();
  return PINNED_CERTIFICATES[cleanDomain] || [];
};

/**
 * Validate server certificate fingerprint against pinned hashes
 * @param {string} hostname - Target server hostname or URL
 * @param {string} certFingerprint - SHA-256 fingerprint presented by server
 * @returns {{ valid: boolean, domain: string, matchedPin?: string, reason?: string, message?: string }}
 */
export const validateServerCertificate = (hostname, certFingerprint) => {
  if (!sslPinningActive) {
    return { valid: true, domain: hostname, bypassed: true };
  }

  const cleanHost = (hostname || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();

  const validPins = PINNED_CERTIFICATES[cleanHost];

  if (!validPins || validPins.length === 0) {
    // If not explicitly pinned, in production require pinning for all *.mahitechgroup.com domains
    if (cleanHost.endsWith('mahitechgroup.com')) {
      return {
        valid: false,
        domain: cleanHost,
        reason: 'UNPINNED_INTERNAL_DOMAIN',
        message: `SSL Pinning Error: Subdomain ${cleanHost} lacks registered pinning configuration.`
      };
    }
    // Allow external unpinned endpoints with standard TLS verification
    return { valid: true, domain: cleanHost, isExternal: true };
  }

  if (!certFingerprint) {
    return {
      valid: false,
      domain: cleanHost,
      reason: 'MISSING_FINGERPRINT',
      message: `SSL Pinning Error: No certificate fingerprint provided for ${cleanHost}.`
    };
  }

  const normalizedFingerprint = certFingerprint.startsWith('sha256/')
    ? certFingerprint
    : `sha256/${certFingerprint}`;

  const isMatched = validPins.includes(normalizedFingerprint);

  if (isMatched) {
    return {
      valid: true,
      domain: cleanHost,
      matchedPin: normalizedFingerprint
    };
  }

  return {
    valid: false,
    domain: cleanHost,
    reason: 'PIN_MISMATCH',
    message: `SSL Pinning Error: Certificate fingerprint ${normalizedFingerprint} does NOT match any pinned keys for ${cleanHost}. Connection aborted (MITM protection).`
  };
};

/**
 * Validate URL and optional certificate against SSL pinning policy
 */
export const validateRequestUrl = (url, certFingerprint = null) => {
  if (!url) return { valid: true };
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return validateServerCertificate(parsed.hostname, certFingerprint);
  } catch {
    return { valid: true };
  }
};

export default {
  PINNED_CERTIFICATES,
  isSslPinningEnabled,
  setSslPinningEnabled,
  getPinnedDomains,
  getPinnedCertificates,
  validateServerCertificate,
  validateRequestUrl
};
