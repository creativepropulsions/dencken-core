const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { loadAgentPool } = require('../agents/pool');
const { simulateDeliberationCycle } = require('../agents/cycle');
const { getNodeId, getNodePublicKey, getNodeMeta } = require('../core/identity');
const ledger = require('../core/ledger');
const { requireAdminAuth, getAdminTokenFromRequest, getAdminToken, isAdminAuthenticated, createAdminAuthCookie, clearAdminAuthCookie } = require('./auth');
const constitutionStore = require('../core/constitutionStore');
const { loadConfigConstitution } = require('../core/constitutionStore');

router.get('/', (req, res) => {
  res.type('text/plain').send('Dencken Board Node');
});

router.get('/admin/login', (req, res) => {
  const adminToken = getAdminToken();
  if (!adminToken) {
    return res.status(503).type('text/plain').send('ADMIN_TOKEN not configured');
  }

  const requestToken = getAdminTokenFromRequest(req);
  if (requestToken === adminToken) {
    return res.redirect('/dashboard');
  }

  res.type('text/html').send(`
    <html>
      <head><title>Admin Login</title></head>
      <body>
        <h1>Admin Login</h1>
        <form method="post" action="/admin/login">
          <label>Admin token: <input name="admin_token" type="password" size="70" autocomplete="off" /></label><br /><br />
          <button type="submit">Sign In</button>
        </form>
      </body>
    </html>
  `);
});

router.post('/admin/login', (req, res) => {
  const adminToken = getAdminToken();
  if (!adminToken) {
    return res.status(503).type('text/plain').send('ADMIN_TOKEN not configured');
  }

  const requestToken = req.body && req.body.admin_token ? String(req.body.admin_token) : null;
  if (!requestToken || requestToken !== adminToken) {
    return res.status(401).type('text/html').send(`
      <html>
        <head><title>Admin Login Failed</title></head>
        <body>
          <h1>Login failed</h1>
          <p>Invalid admin token.</p>
          <p><a href="/admin/login">Try again</a></p>
        </body>
      </html>
    `);
  }

  res.setHeader('Set-Cookie', createAdminAuthCookie(adminToken));
  return res.redirect('/dashboard');
});

router.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearAdminAuthCookie());
  return res.redirect('/admin/login');
});

// Read ledger entries (reads fallback if sqlite not available)
const readLedgerEntries = async ({ limit = 50, offset = 0 } = {}) => {
  if (typeof ledger.getEntries === 'function') {
    const sqliteEntries = await ledger.getEntries({ limit, offset });
    if (Array.isArray(sqliteEntries) && sqliteEntries.length > 0) {
      return sqliteEntries;
    }
  }

  if (typeof ledger.readFallbackEntries === 'function') {
    return ledger.readFallbackEntries({ limit, offset });
  }

  return [];
};

const appendLedgerRecord = async (opts = {}) => {
  if (typeof ledger.appendRecord === 'function') {
    try {
      const entry = await ledger.appendRecord(opts);
      if (entry) {
        return entry;
      }
    } catch (err) {
      console.warn('Unified ledger append failed, falling back to file ledger:', err.message);
    }
  }

  if (typeof ledger.appendFallbackRecord === 'function') {
    return ledger.appendFallbackRecord(opts);
  }

  throw new Error('No ledger appender available');
};

router.get('/ledger', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const entries = await readLedgerEntries({ limit, offset });
    return res.json({ ok: true, entries });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/ledger/test', requireAdminAuth, (req, res) => {
  res.type('text/html').send(`
    <html>
      <head><title>Ledger Signature Test</title></head>
      <body>
        <h1>Ledger Signature Test</h1>
        <p>Use the form below to create a live ledger test entry and verify whether the service can sign it.</p>
        <form method="post" action="/ledger/test/browser">
          <label>Record type: <input name="record_type" value="test" /></label><br /><br />
          <label>Content: <input name="content_plain" value="signed test from browser" size="60"/></label><br /><br />
          <button type="submit">Create Signed Ledger Record</button>
        </form>
      </body>
    </html>
  `);
});

router.get('/ledger/test/browser', requireAdminAuth, (req, res) => {
  return res.redirect('/ledger/test');
});

router.post('/ledger/test/browser', requireAdminAuth, async (req, res) => {
  try {
    const { record_type, content_plain } = req.body || {};
    const entry = await appendLedgerRecord({
      record_type: record_type || 'test',
      content_plain: content_plain || 'test',
    });

    return res.type('text/html').send(`
      <html>
        <head><title>Ledger Signature Test Result</title></head>
        <body>
          <h1>Ledger Test Result</h1>
          <pre>${JSON.stringify(entry, null, 2)}</pre>
          <p><a href="/ledger/test">Back</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/diag', requireAdminAuth, (req, res) => {
  return res.redirect('/dashboard');
});

router.get('/status', async (req, res) => {
  try {
    const dataDir = path.join(__dirname, '../../data');
    const nodePublicKey = getNodePublicKey();
    const ledgerHeight = typeof ledger.getLedgerHeight === 'function' ? await ledger.getLedgerHeight() : 0;
    const status = {
      ok: true,
      node_id: getNodeId(),
      node_public_key_present: Boolean(nodePublicKey),
      data_dir_exists: fs.existsSync(dataDir),
      ledger_available: typeof ledger.isAvailable === 'function' ? ledger.isAvailable() : false,
      ledger_height: ledgerHeight,
      timestamp: new Date().toISOString(),
    };
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/cycle/test', requireAdminAuth, async (req, res) => {
  try {
    const result = await simulateDeliberationCycle({ prompt: req.query.prompt });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/cycle/test/browser', requireAdminAuth, async (req, res) => {
  try {
    const result = await simulateDeliberationCycle({ prompt: req.query.prompt });
    return res.type('text/html').send(`
      <html>
        <head><title>Deliberation Cycle Test</title></head>
        <body>
          <h1>Deliberation Cycle Test Result</h1>
          <pre>${JSON.stringify(result, null, 2)}</pre>
          <p><a href="/ledger/test">Back</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const formatEnvValue = (value) => {
  if (value === undefined || value === null) return '';
  return JSON.stringify(String(value).replace(/\r\n/g, '\\n').replace(/\n/g, '\\n'));
};

const writeEnvFile = (updates = {}) => {
  const envPath = path.join(__dirname, '../../.env');
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const parsed = require('dotenv').parse(raw);
  const merged = { ...parsed, ...updates };
  const lines = Object.entries(merged).map(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return `${key}=`;
    }
    return `${key}=${formatEnvValue(value)}`;
  });

  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      process.env[key] = String(value);
    }
  });

  return envPath;
};

const renderSetupPage = ({ displayedJson, errorMessage, successMessage, viewMode = false, latestExists = false, latestSavedAt = null }) => {
  return `
    <html>
      <head><title>Constitution Setup</title></head>
      <body>
        <h1>Constitution Setup</h1>
        ${errorMessage ? `<div style="color: darkred; padding: 1em; border: 1px solid red; background: #ffecec;">${errorMessage}</div>` : ''}
        ${successMessage ? `<div style="color: darkgreen; padding: 1em; border: 1px solid green; background: #ecffe3;">${successMessage}</div>` : ''}
        ${latestExists ? `<p>Latest constitution available${latestSavedAt ? ` (saved at ${latestSavedAt})` : ''}.</p>` : '<p>No constitution saved yet.</p>'}
        ${viewMode && displayedJson ? `<h2>Latest Constitution</h2><pre style="white-space: pre-wrap; word-break: break-word; background:#f7f7f7; padding:1em;">${displayedJson}</pre>` : ''}
        <form method="post" action="" style="max-width:900px; margin-top:1rem;">
          <label>Admin token (required): <input name="admin_token" type="password" size="70" autocomplete="off" value="${process.env.BOARD_PASS || ''}"/></label><br /><br />
          <label>Master key (optional): <input name="master_key" type="password" size="70" autocomplete="off" value="${process.env.MASTER_KEY || ''}"/></label><br /><br />
          <label>Node private key (required): <input name="node_private_key" type="password" size="70" autocomplete="off" value="${process.env.NODE_PRIVATE_KEY || ''}" required/></label><br /><br />
          <label>Node ID (optional): <input name="node_id" size="50" value="${process.env.NODE_ID || 'server-node-0'}"/></label><br /><br />
          <label>Brief version (optional): <input name="brief_version" size="20" value="${process.env.BRIEF_VERSION || '0.0.1'}"/></label><br /><br />
          <label>Constitution JSON:<br /><textarea name="constitution" rows="20" cols="80"></textarea></label><br /><br />
          <button type="submit" name="action" value="update">Update</button>
          <button type="submit" name="action" value="view">View</button>
        </form>
        <p><a href="/dashboard">Back to dashboard</a></p>
      </body>
    </html>
  `;
};

router.get('/setup', async (req, res) => {
  try {
    const latest = await constitutionStore.getLatestConstitution().catch(() => null);
    return res.type('text/html').send(renderSetupPage({ latestExists: Boolean(latest), latestSavedAt: latest ? latest.created_at : null }));
  } catch (err) {
    return res.status(500).type('text/html').send(`Error loading setup: ${err.message}`);
  }
});

router.post('/setup', async (req, res) => {
  const action = req.body && req.body.action ? String(req.body.action) : 'update';
  const latest = await constitutionStore.getLatestConstitution().catch(() => null);
  const latestExists = Boolean(latest);
  const latestSavedAt = latest ? latest.created_at : null;

  try {
    const requestToken = getAdminTokenFromRequest(req);
    const adminToken = getAdminToken();
    if (!adminToken || requestToken !== adminToken) {
      return res.status(401).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Unauthorized: invalid admin token' }));
    }

    res.setHeader('Set-Cookie', createAdminAuthCookie(adminToken));

    if (action === 'view') {
      if (!latest) {
        return res.type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'No constitution has been saved yet.', viewMode: false }));
      }

      const displayedJson = latest && latest.constitution ? JSON.stringify(latest.constitution, null, 2) : '';
      return res.type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, viewMode: true, displayedJson }));
    }

    const adminTokenValue = req.body && (req.body.admin_token || req.body.board_pass || req.body.ADMIN_TOKEN)
      ? String(req.body.admin_token || req.body.board_pass || req.body.ADMIN_TOKEN).trim()
      : '';
    const masterKeyValue = req.body && req.body.master_key ? String(req.body.master_key).trim() : '';
    const nodePrivateKeyValue = req.body && req.body.node_private_key ? String(req.body.node_private_key).trim() : '';
    const nodeIdValue = req.body && req.body.node_id ? String(req.body.node_id).trim() : process.env.NODE_ID || 'server-node-0';
    const briefVersionValue = req.body && req.body.brief_version ? String(req.body.brief_version).trim() : process.env.BRIEF_VERSION || '0.0.1';

    if (!nodePrivateKeyValue) {
      return res.status(400).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Node private key is required for signed ledger entries' }));
    }

    const envUpdates = {};
    if (adminTokenValue) {
      envUpdates.ADMIN_TOKEN = adminTokenValue;
      envUpdates.BOARD_PASS = adminTokenValue;
    }
    if (masterKeyValue) envUpdates.MASTER_KEY = masterKeyValue;
    envUpdates.NODE_PRIVATE_KEY = nodePrivateKeyValue;
    if (nodeIdValue) envUpdates.NODE_ID = nodeIdValue;
    if (briefVersionValue) envUpdates.BRIEF_VERSION = briefVersionValue;
    if (Object.keys(envUpdates).length > 0) {
      writeEnvFile(envUpdates);
    }

    const constitutionText = req.body && req.body.constitution ? String(req.body.constitution).trim() : '';
    if (!constitutionText) {
      return res.status(400).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Constitution JSON is required' }));
    }

    let parsed;
    try {
      parsed = JSON.parse(constitutionText);
    } catch (err) {
      return res.status(400).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Invalid JSON' }));
    }

    try {
      const dataDirCheck = path.join(__dirname, '../../data');
      if (!fs.existsSync(dataDirCheck)) {
        try { fs.mkdirSync(dataDirCheck, { recursive: true }); } catch (e) { throw new Error('Failed to create data directory: ' + e.message); }
      }
      try {
        fs.accessSync(dataDirCheck, fs.constants.W_OK);
      } catch (e) {
        throw new Error('Data directory is not writable by the node process: ' + e.message);
      }
    } catch (err) {
      return res.status(500).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Storage path check failed: ' + err.message }));
    }

    const record = await constitutionStore.storeConstitution({ constitution: parsed });

    let ledgerEntry = null;
    try {
      ledgerEntry = await appendLedgerRecord({
        record_type: 'constitution_update',
        content_plain: JSON.stringify(parsed),
      });
    } catch (ledgerErr) {
      // ledger should not block constitution save, but capture failure in messaging
      console.error('Ledger append failed:', ledgerErr.message || ledgerErr);
    }

    const savedLatest = await constitutionStore.getLatestConstitution().catch(() => null);
    const savedLatestAt = savedLatest ? savedLatest.created_at : latestSavedAt;
    const successMessage = ledgerEntry ? 'Constitution saved and ledger record created.' : 'Constitution saved successfully. Ledger record could not be created.';

    return res.type('text/html').send(renderSetupPage({ latestExists: Boolean(savedLatest), latestSavedAt: savedLatestAt, viewMode: false, successMessage }));
  } catch (err) {
    return res.status(500).type('text/html').send(renderSetupPage({ latestExists, latestSavedAt, errorMessage: 'Failed to store constitution: ' + err.message }));
  }
});

router.get('/cycle/status', requireAdminAuth, async (req, res) => {
  try {
    const entries = await readLedgerEntries({ limit: 20, offset: 0 });

    const cycleEntries = entries.filter((entry) => [
      'initiator_proposal',
      'respondent_response',
      'synthesis',
    ].includes(entry.record_type));

    const verified = cycleEntries.map((entry) => {
      const verification = ledger.verifyEntrySignature ? ledger.verifyEntrySignature(entry) : { ok: false, error: 'No verifyEntrySignature available' };
      return { ...entry, verification };
    });

    return res.json({ ok: true, cycle_entries: verified });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});


router.get('/dashboard', async (req, res) => {
  try {
    const authenticated = isAdminAuthenticated(req);
    if (!authenticated) {
      return res.type('text/html').send(`
        <html>
          <head><title>Admin Dashboard</title></head>
          <body>
            <h1>Dencken Admin Dashboard</h1>
            <p>You are not signed in.</p>
            <p><a href="/admin/login">Sign in as admin</a></p>
          </body>
        </html>
      `);
    }

    const diagData = await (async () => {
      const dataDir = path.join(__dirname, '../../data');
      const tmpFile = path.join(dataDir, `.diag-${Date.now()}.tmp`);
      const privateKeyInfo = ledger.getPrivateKeyInfo ? ledger.getPrivateKeyInfo() : null;
      const nodePublicKey = getNodePublicKey();
      const configConstitution = await loadConfigConstitution().catch(() => null);
      const recentEntries = await readLedgerEntries({ limit: 5, offset: 0 });
      const verifiedEntries = recentEntries.map((entry) => {
        const hasSignature = Boolean(entry.signature && entry.author_pubkey);
        const verification = hasSignature
          ? (ledger.verifyEntrySignature ? ledger.verifyEntrySignature(entry) : { ok: false, error: 'No verifyEntrySignature available' })
          : { ok: null, error: null };
        return { entry, verification, hasSignature };
      });
      const result = {
        //node_id: getNodeId(),
        //node_meta: nodeMeta,
        //node_public_key: nodePublicKey,
        //node_public_key_present: Boolean(nodePublicKey),
        ledger_module_loaded: typeof ledger !== 'undefined',
        ledger_available: typeof ledger.isAvailable === 'function' ? ledger.isAvailable() : false,
        ledger_type: typeof ledger.ledgerType === 'function' ? ledger.ledgerType() : 'unknown',
        data_dir_exists: fs.existsSync(dataDir),
        data_dir_writable: false,
        write_error: null,
        private_key_present: privateKeyInfo ? privateKeyInfo.private_key_present : false,
        private_key_source: privateKeyInfo ? privateKeyInfo.private_key_source : null,
        private_key_valid: privateKeyInfo ? privateKeyInfo.private_key_valid : false,
        private_key_error: privateKeyInfo ? privateKeyInfo.private_key_error : null,
        recent_entries: verifiedEntries,
      };

      try {
        fs.writeFileSync(tmpFile, 'diag');
        result.data_dir_writable = true;
        fs.unlinkSync(tmpFile);
      } catch (err) {
        result.write_error = err.message;
        result.data_dir_writable = false;
      }

      return result;
    })();

    const latestConstitution = await constitutionStore.getLatestConstitution().catch(() => null);
    const entryCount = (await readLedgerEntries({ limit: 20, offset: 0 })).length;
    const constitutionFromConfig = await loadConfigConstitution().catch(() => null);

    res.type('text/html').send(`
      <html>
        <head><title>Dencken Dashboard</title></head>
        <body>
          <h1>Dencken Admin Dashboard</h1><p><strong>Ledger Available:</strong> ${diagData.ledger_available ? `true (${diagData.ledger_type})` : 'false'}</p>
          <p><strong>Data directory exists:</strong> ${diagData.data_dir_exists}</p>
          <p><strong>Data directory writable:</strong> ${diagData.data_dir_writable}</p>
          <p><strong>Private key present:</strong> ${diagData.private_key_present}</p>
          <p><strong>Private key valid:</strong> ${diagData.private_key_valid}</p>
          <p><strong>Latest constitution available:</strong> ${latestConstitution ? 'yes' : 'no'}</p>
          ${latestConstitution ? `<p><strong>Latest constitution saved at:</strong> ${latestConstitution.created_at}</p>` : ''}
          <p><strong>Config constitution loaded:</strong> ${constitutionFromConfig ? 'yes' : 'no'}</p>
          ${constitutionFromConfig ? `<p><strong>Config constitution source:</strong> config/constitution.json.enc</p>` : ''}
          <p><strong>Active agents:</strong> ${loadAgentPool().map((agent) => agent.id).join(', ')}</p>
          <p><strong>Recent ledger entry count:</strong> ${entryCount}</p>
          <h2>Recent ledger entry verification</h2>
          <ul>
            ${diagData.recent_entries.map(({ entry, verification, hasSignature }) => `
              <li>
                <strong>${entry.record_type}</strong> @ ${entry.created_at}: ${hasSignature ? (verification.ok ? 'valid' : 'invalid') : 'unsigned'}
                ${verification.error ? `<div style="color:red;">Error: ${verification.error}</div>` : ''}
              </li>
            `).join('')}
          </ul>
          <h2>Links</h2>
          <ul>
            <li><a href="/dashboard">/dashboard</a></li>
            <li><a href="/diag">/diag</a></li>
            <li><a href="/status">/status</a></li>
            <li><a href="/ledger">/ledger</a></li>
            <li><a href="/ledger/test">/ledger/test</a></li>
            <li><a href="/cycle/test">/cycle/test</a></li>
            <li><a href="/cycle/status">/cycle/status</a></li>
            <li><a href="/setup">/setup</a></li>
            
            <li><a href="/admin/logout">Sign out</a></li>
          </ul>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
