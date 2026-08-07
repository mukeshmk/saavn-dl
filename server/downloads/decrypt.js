/**
 * Server port of src/utils/decrypt.ts.
 *
 * Identical DES-ECB (PKCS7) decryption of JioSaavn encrypted_media_url, quality URL
 * swapping, and filename sanitization. Reuses the `crypto-js` dependency so the logic
 * stays byte-for-byte compatible with the client pipeline.
 */

import CryptoJS from 'crypto-js';

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

/**
 * Decrypts a JioSaavn encrypted_media_url using DES ECB PKCS7.
 */
export function decryptMediaUrl(encrypted) {
  // Pad base64 string if needed
  const padLen = (4 - (encrypted.length % 4)) % 4;
  const padded = encrypted + '='.repeat(padLen);

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(padded),
  });

  const decrypted = CryptoJS.DES.decrypt(cipherParams, DES_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  return decrypted.toString(CryptoJS.enc.Utf8);
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
