// Cryptographic utilities for Dencken node
// Handles signing, verification, hashing, key derivation
// TODO Phase 1b: Upgrade key derivation to HKDF from SHA-256

const crypto = require('crypto');

const HASH_ALGORITHM = 'sha256';
const SIGN_ALGORITHM = 'ed25519';

/**
 * Derive an encryption key from a master key + salt
 * TODO Phase 1b: Replace with HKDF per NIST guidelines
 *
 * Current: SHA-256(masterKey + salt)
 * Future: HKDF-SHA256 with proper info/salt/prk separation
 */
const deriveKey = (masterKey, salt = '') => {
  if (!masterKey) {
    throw new Error('Master key required for key derivation');
  }
  // Current method: simple SHA-256
  const input = typeof masterKey === 'string' ? masterKey : masterKey.toString();
  return crypto.createHash(HASH_ALGORITHM).update(input + salt).digest();
};

/**
 * Hash content using SHA-256
 */
const hashContent = (content) => {
  if (typeof content === 'object') {
    content = JSON.stringify(content);
  }
  return crypto.createHash(HASH_ALGORITHM).update(content).digest('hex');
};

/**
 * Sign content using Ed25519 private key
 * Requires NODE_PRIVATE_KEY environment variable (base64-encoded Ed25519 private key)
 */
const signContent = (content, privateKey = null) => {
  const key = privateKey || process.env.NODE_PRIVATE_KEY;
  if (!key) {
    throw new Error('NODE_PRIVATE_KEY environment variable required for signing');
  }

  try {
    const keyBuffer = Buffer.from(key, 'base64');
    const contentStr = typeof content === 'object' ? JSON.stringify(content) : content;
    const signature = crypto.sign(SIGN_ALGORITHM, Buffer.from(contentStr), keyBuffer);
    return signature.toString('hex');
  } catch (error) {
    throw new Error(`Failed to sign content: ${error.message}`);
  }
};

/**
 * Verify signature using Ed25519 public key
 * Requires NODE_PUBLIC_KEY environment variable (base64-encoded Ed25519 public key)
 */
const verifySignature = (content, signature, publicKey = null) => {
  const key = publicKey || process.env.NODE_PUBLIC_KEY;
  if (!key) {
    throw new Error('NODE_PUBLIC_KEY environment variable required for verification');
  }

  try {
    const keyBuffer = Buffer.from(key, 'base64');
    const contentStr = typeof content === 'object' ? JSON.stringify(content) : content;
    const signatureBuffer = Buffer.from(signature, 'hex');
    return crypto.verify(SIGN_ALGORITHM, Buffer.from(contentStr), keyBuffer, signatureBuffer);
  } catch (error) {
    console.error('Signature verification error:', error.message);
    return false;
  }
};

/**
 * AES-256-GCM encryption (follows constitutionStore.js pattern)
 */
const encryptAES256GCM = (plaintext, encryptionKey) => {
  const key = typeof encryptionKey === 'string' ? deriveKey(encryptionKey) : encryptionKey;
  const iv = crypto.randomBytes(12); // 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    ciphertext: encrypted,
    authTag,
  };
};

/**
 * AES-256-GCM decryption
 */
const decryptAES256GCM = (encryptedData, encryptionKey) => {
  const key = typeof encryptionKey === 'string' ? deriveKey(encryptionKey) : encryptionKey;

  if (!encryptedData.iv || !encryptedData.ciphertext || !encryptedData.authTag) {
    throw new Error('Invalid encrypted data format (missing iv, ciphertext, or authTag)');
  }

  try {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    const decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
    return decrypted;
  } catch (error) {
    throw new Error(`Failed to decrypt: ${error.message}`);
  }
};

/**
 * Generate Ed25519 key pair (for node identity, not general use)
 * Returns { publicKey, privateKey } both base64-encoded
 */
const generateKeyPair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync(SIGN_ALGORITHM);
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
};

module.exports = {
  deriveKey,
  hashContent,
  signContent,
  verifySignature,
  encryptAES256GCM,
  decryptAES256GCM,
  generateKeyPair,
  HASH_ALGORITHM,
  SIGN_ALGORITHM,
};
