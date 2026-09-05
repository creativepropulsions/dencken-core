const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const configConstitutionPath = path.join(__dirname, '../../config/constitution.json.enc');
const dataDir = path.join(__dirname, '../../data');
const constitutionHistoryPath = path.join(dataDir, 'constitution.jsonl');

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
  try {
    if (!fs.existsSync(constitutionHistoryPath)) return null;
    const records = fs.readFileSync(constitutionHistoryPath, 'utf8').split(/\r?\n/).filter(Boolean);
    return records.length ? JSON.parse(records[records.length - 1]) : null;
  } catch (err) {
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

const isLoaded = async () => Boolean(await loadConfigConstitution());

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

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(constitutionHistoryPath, `${JSON.stringify(record)}\n`, 'utf8');
  saveConfigConstitution(encryptedContent);
  return record;
};

module.exports = { getLatestConstitution, storeConstitution, loadConfigConstitution, isLoaded };
