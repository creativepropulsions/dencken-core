const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let sqlite3;

try {
  sqlite3 = require('sqlite3').verbose();
} catch (err) {
  sqlite3 = null;
}

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'constitution_simple.db');
const fallbackPath = path.join(dataDir, 'constitution_simple.jsonl');
const configConstitutionPath = path.join(__dirname, '../../config/constitution.json.enc');

let db = null;
let available = false;

const init = () => {
  if (!sqlite3) {
    available = false;
    return;
  }

  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        available = false;
        db = null;
        return;
      }
      const sql = `
        CREATE TABLE IF NOT EXISTS constitution_records (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          content_plain TEXT NOT NULL,
          prev_hash TEXT,
          status TEXT,
          board_note TEXT
        );
      `;
      db.run(sql, (e) => {
        if (e) { available = false; db = null; return; }
        available = true;
      });
    });
  } catch (err) {
    available = false;
    db = null;
  }
};

const uuid = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID : () => {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16));
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
  const configDir = path.dirname(configConstitutionPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configConstitutionPath, encryptedContent, 'utf8');
};

const getLatestFallbackRecord = () => {
  if (!fs.existsSync(fallbackPath)) return null;
  const data = fs.readFileSync(fallbackPath, 'utf8').trim();
  if (!data) return null;
  const lines = data.split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try { return JSON.parse(last); } catch (err) { return null; }
};

const getLatestRecord = () => {
  if (available && db) {
    try {
      const sql = 'SELECT * FROM constitution_records ORDER BY created_at DESC LIMIT 1';
      return new Promise((resolve) => {
        db.get(sql, (err, row) => {
          if (err || !row) return resolve(null);
          resolve(row);
        });
      });
    } catch (err) {
      return null;
    }
  }
  return getLatestFallbackRecord();
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

  if (available && db) {
    const promise = new Promise((resolve, reject) => {
      const sql = `INSERT INTO constitution_records (id, created_at, content_hash, content_plain, prev_hash, status, board_note) VALUES (?,?,?,?,?,?,?)`;
      db.run(sql, [record.id, record.created_at, record.content_hash, record.content_plain, record.prev_hash, record.status, record.board_note], function (err) {
        if (err) return reject(new Error('Failed to store constitution: ' + err.message));
        resolve(record);
      });
    });
    saveConfigConstitution(encryptedContent);
    return promise;
  }

  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(fallbackPath, JSON.stringify(record) + '\n', { encoding: 'utf8' });
    saveConfigConstitution(encryptedContent);
    return record;
  } catch (err) {
    throw new Error('Failed to store constitution record: ' + err.message);
  }
};

const getStorageType = () => {
  if (available) return 'sqlite';
  return 'jsonl';
};

init();

module.exports = { getLatestConstitution, storeConstitution, loadConfigConstitution, getStorageType };
