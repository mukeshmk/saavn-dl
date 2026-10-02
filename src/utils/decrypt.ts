import CryptoJS from 'crypto-js';

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

/**
 * Decrypts a JioSaavn encrypted_media_url using DES ECB PKCS7.
 * Normalizes the base64 input (whitespace, URL-safe alphabet, padding) and
 * validates the PKCS padding explicitly instead of trusting auto-unpad.
 */
export function decryptMediaUrl(encrypted: string): string {
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
 * Given a decrypted media URL, swap quality suffix
 * e.g. _96.mp4 → _320.mp4
 */
export function getQualityUrl(decryptedUrl: string, quality: string): string {
  // JioSaavn URLs end with _<quality>.mp4
  return decryptedUrl.replace(/_\d+\.mp4(\?.*)?$/, `_${quality}.mp4`);
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}
