const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Agent secrets storage (encrypted with CONSTITUTION_KEY or MASTER_KEY)
// Pattern: follows constitutionStore.js AES-256-GCM encryption

const KEYCHAIN_PATH = path.join(__dirname, '../../config/keychain.json.enc');
const KEY_DERIVATION_SALT = 'dencken-keychain-v1';
const PROVIDER_API_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

const getEncryptionKey = () => {
  const masterKey = process.env.MASTER_KEY || process.env.CONSTITUTION_KEY;
  if (!masterKey) {
    throw new Error('Keychain encryption requires MASTER_KEY or CONSTITUTION_KEY environment variable');
  }
  // SHA-256 derivation (TODO: upgrade to HKDF in Phase 1a)
  return crypto.createHash('sha256').update(masterKey + KEY_DERIVATION_SALT).digest();
};

const encryptKeychain = (keychain) => {
  if (!keychain || typeof keychain !== 'object') {
    throw new Error('Invalid keychain object');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(keychain);
  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    ciphertext: encrypted,
    authTag,
  };
};

const decryptKeychain = (encryptedData) => {
  if (!encryptedData || !encryptedData.iv || !encryptedData.ciphertext || !encryptedData.authTag) {
    throw new Error('Invalid encrypted keychain data format');
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    const decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error(`Failed to decrypt keychain: ${error.message}`);
  }
};

const bootstrapKeychain = () => {
  const defaultKeychain = {
    agents: [
      {
        agent_id: 'agent-alpha',
        provider: 'openrouter',
        api_key: '',
        api_url: 'https://openrouter.ai/api/v1',
        model: '',
        preferred: false,
        status: 'unconfigured',
        last_tested: null,
      },
      {
        agent_id: 'agent-beta',
        provider: 'groq',
        api_key: '',
        api_url: 'https://api.groq.com/openai/v1',
        model: '',
        preferred: false,
        status: 'unconfigured',
        last_tested: null,
      },
      {
        agent_id: 'agent-cso',
        provider: 'openrouter',
        api_key: '',
        api_url: 'https://openrouter.ai/api/v1',
        model: '',
        preferred: false,
        status: 'unconfigured',
        last_tested: null,
      },
      {
        agent_id: 'agent-gemini',
        provider: 'gemini',
        api_key: '',
        api_url: 'https://generativelanguage.googleapis.com/v1beta',
        model: '',
        preferred: false,
        status: 'unconfigured',
        last_tested: null,
      },
    ],
    created_at: new Date().toISOString(),
    version: '1.0',
  };

  return defaultKeychain;
};

const loadKeychain = () => {
  try {
    if (!fs.existsSync(KEYCHAIN_PATH)) {
      console.warn('[KEYCHAIN] File not found:', KEYCHAIN_PATH, '- returning bootstrap keychain');
      return bootstrapKeychain();
    }

    const raw = fs.readFileSync(KEYCHAIN_PATH, 'utf8');
    console.log('[KEYCHAIN] File exists, size:', raw.length, 'bytes');
    
    const encrypted = JSON.parse(raw);
    console.log('[KEYCHAIN] Parsed encrypted data, has iv:', !!encrypted.iv, 'has ciphertext:', !!encrypted.ciphertext, 'has authTag:', !!encrypted.authTag);
    
    const keychain = decryptKeychain(encrypted);
    console.log(`[KEYCHAIN] Successfully decrypted ${keychain.agents?.length || 0} agent(s)`);
    
    // Log each agent's status
    keychain.agents?.forEach((a) => {
      console.log(`  - ${a.agent_id}: provider=${a.provider}, has_key=${!!a.api_key}, status=${a.status}`);
    });
    
    return keychain;
  } catch (error) {
    console.error('[KEYCHAIN] Failed to load keychain:', error.message);
    console.error('[KEYCHAIN] Stack:', error.stack);
    console.warn('[KEYCHAIN] Returning bootstrap keychain due to error');
    return bootstrapKeychain();
  }
};

const saveKeychain = (keychain) => {
  try {
    if (!keychain || !Array.isArray(keychain.agents)) {
      throw new Error('Invalid keychain format: must have agents array');
    }

    console.log(`[KEYCHAIN] Saving keychain with ${keychain.agents.length} agent(s)`);
    keychain.agents.forEach((a) => {
      console.log(`  - Saving ${a.agent_id}: provider=${a.provider}, api_key_length=${a.api_key?.length || 0}, status=${a.status}`);
    });

    // Ensure config directory exists
    const configDir = path.dirname(KEYCHAIN_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log(`[KEYCHAIN] Created config directory: ${configDir}`);
    }

    const encrypted = encryptKeychain(keychain);
    console.log(`[KEYCHAIN] Encrypted data: iv=${encrypted.iv}, ciphertext_len=${encrypted.ciphertext.length}, authTag=${encrypted.authTag}`);
    
    fs.writeFileSync(KEYCHAIN_PATH, JSON.stringify(encrypted, null, 2), 'utf8');
    console.log('[KEYCHAIN] Successfully wrote to:', KEYCHAIN_PATH);
    
    return true;
  } catch (error) {
    console.error('[KEYCHAIN] Failed to save keychain:', error.message);
    console.error('[KEYCHAIN] Stack:', error.stack);
    throw error;
  }
};

const getAgentSecret = (agentId) => {
  const keychain = loadKeychain();
  const agent = keychain.agents?.find((a) => a.agent_id === agentId);
  return agent || null;
};

const setAgentSecret = (agentId, { api_key, provider, model, preferred }) => {
  console.log(`[KEYCHAIN] setAgentSecret called for ${agentId}, provider=${provider}, api_key_len=${api_key?.length || 0}`);
  const keychain = loadKeychain();
  let agent = keychain.agents?.find((a) => a.agent_id === agentId);

  if (!agent) {
    // Create new agent secret
    console.log(`[KEYCHAIN] Agent ${agentId} not found, creating new entry`);
    agent = {
      agent_id: agentId,
      provider: provider || 'openrouter',
      api_key: '',
      api_url: PROVIDER_API_URLS[provider] || PROVIDER_API_URLS.openrouter,
      model: '',
      preferred: false,
      status: 'unconfigured',
      last_tested: null,
    };
    keychain.agents.push(agent);
  }

  const resolvedProvider = provider || agent.provider;
  console.log(`[KEYCHAIN] Setting ${agentId}: api_key_len=${api_key?.length || 0}, provider=${resolvedProvider}, model=${model || 'none'}, status_will_be=${api_key ? 'configured' : 'unconfigured'}`);
  agent.api_key = api_key || '';
  agent.api_url = PROVIDER_API_URLS[resolvedProvider] || agent.api_url;
  agent.model = model || agent.model || '';
  agent.status = api_key ? 'configured' : 'unconfigured';
  agent.provider = resolvedProvider;
  agent.preferred = preferred === undefined ? Boolean(agent.preferred) : Boolean(preferred);

  saveKeychain(keychain);
  console.log(`[KEYCHAIN] After save, ${agentId} has api_key_len=${agent.api_key?.length || 0}, status=${agent.status}`);
  return agent;
};

const listAgentSecrets = () => {
  const keychain = loadKeychain();
  return keychain.agents || [];
};

const validateAgentSecret = async (agentId) => {
  const agent = getAgentSecret(agentId);
  if (!agent || !agent.api_key) {
    return { ok: false, status: 'unconfigured', reason: 'No API key configured' };
  }

  try {
    // Basic validation: check if provider URL is reachable
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(agent.api_url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${agent.api_key}` },
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (response && response.ok) {
      agent.status = 'ok';
      agent.last_tested = new Date().toISOString();
      saveKeychain(loadKeychain()); // Update with timestamp
      return { ok: true, status: 'ok', reason: 'API endpoint reachable' };
    }

    agent.status = 'degraded';
    agent.last_tested = new Date().toISOString();
    return { ok: false, status: 'degraded', reason: response?.statusText || 'Endpoint unreachable' };
  } catch (error) {
    agent.status = 'error';
    agent.last_tested = new Date().toISOString();
    return { ok: false, status: 'error', reason: error.message };
  }
};

const deleteAgentSecret = (agentId) => {
  const keychain = loadKeychain();
  const index = keychain.agents?.findIndex((a) => a.agent_id === agentId);

  if (index >= 0) {
    keychain.agents.splice(index, 1);
    saveKeychain(keychain);
    return true;
  }

  return false;
};

module.exports = {
  loadKeychain,
  saveKeychain,
  getAgentSecret,
  setAgentSecret,
  listAgentSecrets,
  validateAgentSecret,
  deleteAgentSecret,
  bootstrapKeychain,
  encryptKeychain,
  decryptKeychain,
};
