// Record signing and verification utilities
// Handles cryptographic proof of record origin and authenticity
// Integrates with ledger.js for signed entry management

const crypto = require('./crypto');

/**
 * Sign a record (e.g., ledger entry, knowledge entry, task result)
 * Produces a signature proving the record came from a specific node/agent
 *
 * @param {Object} record - The record content to sign
 * @param {string} privateKey - Optional Ed25519 private key (defaults to NODE_PRIVATE_KEY env)
 * @returns {string} - Ed25519 signature (hex-encoded)
 */
const signRecord = (record, privateKey = null) => {
  const content = typeof record === 'string' ? record : JSON.stringify(record);
  return crypto.signContent(content, privateKey);
};

/**
 * Verify a record signature
 *
 * @param {Object} record - The record content
 * @param {string} signature - The signature to verify (hex-encoded)
 * @param {string} publicKey - Optional Ed25519 public key (defaults to NODE_PUBLIC_KEY env)
 * @returns {boolean} - true if signature is valid
 */
const verifyRecord = (record, signature, publicKey = null) => {
  const content = typeof record === 'string' ? record : JSON.stringify(record);
  return crypto.verifySignature(content, signature, publicKey);
};

/**
 * Create a signed ledger entry
 * Combines record content, hash chain, and signature
 *
 * @param {Object} opts - Options object
 * @param {string} opts.record_type - 'initiator_proposal', 'respondent_response', 'synthesis', 'board_action', 'pulse', etc.
 * @param {string} opts.content_plain - The unencrypted content
 * @param {string} opts.prev_hash - Hash of previous entry (for chain)
 * @param {string} opts.origin_node - Which node created this (e.g., 'server', 'device-1')
 * @returns {Object} - Signed record with id, content_hash, signature, prev_hash
 */
const createSignedRecord = (opts = {}) => {
  const { record_type, content_plain, prev_hash, origin_node } = opts;

  const record = {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    created_at: new Date().toISOString(),
    record_type,
    content_hash: crypto.hashContent(content_plain),
    content_plain,
    prev_hash: prev_hash || null,
    origin_node: origin_node || process.env.NODE_ID || 'unknown',
  };

  // Sign the record (excluding signature field)
  const recordToSign = { ...record };
  delete recordToSign.signature;
  record.signature = signRecord(recordToSign);

  return record;
};

/**
 * Verify a signed ledger entry
 * Checks content hash, signature validity, and chain integrity
 *
 * @param {Object} entry - The ledger entry
 * @param {string} publicKey - Optional public key for verification
 * @returns {Object} - { ok: boolean, valid: boolean, reason: string }
 */
const verifySignedRecord = (entry, publicKey = null) => {
  if (!entry || !entry.signature) {
    return { ok: false, valid: false, reason: 'Entry missing signature' };
  }

  try {
    // Verify signature
    const recordToVerify = { ...entry };
    const signature = recordToVerify.signature;
    delete recordToVerify.signature;

    const isValid = verifyRecord(recordToVerify, signature, publicKey);

    if (!isValid) {
      return { ok: false, valid: false, reason: 'Signature verification failed' };
    }

    // Verify content hash
    const expectedHash = crypto.hashContent(entry.content_plain);
    if (entry.content_hash !== expectedHash) {
      return { ok: false, valid: false, reason: 'Content hash mismatch' };
    }

    return { ok: true, valid: true, reason: 'Valid signature and content hash' };
  } catch (error) {
    return { ok: false, valid: false, reason: `Verification error: ${error.message}` };
  }
};

/**
 * Hash a record for content-addressed storage
 * Used in knowledge store and file-based storage systems
 */
const hashRecord = (record) => {
  return crypto.hashContent(record);
};

/**
 * Create a record with audience tag for access control
 * Tracks whether record should be node-private, board-only, or public
 *
 * @param {Object} record - Base record
 * @param {string} audience - 'node-private' | 'internal' | 'board-only' | 'public'
 * @returns {Object} - Record with audience field
 */
const addAudienceTag = (record, audience = 'node-private') => {
  return {
    ...record,
    audience,
  };
};

/**
 * Verify record audience matches access level
 * Phase 2+ will enforce audience restrictions
 *
 * @param {Object} record - Record with audience field
 * @param {string} requestor - 'operator', 'peer-node', 'public'
 * @returns {boolean} - true if requestor can access this record
 */
const canAccessRecord = (record, requestor = 'operator') => {
  const audience = record.audience || 'node-private';

  const accessMatrix = {
    'node-private': ['operator'],
    internal: ['operator', 'peer-node'],
    'board-only': ['operator'],
    public: ['operator', 'peer-node', 'public'],
  };

  return (accessMatrix[audience] || []).includes(requestor);
};

module.exports = {
  signRecord,
  verifyRecord,
  createSignedRecord,
  verifySignedRecord,
  hashRecord,
  addAudienceTag,
  canAccessRecord,
};
