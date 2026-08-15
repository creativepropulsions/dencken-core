const fs = require('fs');
const path = require('path');

const publicKeyPath = path.join(__dirname, '../../config/node-identity.pub');
const nodeMetaPath = path.join(__dirname, '../../config/node-meta.json');

const loadNodeMeta = () => {
  if (loadNodeMeta.cache) return loadNodeMeta.cache;
  try {
    if (!fs.existsSync(nodeMetaPath)) return loadNodeMeta.cache = null;
    const raw = fs.readFileSync(nodeMetaPath, 'utf8').trim();
    if (!raw) return loadNodeMeta.cache = null;
    loadNodeMeta.cache = JSON.parse(raw);
    return loadNodeMeta.cache;
  } catch (err) {
    console.error('Failed to load node metadata:', err.message);
    return loadNodeMeta.cache = null;
  }
};

const getNodeMeta = () => {
  const meta = loadNodeMeta();
  if (meta && typeof meta === 'object') return meta;
  return {
    node_id: process.env.NODE_ID || 'server-node-0',
    node_type: 'server',
    network: process.env.NETWORK || 'dencken-network',
    public_key_file: 'config/node-identity.pub',
    brief_version: process.env.BRIEF_VERSION || '0.0.1',
    initialized_at: null,
    peers: [],
    capabilities: ['cycle', 'pulse', 'board'],
    extensions_pending: ['roles', 'mirrors', 'protocols'],
  };
};

const getNodeId = () => {
  const meta = getNodeMeta();
  return meta.node_id || process.env.NODE_ID || 'server-node-0';
};

const normalizePem = (rawPem) => {
  if (!rawPem) return null;
  let normalized = String(rawPem).trim();
  if (normalized.indexOf('\\n') !== -1) {
    normalized = normalized.replace(/\\n/g, '\n');
  }
  return normalized;
};

const getEnvNodePublicKey = () => {
  if (process.env.NODE_PUBLIC_KEY) {
    return normalizePem(process.env.NODE_PUBLIC_KEY);
  }

  if (process.env.NODE_PUBLIC_KEY_B64) {
    try {
      return normalizePem(Buffer.from(process.env.NODE_PUBLIC_KEY_B64, 'base64').toString('utf8'));
    } catch (err) {
      console.error('Invalid NODE_PUBLIC_KEY_B64:', err.message);
      return null;
    }
  }

  return null;
};

const getNodePublicKey = () => {
  const envKey = getEnvNodePublicKey();
  if (envKey) {
    return envKey.trim();
  }

  try {
    if (fs.existsSync(publicKeyPath)) {
      return fs.readFileSync(publicKeyPath, 'utf8').trim();
    }
  } catch (err) {
    console.error('Failed to read node public key:', err.message);
  }
  return null;
};

module.exports = {
  getNodeId,
  getNodePublicKey,
  getNodeMeta,
};
