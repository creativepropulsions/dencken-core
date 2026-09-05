const { createRouter } = require('./localHttp');
const router = createRouter();
const fs = require('fs');
const path = require('path');
const { loadAgentPool } = require('../agents/pool');
const { simulateDeliberationCycle, buildAgentPrompt } = require('../agents/cycle');
const { invokeAgent, invokeChatCompletion } = require('../agents/caller');
const { getNodeId, getNodePublicKey, getNodeMeta } = require('../core/identity');
const ledger = require('../core/ledger');
const { enqueue } = require('../core/taskqueue');
const { buildChatContext, persistChatTurn } = require('../chat/context');
const { appendKnowledge, createSummary, fetchKnowledgeByHash } = require('../core/knowledge');
const { requireAdminAuth, getAdminTokenFromRequest, getAdminToken, isAdminAuthenticated, createAdminAuthCookie, clearAdminAuthCookie } = require('./auth');
const constitutionStore = require('../core/constitutionStore');
const { loadConfigConstitution } = require('../core/constitutionStore');
const keychain = require('../core/keychain');
const modelRegistry = require('../agents/modelRegistry');
const providers = require('../agents/providers');
const usageMetrics = require('../agents/usageMetrics');

// Native disclosure keeps diagnostic payloads out of the primary page flow.
const renderJson = (label, obj) => `<details><summary>${label}</summary><iframe title="${label}" src="data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(obj, null, 2))}"></iframe></details>`;

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
          ${renderJson('Entry', entry)}
          <p><a href="/ledger/test">Back</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
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
          ${renderJson('Result', result)}
          <p><a href="/ledger/test">Back</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/cycle/run', requireAdminAuth, (req, res) => {
  const prompt = String(req.query.prompt || '');
  return res.type('text/html').send(`<html><head><title>Cycle Runner</title></head><body><h1>Cycle Runner</h1><p><a href="/dashboard">Back to Dashboard</a></p><form method="post" action="/cycle/run"><label>Topic:<br /><textarea name="prompt" rows="5" cols="80">${prompt}</textarea></label><br /><label>Messages per respondent: <input name="max_messages" type="number" min="1" max="20" value="1" /></label><br /><button type="submit">Run Cycle</button></form></body></html>`);
});

router.post('/cycle/run', requireAdminAuth, async (req, res) => {
  try {
    const result = await simulateDeliberationCycle({
      prompt: req.body && req.body.prompt ? String(req.body.prompt).trim() : undefined,
      max_messages: req.body && req.body.max_messages ? Number(req.body.max_messages) : 1,
      use_manifest: true,
    });
    
    // Store cycle result with board_review AND full conversation to ledger for board to display
    if (result.ok && result.board_review) {
      const cycleEntry = await appendLedgerRecord({
        record_type: 'deliberation_cycle_result',
        content_plain: JSON.stringify({
          prompt: result.prompt,
          board_review: result.board_review,
          synthesis_agent: result.synthesis_agent,
          total_messages: result.total_conversation_messages,
          conversation: result.conversation, // FULL CONVERSATION FLOW
          provider_diversity: result.provider_diversity,
          providers_used: result.providers_used,
          timestamp: new Date().toISOString(),
        }),
        status: 'pending_review'
      });
      console.log('Cycle result stored to ledger:', cycleEntry && cycleEntry.id);
    }
    
    if (String(req.headers.accept || '').includes('text/html')) {
      return res.type('text/html').send(`<html><head><title>Cycle Result</title></head><body><h1>Cycle Result</h1><p><a href="/cycle/run">Run another cycle</a> | <a href="/board">Board Review</a> | <a href="/dashboard">Back to Dashboard</a></p>${renderJson('Result', result)}</body></html>`);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const decodeContent = (entry) => {
  try {
    // Try encrypted content first
    if (entry.content_encrypted) {
      const decrypted = Buffer.from(entry.content_encrypted || '', 'base64').toString('utf8');
      return typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    }
    // Try plain text content
    if (entry.content_plain) {
      try {
        return JSON.parse(entry.content_plain);
      } catch {
        return entry.content_plain;
      }
    }
    return {};
  } catch (err) {
    return {};
  }
};

router.get('/board', requireAdminAuth, async (req, res) => {
  const entries = await readLedgerEntries({ limit: 200, offset: 0 });
  const actions = entries
    .filter((entry) => entry.record_type === 'board_action')
    .map((entry) => ({ entry, data: decodeContent(entry) }))
    .filter(({ data }) => data && data.cycle_id)
    .reduce((map, action) => map.set(action.data.cycle_id, action), new Map());
  const cycleReviews = entries.filter((entry) => entry.record_type === 'deliberation_cycle_result');
  
  const rows = cycleReviews.map((entry) => {
    const decoded = decodeContent(entry);
    const cycleData = typeof decoded === 'string' ? {} : decoded;
    const boardReview = cycleData.board_review || {};
    const conversation = cycleData.conversation || [];
    const action = actions.get(entry.id);
    const actionData = action ? action.data : null;
    const isPending = !actionData && (!entry.status || entry.status === 'pending_review');
    const decision = actionData?.action || entry.status;
    const decisionText = decision === 'promote' || decision === 'promoted' ? 'Promoted' : decision === 'discard' || decision === 'discarded' ? 'Discarded' : 'Pending board review';
    const decisionInfo = actionData
      ? `<div><strong>Decision:</strong> ${decisionText} on ${action.entry.created_at}</div><div><strong>Board note:</strong> ${actionData.note || 'No note recorded.'}</div>${actionData.follow_up_task ? `<div><strong>Follow-up task:</strong> ${actionData.follow_up_task}</div>` : ''}`
      : `<div><strong>Decision:</strong> ${decisionText}</div>`;
    
    // Format conversation as readable flow
    const conversationHtml = conversation.map((msg, idx) => {
      const profile = msg.profile_agent_id && msg.profile_agent_id !== msg.author ? ` profile:${msg.profile_agent_id}` : '';
      const provider = msg.provider ? `<span style="color: #666; font-size: 0.9em;">[${msg.provider}${msg.model ? ` / ${msg.model}` : ''}${profile}${msg.tokens_used ? ` • ${msg.tokens_used} tokens` : ''}]</span>` : '';
      const role = msg.record_type ? `<strong>${msg.record_type.replace(/_/g, ' ').toUpperCase()}</strong>` : '';
      return `<div style="margin: 12px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #0066cc;"><div style="font-weight: bold; margin-bottom: 5px;">${idx + 1}. ${msg.author || 'unknown'} ${role} ${provider}</div><div>${msg.content}</div></div>`;
    }).join('');
    
    const csoAuth = boardReview.cso_authority ? '<span style="color: green; font-weight: bold;">[CSO AUTHORITY CONFIRMED]</span>' : '';
    const csoRec = boardReview.cso_recommendation ? `<strong>CSO Recommendation:</strong> ${boardReview.cso_recommendation}` : '';
    const topic = cycleData.prompt ? `<div style="margin: 10px 0;"><strong>Topic:</strong> ${cycleData.prompt}</div>` : '';
    
    return `<li style="border: 1px solid #ddd; padding: 15px; margin: 15px 0; background: white; border-radius: 5px; list-style: none;">
      <div style="margin-bottom: 15px; font-size: 0.9em; color: #666;">${entry.record_type} @ ${entry.created_at}</div>
      <div style="margin-bottom: 10px; padding: 10px; border: 1px solid #ccc;">${decisionInfo}</div>
      ${topic}
      <div style="margin-bottom: 10px; padding: 10px; background: #ffffcc; border-radius: 3px;">
        ${csoAuth}<br/>${csoRec}
      </div>
      <div style="margin: 15px 0;"><strong>Full Conversation Flow:</strong></div>
      ${conversationHtml}
      ${isPending ? `<div style="margin-top: 15px; display: flex; gap: 10px;">
        <form method="post" action="/board/promote/${entry.id}" style="display: inline;">
          <input name="board_note" placeholder="Board note" style="padding: 5px; width: 300px;"/>
          <input name="follow_up_task" placeholder="Follow-up task" style="padding: 5px; width: 300px;"/>
          <select name="follow_up_field"><option value="operational">operational</option><option value="constitution">constitution</option><option value="governance">governance</option><option value="enterprise">enterprise</option><option value="learning">learning</option><option value="self_reflection">self_reflection</option><option value="application">application</option><option value="mesh">mesh</option><option value="avatar">avatar</option><option value="spells">spells</option></select>
          <button type="submit" style="padding: 5px 15px; background: #28a745; color: white; border: none; cursor: pointer; border-radius: 3px;">✓ Promote</button>
        </form>
        <form method="post" action="/board/discard/${entry.id}" style="display: inline;">
          <input name="board_note" placeholder="Board note" style="padding: 5px; width: 300px;"/>
          <button type="submit" style="padding: 5px 15px; background: #dc3545; color: white; border: none; cursor: pointer; border-radius: 3px;">✗ Discard</button>
        </form>
      </div>` : '<p>This cycle has been reviewed. The original conversation remains available above for comparison.</p>'}
    </li>`;
  }).join('');
  
  return res.type('text/html').send(`<html>
    <head>
      <title>Board Review</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { margin-bottom: 20px; }
        a { color: #0066cc; text-decoration: none; margin-right: 20px; }
        a:hover { text-decoration: underline; }
        ul { list-style: none; padding: 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Board Review - Conversation Audit</h1>
        <p><a href="/dashboard">Back to Dashboard</a> | <a href="/cycle/run">Run New Cycle</a></p>
        <ul>${rows || '<li style="padding: 20px; background: white; border-radius: 5px;">No cycle reviews recorded.</li>'}</ul>
      </div>
    </body>
  </html>`);
});

router.post('/board/promote/:id', requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  const source = await ledger.getEntryById(id);
  const sourceContent = source ? decodeContent(source) : {};
  const sourceText = typeof sourceContent === 'string' ? sourceContent : JSON.stringify(sourceContent);
  const action = await appendLedgerRecord({ record_type: 'board_action', content_plain: JSON.stringify({
    action: 'promote',
    cycle_id: id,
    note: req.body.board_note || '',
    follow_up_task: req.body.follow_up_task || '',
    source_record_type: source?.record_type || null,
    source_content: sourceContent,
  }), status: 'promoted' });
  if (source) {
    const cycleData = typeof sourceContent === 'object' && sourceContent ? sourceContent : {};
    appendKnowledge({
      title: `Promoted ${source.record_type}`,
      summary: createSummary(cycleData.board_review?.cso_recommendation || sourceText),
      content: sourceText,
      source_cycle_id: id,
      field: cycleData.field,
      role: cycleData.synthesis_agent?.role || '',
    });
  }
  const task = req.body.follow_up_task ? enqueue({ topic: req.body.follow_up_task, field: req.body.follow_up_field || 'operational', source_cycle_id: id }) : null;
  if (String(req.headers.accept || '').includes('text/html')) return res.redirect('/board');
  return res.json({ ok: true, promoted: id, task_created: Boolean(task), task_id: task?.id || null, action_id: action?.id || null });
});

router.post('/board/discard/:id', requireAdminAuth, async (req, res) => {
  const id = req.params.id;
  const source = await ledger.getEntryById(id);
  const sourceContent = source ? decodeContent(source) : {};
  const action = await appendLedgerRecord({ record_type: 'board_action', content_plain: JSON.stringify({
    action: 'discard',
    cycle_id: id,
    note: req.body.board_note || '',
    source_record_type: source?.record_type || null,
    source_content: sourceContent,
  }), status: 'promoted' });
  if (String(req.headers.accept || '').includes('text/html')) return res.redirect('/board');
  return res.json({ ok: true, discarded: id, action_id: action?.id || null });
});

router.get('/knowledge/fetch/:hash', requireAdminAuth, (req, res) => {
  const record = fetchKnowledgeByHash(req.params.hash);
  if (!record) return res.status(404).json({ ok: false, error: 'Knowledge record not found' });
  return res.json({ ok: true, record });
});

// Single-slot cache for the last /chat test result (admin-only manual testing tool).
let lastChatResult = null;

router.get('/chat', requireAdminAuth, (req, res) => {
  const message = String(req.query.message || 'Hello network');
  const agents = loadAgentPool();
  const agentOptions = agents.map((a) => `<option value="${a.id}">${a.label} (${a.role})</option>`).join('');
  const resultBlock = lastChatResult
    ? `<h2>Result</h2><p><strong>Provider:</strong> ${lastChatResult.provider} &nbsp; <strong>Model:</strong> ${lastChatResult.model}</p><p>${lastChatResult.content}</p>${renderJson('Full result (prompt sent + raw response)', lastChatResult)}`
    : '';
  return res.type('text/html').send(`<html><head><title>Chat Explorer</title></head><body>
<h1>Chat Explorer</h1>
<p><a href="/dashboard">Back to Dashboard</a></p>
<form method="post" action="/chat">
<label>Agent: <select name="agent_id">${agentOptions}</select></label><br/>
<textarea name="message" rows="4" cols="70">${message}</textarea><br/>
<button type="submit">Send</button>
</form>
${resultBlock}
</body></html>`);
});

router.post('/chat', requireAdminAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  const agent_id = String(req.body.agent_id || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const agents = loadAgentPool();
  const agent = agents.find((a) => a.id === agent_id) || agents[0];
  const constitution = await loadConfigConstitution().catch(() => null);
  const chatContext = await buildChatContext(message);
  const promptText = buildAgentPrompt({ agent, role: 'chat', prompt: chatContext.enrichedMessage, constitution, conversation: [], limit: 1 });

  const agentResponse = await invokeAgent({ agent_id: agent.id, prompt: promptText, provider: agent.provider }).catch((err) => ({ ok: false, error: err.message }));

  lastChatResult = {
    agent_id: agent.id,
    role: 'chat',
    provider: agentResponse.provider || agent.provider,
    model: agentResponse.model || agent.model,
    ok: agentResponse.ok,
    content: agentResponse.content || `[error: ${agentResponse.error}]`,
    prompt_sent: promptText,
    context_hashes: chatContext.contextHashes,
    tokens_used: agentResponse.tokens_used || 0,
  };

  await persistChatTurn({ userMessage: message, agentResponse: lastChatResult.content, contextHashes: chatContext.contextHashes, briefVersion: constitution?.version || null });
  // Redirect back to chat page to show updated conversation
  return res.redirect(`/chat?message=${encodeURIComponent(message)}`);
});

const formatEnvValue = (value) => {
  if (value === undefined || value === null) return '';
  const str = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return JSON.stringify(str);
};

const writeEnvFile = (updates = {}) => {
  const envPath = path.join(__dirname, '../../.env');
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const parsed = Object.fromEntries(raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, '')];
  }));
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
        ${viewMode && displayedJson ? `<h2>Latest Constitution</h2>${renderJson('Constitution JSON', JSON.parse(displayedJson))}` : ''}
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
            <li><a href="/status">/status</a></li>
            <li><a href="/ledger">/ledger</a></li>
            <li><a href="/ledger/test">/ledger/test</a></li>
            <li><a href="/board">/board</a></li>
            <li><a href="/agents">/agents</a></li>
            <li><a href="/chat">/chat</a></li>
            <li><a href="/cycle/run">/cycle/run</a></li>
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

// ===== AGENT KEYCHAIN ROUTES =====

router.get('/agents/list', (req, res) => {
  try {
    const agents = loadAgentPool().map((agent) => ({
      id: agent.id,
      label: agent.label,
      provider: agent.provider,
      model: agent.model,
      role: agent.role,
      brief: agent.brief,
      active: agent.active,
    }));
    return res.json({ ok: true, agents });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents/keychain', requireAdminAuth, (req, res) => {
  try {
    const secrets = keychain.listAgentSecrets();
    return res.json({ ok: true, agents: secrets });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents/models/:provider', requireAdminAuth, async (req, res) => {
  try {
    const { provider: providerId } = req.params;
    const { agent_id } = req.query;

    let api_key = req.query.api_key;

    if (agent_id) {
      const secret = keychain.getAgentSecret(agent_id);
      api_key = api_key || secret?.api_key;
    }

    const result = await modelRegistry.fetchProviderModels(providerId, { api_key });
    const provider = providers.getProvider(providerId);
    return res.json({ ok: result.ok, models: result.models, fallback_models: provider?.fallbackModels || [], error: result.error, cached: result.cached });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/agents/models/:provider', requireAdminAuth, async (req, res) => {
  try {
    const { provider: providerId } = req.params;
    const { api_key } = req.body || {};
    const provider = providers.getProvider(providerId);
    if (!provider) {
      return res.status(400).json({ ok: false, error: `Unknown provider: ${providerId}` });
    }
    const result = await modelRegistry.fetchProviderModels(providerId, { api_key });
    const models = result.models.map((model) => ({
      ...model,
      free: model.pricing && Number(model.pricing.prompt || 0) === 0 && Number(model.pricing.completion || 0) === 0,
    }));
    return res.json({
      ok: result.ok,
      provider: providerId,
      endpoint: provider?.buildModelsUrl(provider?.defaultApiUrl, 'redacted').replace(/([?&]key=)[^&]+/, '$1redacted'),
      model_count: models.length,
      models,
      error: result.error,
      cached: result.cached,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/agents/profiles/test', requireAdminAuth, async (req, res) => {
  try {
    const { provider, model, api_key } = req.body || {};
    if (!provider || !model || !api_key) {
      return res.status(400).json({ ok: false, error: 'provider, model, and api_key are required' });
    }

    const result = await invokeChatCompletion(provider, {
      model: String(model).trim(),
      api_key: String(api_key).trim(),
      prompt: 'Reply with exactly: connection verified.',
    });
    return res.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      tokens_used: result.tokens_used || 0,
      content: result.content,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/agents/usage', requireAdminAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '500', 10);
    const summary = usageMetrics.getUsageSummary({ limit });
    return res.json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents/health', requireAdminAuth, async (req, res) => {
  try {
    const secrets = keychain.listAgentSecrets();
    const results = await Promise.all(secrets.map(async (secret) => {
      const agentDef = loadAgentPool().find((a) => a.id === secret.agent_id);
      const requestedModel = secret.model || agentDef?.model || null;

      if (!secret.api_key) {
        return { agent_id: secret.agent_id, provider: secret.provider, configured_model: requestedModel, status: 'no_api_key' };
      }
      if (secret.provider === 'local') {
        return { agent_id: secret.agent_id, provider: secret.provider, configured_model: requestedModel, status: 'local' };
      }

      const resolution = await modelRegistry.resolveModel(secret.provider, requestedModel, { api_key: secret.api_key, api_url: secret.api_url });
      return {
        agent_id: secret.agent_id,
        provider: secret.provider,
        configured_model: requestedModel,
        resolved_model: resolution.model,
        source: resolution.source,
        warning: resolution.warning || null,
        status: resolution.source.includes('unverified') ? 'unverified' : resolution.source === 'requested' ? 'ok' : 'fallback',
      };
    }));
    return res.json({ ok: true, agents: results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents/keychain/test', requireAdminAuth, (req, res) => {
  try {
    const { agent_id, api_key, provider, api_url, model } = req.query;
    
    if (!agent_id || !api_key) {
      return res.type('text/html').send(`
        <html>
          <head><title>Agent Keychain Test</title></head>
          <body>
            <h1>Agent Keychain Test Form</h1>
            <p>Use this to test saving API keys directly via URL.</p>
            <form method="get">
              <label>Agent ID: <select name="agent_id">
                <option value="agent-alpha">agent-alpha (OpenRouter)</option>
                <option value="agent-beta">agent-beta (Groq)</option>
                <option value="agent-cso">agent-cso (OpenRouter)</option>
              </select></label><br/><br/>
              <label>Provider: <select name="provider">
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
              </select></label><br/><br/>
              <label>API Key: <input name="api_key" type="password" size="60"/></label><br/><br/>
              <label>API URL (optional): <input name="api_url" size="60"/></label><br/><br/>
              <label>Model (optional override, e.g. mistralai/mistral-7b-instruct:free): <input name="model" size="60"/></label><br/><br/>
              <button type="submit">Test Save to Keychain</button>
            </form>
            <p><a href="/agents">Back to Agent Manager</a></p>
          </body>
        </html>
      `);
    }

    // Save via POST internally
    const secret = keychain.setAgentSecret(agent_id, { api_key, api_url, provider, model });
    
    return res.type('text/html').send(`
      <html>
        <head><title>Keychain Test Result</title></head>
        <body>
          <h1>Keychain Test Result</h1>
          <h2>SUCCESS - Agent saved to server keychain!</h2>
          ${renderJson('Agent secret', secret)}
          <p><a href="/agents/keychain/debug">View Debug Info</a> | <a href="/agents">Back to Agent Manager</a></p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[KEYCHAIN TEST]', err.message, err.stack);
    return res.status(500).type('text/html').send(`
      <html>
        <head><title>Keychain Test Error</title></head>
        <body>
          <h1 style="color: red;">ERROR</h1>
          <pre>${err.message}\n${err.stack}</pre>
          <p><a href="/agents/keychain/test">Back to Test Form</a></p>
        </body>
      </html>
    `);
  }
});

router.get('/agents/keychain/debug', requireAdminAuth, (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const keychainPath = path.join(__dirname, '../../config/keychain.json.enc');
    const keychainExists = fs.existsSync(keychainPath);
    const masterKeySet = Boolean(process.env.MASTER_KEY || process.env.CONSTITUTION_KEY);
    
    const secrets = keychain.listAgentSecrets();
    const debug = {
      masterkey_env_set: masterKeySet,
      keychain_file_exists: keychainExists,
      keychain_path: keychainPath,
      agents_in_keychain: secrets.length,
      agents: secrets.map((a) => ({
        agent_id: a.agent_id,
        provider: a.provider,
        model: a.model,
        has_api_key: Boolean(a.api_key && a.api_key.length > 0),
        api_key_length: a.api_key ? a.api_key.length : 0,
        status: a.status,
        last_tested: a.last_tested,
      })),
    };
    
    return res.json({ ok: true, debug });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents', (req, res) => {
  try {
    const viewPath = path.join(__dirname, 'views', 'agents.html');
    const html = fs.readFileSync(viewPath, 'utf8');
    return res.type('text/html').send(html);
  } catch (err) {
    return res.status(500).type('text/plain').send(`Failed to load agent manager: ${err.message}`);
  }
});

router.post('/agents/keychain', requireAdminAuth, async (req, res) => {
  try {
    const { agent_id, api_key, provider, model, preferred } = req.body || {};

    if (!agent_id || !api_key) {
      return res.status(400).json({ ok: false, error: 'agent_id and api_key required' });
    }

    console.log(`[KEYCHAIN] Saving ${agent_id} (provider: ${provider})`);
    const agent = keychain.setAgentSecret(agent_id, { api_key, provider, model, preferred });
    console.log(`[KEYCHAIN] Saved ${agent_id}: status=${agent.status}, api_key_length=${agent.api_key?.length || 0}`);
    return res.json({ ok: true, agent });
  } catch (err) {
    console.error(`[KEYCHAIN] Error saving ${req.body?.agent_id}:`, err.message, err.stack);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/agents/test/:agentId', requireAdminAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await invokeAgent({
      agent_id: agentId,
      prompt: 'Reply with exactly: connection verified.',
      allowFallback: false,
    });
    return res.json({
      ok: result.provider !== 'local',
      requested_agent_id: result.requested_agent_id || agentId,
      profile_agent_id: result.profile_agent_id || agentId,
      used_fallback_profile: result.profile_agent_id && result.profile_agent_id !== agentId,
      provider: result.provider,
      model: result.model,
      tokens_used: result.tokens_used || 0,
      content: result.content,
      error: result.failure_reason || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/agents/keychain/:agentId', requireAdminAuth, (req, res) => {
  try {
    const { agentId } = req.params;
    const success = keychain.deleteAgentSecret(agentId);

    if (!success) {
      return res.status(404).json({ ok: false, error: 'Agent secret not found' });
    }

    return res.json({ ok: true, message: `Agent ${agentId} secret deleted` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
