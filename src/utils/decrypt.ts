import CryptoJS from 'crypto-js';

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

/**
 * Decrypts a JioSaavn encrypted_media_url using DES ECB PKCS7
 */
export function decryptMediaUrl(encrypted: string): string {
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
