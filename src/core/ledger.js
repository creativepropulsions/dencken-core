const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const dataDir = path.join(__dirname, '../../data');
const fallbackPath = path.join(dataDir, 'ledger.jsonl');

const uuid = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID : () => {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16));
};

const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return { url, key, available: Boolean(url && key) };
};

const supabaseRequest = (method, tablePath, body = null) => {
  return new Promise((resolve, reject) => {
    const { url, key, available } = getSupabaseConfig();
    if (!available) return reject(new Error('Supabase not configured'));

    const parsed = new URL(url + '/rest/v1/' + tablePath);
    const headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    };
    if (method === 'POST') headers['Prefer'] = 'return=representation';

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          if (res.statusCode >= 400) {
            return reject(new Error(json && json.message ? json.message : `HTTP ${res.statusCode}`));
          }
          const countHeader = res.headers['content-range'];
          let count = null;
          if (countHeader && countHeader.startsWith('*/')) {
            count = parseInt(countHeader.substring(2), 10);
          }
          resolve({ data: json, count });
        } catch (e) {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          resolve({ data: null, count: null });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const ensureFallbackLedgerReady = () => {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(fallbackPath)) {
      fs.writeFileSync(fallbackPath, '', 'utf8');
    }
    return true;
  } catch (err) {
    return false;
  }
};

const fallbackAvailable = () => {
  try {
    ensureFallbackLedgerReady();
    const testFile = path.join(dataDir, `.fallback-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    return true;
  } catch (err) {
    return false;
  }
};

const isAvailable = () => getSupabaseConfig().available || fallbackAvailable();

const ledgerType = () => {
  if (getSupabaseConfig().available) return 'supabase';
  if (fallbackAvailable()) return 'file fallback';
  return 'unavailable';
};

const cleanupLedgerFiles = () => {
  try {
    if (fs.existsSync(fallbackPath)) fs.unlinkSync(fallbackPath);
  } catch (err) {
    // ignore
  }
};

const resetLedgerStorage = async () => {
  if (getSupabaseConfig().available) {
    try {
      await supabaseRequest('DELETE', 'ledger_entries?id=neq.0');
    } catch (err) {
      console.error('Failed to clear ledger in Supabase:', err.message);
    }
  }
  cleanupLedgerFiles();
  ensureFallbackLedgerReady();
  return true;
};

const getLedgerHeight = async () => {
  if (getSupabaseConfig().available) {
    try {
      const result = await supabaseRequest('GET', 'ledger_entries?select=id&limit=1000');
      return (result.data || []).length;
    } catch (err) {
      console.error('Failed to query ledger height from Supabase:', err.message);
    }
  }

  try {
    if (!fs.existsSync(fallbackPath)) return 0;
    const data = fs.readFileSync(fallbackPath, 'utf8').trim();
    if (!data) return 0;
    return data.split(/\r?\n/).filter(Boolean).length;
  } catch (err) {
    return 0;
  }
};

const getEntries = async ({ limit = 50, offset = 0 } = {}) => {
  if (getSupabaseConfig().available) {
    try {
      const result = await supabaseRequest('GET', `ledger_entries?order=created_at.desc&limit=${limit}&offset=${offset}`);
      return result.data || [];
    } catch (err) {
      console.error('Failed to read ledger entries from Supabase:', err.message);
    }
  }
  return readFallbackEntries({ limit, offset });
};

const normalizePem = (rawPem) => {
  if (!rawPem) return null;
  let normalized = String(rawPem).trim();
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.indexOf('\\n') !== -1) {
    normalized = normalized.replace(/\\n/g, '\n');
  }
  return normalized;
};

const ensurePublicKeyPem = (rawKey) => {
  const normalized = normalizePem(rawKey);
  if (!normalized) return null;

  if (/-----BEGIN [A-Z ]+-----/.test(normalized)) {
    return normalized;
  }

  const bare = normalized.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(bare)) {
    const lines = bare.match(/.{1,64}/g) || [bare];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  return normalized;
};

const getEnvNodePublicKey = () => {
  if (process.env.NODE_PUBLIC_KEY) {
    return ensurePublicKeyPem(process.env.NODE_PUBLIC_KEY);
  }

  if (process.env.NODE_PUBLIC_KEY_B64) {
    try {
      return ensurePublicKeyPem(Buffer.from(process.env.NODE_PUBLIC_KEY_B64, 'base64').toString('utf8'));
    } catch (err) {
      return null;
    }
  }

  return null;
};

const getPrivateKeyInfo = () => {
  const tryCreateKey = (rawKey, source) => {
    if (!rawKey) {
      return { private_key_present: false, private_key_source: null, private_key_valid: false, private_key_error: null, keyObject: null };
    }

    if (rawKey.indexOf('\\n') !== -1) {
      rawKey = rawKey.replace(/\\n/g, '\n');
    }

    try {
      const keyObject = crypto.createPrivateKey(rawKey);
      return { private_key_present: true, private_key_source: source, private_key_valid: true, private_key_error: null, keyObject };
    } catch (err) {
      try {
        const keyObject = crypto.createPrivateKey({ key: rawKey, format: 'pem', type: 'pkcs8' });
        return { private_key_present: true, private_key_source: source, private_key_valid: true, private_key_error: null, keyObject };
      } catch (innerErr) {
        return { private_key_present: true, private_key_source: source, private_key_valid: false, private_key_error: innerErr.message, keyObject: null };
      }
    }
  };

  let pk = process.env.NODE_PRIVATE_KEY || null;
  if (pk) {
    const info = tryCreateKey(pk, 'NODE_PRIVATE_KEY');
    if (info.private_key_valid || !process.env.NODE_PRIVATE_KEY_B64) {
      return info;
    }
  }

  if (process.env.NODE_PRIVATE_KEY_B64) {
    let pkB64 = process.env.NODE_PRIVATE_KEY_B64;
    try {
      pkB64 = Buffer.from(pkB64, 'base64').toString('utf8');
    } catch (err) {
      return { private_key_present: true, private_key_source: 'NODE_PRIVATE_KEY_B64', private_key_valid: false, private_key_error: 'Invalid base64', keyObject: null };
    }
    return tryCreateKey(pkB64, 'NODE_PRIVATE_KEY_B64');
  }

  return { private_key_present: false, private_key_source: null, private_key_valid: false, private_key_error: null, keyObject: null };
};

const getPublicKeyPemFromPrivate = (keyObject) => {
  try {
    return crypto.createPublicKey(keyObject).export({ type: 'spki', format: 'pem' }).trim();
  } catch (err) {
    return null;
  }
};

const signEntry = (content_hash) => {
  let signature = null;
  let author_pubkey = null;
  const privateInfo = getPrivateKeyInfo();
  if (privateInfo && privateInfo.private_key_present && privateInfo.private_key_valid && privateInfo.keyObject) {
    try {
      const sign = crypto.sign(null, String(content_hash), privateInfo.keyObject);
      signature = sign.toString('base64');
      author_pubkey = getPublicKeyPemFromPrivate(privateInfo.keyObject) || null;
    } catch (err) {
      signature = null;
      author_pubkey = null;
    }
  }

  if (!author_pubkey && signature) {
    const envPubKey = getEnvNodePublicKey();
    author_pubkey = envPubKey ? envPubKey.trim() : null;
  }

  if (!author_pubkey && signature) {
    const pubKeyPath = path.join(__dirname, '../../config/node-identity.pub');
    if (fs.existsSync(pubKeyPath)) {
      author_pubkey = fs.readFileSync(pubKeyPath, 'utf8').trim();
    }
  }

  return { signature, author_pubkey };
};

const appendFallbackRecord = async (opts = {}) => {
  const id = uuid();
  const created_at = new Date().toISOString();
  const record_type = opts.record_type || 'system';
  const brief_version = opts.brief_version || process.env.BRIEF_VERSION || '0.0.1';
  const content_plain = opts.content_plain || '';

  const content_hash = crypto.createHash('sha256').update(content_plain).digest('hex');
  const content_encrypted = Buffer.from(content_plain, 'utf8').toString('base64');

  let prev_hash = null;
  try {
    if (fs.existsSync(fallbackPath)) {
      const stat = fs.statSync(fallbackPath);
      if (stat.size > 0) {
        const data = fs.readFileSync(fallbackPath, 'utf8');
        const lines = data.trim().split(/\r?\n/);
        const last = lines[lines.length - 1];
        if (last) {
          try {
            const lastObj = JSON.parse(last);
            prev_hash = lastObj.content_hash || null;
          } catch (e) {
            prev_hash = null;
          }
        }
      }
    }
  } catch (e) {
    prev_hash = null;
  }

  const { signature, author_pubkey } = signEntry(content_hash);

  const entry = {
    id,
    created_at,
    record_type,
    brief_version,
    content_hash,
    content_encrypted,
    author_pubkey,
    signature,
    prev_hash,
    status: 'pending_review',
    board_note: null,
  };

  try {
    ensureFallbackLedgerReady();
    fs.appendFileSync(fallbackPath, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
    return entry;
  } catch (err) {
    throw new Error('Failed to append fallback ledger record: ' + err.message);
  }
};

const readFallbackEntries = ({ limit = 50, offset = 0 } = {}) => {
  try {
    ensureFallbackLedgerReady();
    if (!fs.existsSync(fallbackPath)) return [];
    const data = fs.readFileSync(fallbackPath, 'utf8').trim();
    if (!data) return [];
    const lines = data.split(/\r?\n/).reverse();
    const selected = lines.slice(offset, offset + limit).map((l) => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
    return selected;
  } catch (err) {
    return [];
  }
};

const verifyEntrySignature = (entry) => {
  if (!entry || !entry.signature || !entry.author_pubkey || !entry.content_hash) {
    return { ok: false, error: 'Missing signature, author_pubkey, or content_hash' };
  }

  try {
    const signature = Buffer.from(entry.signature, 'base64');
    const content = String(entry.content_hash);
    const publicKeyPem = ensurePublicKeyPem(String(entry.author_pubkey));
    if (!publicKeyPem) {
      return { ok: false, error: 'Invalid author_pubkey format' };
    }
    const publicKey = crypto.createPublicKey(publicKeyPem);
    const ok = crypto.verify(null, content, publicKey, signature);
    return { ok, error: ok ? null : 'Signature verification failed' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const appendRecord = async (opts = {}) => {
  const id = uuid();
  const created_at = new Date().toISOString();
  const record_type = opts.record_type || 'system';
  const brief_version = opts.brief_version || process.env.BRIEF_VERSION || '0.0.1';
  const content_plain = opts.content_plain || '';
  const content_hash = crypto.createHash('sha256').update(content_plain).digest('hex');
  const content_encrypted = Buffer.from(content_plain, 'utf8').toString('base64');

  const { signature, author_pubkey } = signEntry(content_hash);

  let prev_hash = null;
  try {
    const existing = await getEntries({ limit: 1, offset: 0 });
    if (Array.isArray(existing) && existing.length > 0) {
      prev_hash = existing[0].content_hash || null;
    }
  } catch (e) {
    prev_hash = null;
  }

  const status = 'pending_review';
  const entry = {
    id,
    created_at,
    record_type,
    brief_version,
    content_hash,
    content_encrypted,
    author_pubkey,
    signature,
    prev_hash,
    status,
    board_note: null,
  };

  if (getSupabaseConfig().available) {
    try {
      await supabaseRequest('POST', 'ledger_entries', entry);
      return entry;
    } catch (err) {
      console.error('Supabase ledger insert failed, using fallback:', err.message);
    }
  }

  return appendFallbackRecord(opts);
};

module.exports.isAvailable = isAvailable;
module.exports.ledgerType = ledgerType;
module.exports.getLedgerHeight = getLedgerHeight;
module.exports.getEntries = getEntries;
module.exports.appendFallbackRecord = appendFallbackRecord;
module.exports.readFallbackEntries = readFallbackEntries;
module.exports.verifyEntrySignature = verifyEntrySignature;
module.exports.getPrivateKeyInfo = getPrivateKeyInfo;
module.exports.appendRecord = appendRecord;
module.exports.resetLedgerStorage = resetLedgerStorage;
