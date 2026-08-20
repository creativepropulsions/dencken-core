const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const configConstitutionPath = path.join(__dirname, '../../config/constitution.json.enc');

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
      'Prefer': method === 'POST' ? 'return=representation' : 'count=exact',
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
          resolve({ data: json, count: res.headers['content-range'] || null });
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

const getConstitutionKey = () => process.env.CONSTITUTION_KEY || null;

const deriveConstitutionKey = (key) => crypto.createHash('sha256').update(String(key), 'utf8').digest();

const encryptConstitution = (plaintext) => {
  const key = getConstitutionKey();
  if (!key) throw new Error('CONSTITUTION_KEY is not configured');
  const aesKey = deriveConstitutionKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
};

const decryptConstitution = (encrypted) => {
  if (!encrypted) return null;
  const key = getConstitutionKey();
  if (!key) {
    return JSON.parse(encrypted);
  }

  try {
    const aesKey = deriveConstitutionKey(key);
    const buffer = Buffer.from(encrypted, 'base64');
    if (buffer.length < 28) throw new Error('Invalid encrypted constitution payload');
    const iv = buffer.slice(0, 12);
    const tag = buffer.slice(12, 28);
    const ciphertext = buffer.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch (err) {
    return JSON.parse(encrypted);
  }
};

const saveConfigConstitution = (encryptedContent) => {
  try {
    const configDir = path.dirname(configConstitutionPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configConstitutionPath, encryptedContent, 'utf8');
  } catch (err) {
    // File system may not persist in this environment; ignore
  }
};

const getLatestRecord = async () => {
  if (!getSupabaseConfig().available) return null;
  try {
    const result = await supabaseRequest('GET', 'constitution_records?order=created_at.desc&limit=1');
    return (result.data && result.data.length > 0) ? result.data[0] : null;
  } catch (err) {
    console.error('Failed to read latest constitution from Supabase:', err.message);
    return null;
  }
};

const loadConfigConstitution = async () => {
  try {
    if (!fs.existsSync(configConstitutionPath)) return null;
    const encrypted = fs.readFileSync(configConstitutionPath, 'utf8').trim();
    if (!encrypted) return null;
    const decrypted = decryptConstitution(encrypted);
    if (!decrypted) return null;
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
};

const getLatestConstitution = async () => {
  const record = await getLatestRecord();
  if (!record) return null;
  try {
    const constitutionString = typeof record.content_plain === 'string' ? record.content_plain : null;
    const decrypted = decryptConstitution(constitutionString);
    const constitution = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    return { ...record, constitution };
  } catch (err) {
    return null;
  }
};

const storeConstitution = async ({ constitution }) => {
  const plaintext = JSON.stringify(constitution);
  const encryptedContent = encryptConstitution(plaintext);
  const contentHash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
  const latest = await getLatestConstitution();
  const prevHash = latest ? latest.content_hash : null;
  const createdAt = new Date().toISOString();
  const id = uuid();

  const record = {
    id,
    created_at: createdAt,
    content_hash: contentHash,
    content_plain: encryptedContent,
    prev_hash: prevHash,
    status: 'active',
    board_note: null,
  };

  try {
    await supabaseRequest('POST', 'constitution_records', record);
    saveConfigConstitution(encryptedContent);
    return record;
  } catch (err) {
    throw new Error('Failed to store constitution: ' + err.message);
  }
};

module.exports = { getLatestConstitution, storeConstitution, loadConfigConstitution };
