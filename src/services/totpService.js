import crypto from 'node:crypto';

/**
 * TOTP (RFC 6238) — pure Node implementation, no dependencies.
 * SHA-1, 6 digits, 30-second step, ±1 step drift tolerance.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret() {
  const buf = crypto.randomBytes(20);
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(str) {
  let bits = '';
  for (const ch of str.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, counter = Math.floor(Date.now() / 30000)) {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, code, window = 1) {
  const current = Math.floor(Date.now() / 30000);
  for (let drift = -window; drift <= window; drift++) {
    const expected = totpCode(secret, current + drift);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code).padStart(6, '0')))) {
      return true;
    }
  }
  return false;
}

export function otpauthUrl(secret, account, issuer = 'Mahi Tech Group') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
