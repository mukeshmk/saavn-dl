/**
 * Server port of src/utils/decrypt.ts.
 *
 * Identical DES-ECB (PKCS7) decryption of JioSaavn encrypted_media_url (incl. base64
 * normalization and padding validation), quality URL
 * swapping, and filename sanitization. Reuses the `crypto-js` dependency so the logic
 * stays byte-for-byte compatible with the client pipeline.
 */

import CryptoJS from 'crypto-js';

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

/**
 * Decrypts a JioSaavn encrypted_media_url using DES ECB PKCS7.
 * Normalizes the base64 input (whitespace, URL-safe alphabet, padding) and
 * validates the PKCS padding explicitly instead of trusting auto-unpad.
 */
export function decryptMediaUrl(encrypted) {
  // Normalize: trim, strip whitespace, URL-safe → standard alphabet, re-pad.
  let normalized = encrypted.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (normalized.length % 4 === 1) throw new Error('Invalid encrypted media URL encoding');
  normalized += '='.repeat((4 - (normalized.length % 4)) % 4);

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(normalized),
  });

  // Decrypt without auto-unpadding so the PKCS padding can be validated.
  const plain = CryptoJS.DES.decrypt(cipherParams, DES_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  }).toString(CryptoJS.enc.Latin1);

  // Negated form also rejects NaN from an empty plaintext.
  const paddingLength = plain.charCodeAt(plain.length - 1);
  if (!(paddingLength >= 1 && paddingLength <= 8 && paddingLength <= plain.length)) {
    throw new Error('Invalid decrypted media URL padding');
  }
  return plain.slice(0, -paddingLength);
}

/**
 * Given a decrypted media URL, swap the quality suffix.
 * e.g. _96.mp4 -> _320.mp4
 */
export function getQualityUrl(decryptedUrl, quality) {
  return decryptedUrl.replace(/_\d+\.mp4(\?.*)?$/, `_${quality}.mp4`);
}

/**
 * Sanitize a filename for safe use on disk.
 */
export function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

/**
 * Sanitize a single path segment (a folder name or filename) for on-disk use.
 * Uses the exact same illegal-char rule as sanitizeFilename (→ '-') so folder
 * segments and filenames can never diverge, plus path-traversal hardening
 * (strips '..') and a length cap. The caller's resolve()/startsWith() check
 * remains the real traversal backstop.
 */
export function sanitizePathSegment(segment) {
  return sanitizeFilename(String(segment).replace(/\.\./g, '')).slice(0, 255);
}
