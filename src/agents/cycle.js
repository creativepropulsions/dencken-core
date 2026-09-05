const crypto = require('crypto');
const { loadAgentPool } = require('./pool');
const { invokeAgent } = require('./caller');
const ledger = require('../core/ledger');
const { loadConfigConstitution } = require('../core/constitutionStore');
const { buildKnowledgeContext } = require('../core/knowledge');
const { sanitizePlainText } = require('../core/plainText');
const taskqueue = require('../core/taskqueue');

const defaultPrompt = 'Propose a new action for the network.';
const hashManifest = (manifest) => manifest && crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const buildManifestReference = (manifest) => manifest ? { id: manifest.id || manifest.name || 'manifest', version: manifest.version || 'unknown', hash: hashManifest(manifest), source: 'loaded-constitution' } : null;
const rulesOf = (constitution) => (constitution && (constitution.rules || constitution.policy)) || {};
const maxMessages = (constitution, requested) => Math.max(1, Math.min(20, Number(requested || rulesOf(constitution).max_messages || 3)));
const rolePrompt = (constitution, role) => { const prompts = constitution && constitution.prompts; return (prompts && prompts[role]) || ({ initiator: 'Propose a concrete action based on the topic and constitutional brief.', respondent: 'Review the full conversation, identify risks, and suggest a concrete refinement.', synthesis: 'You are the Chief Strategy Officer. Synthesize all branches, assess benefits and risks, and recommend board actions: PROMOTE (index to knowledge store for future cycles) or DISCARD (archive without promotion). Provide a brief strategic summary and next-cycle recommendation.', chat: 'Respond directly to the user message using only the supplied knowledge summaries. Do not assume a previous cycle conversation is available unless it is named in the knowledge context.' }[role] || 'Reflect on the conversation and propose a next step.'); };
const historyOf = (conversation) => conversation.length ? conversation.map((item) => `${item.author}: ${item.content}`).join('\n') : 'No prior messages.';
const healthRank = { ok: 0, unknown: 1, degraded: 2, error: 3 };
const buildDiverseAgentSequence = (pool = []) => {
  const active = pool.filter((agent) => agent.active !== false && agent.health?.state !== 'error');
  const cso = active.find((agent) => agent.id === 'agent-cso') || active.find((agent) => agent.role === 'synthesis');
  const initiator = cso || active.filter((agent) => agent.role === 'initiator').sort((left, right) => (healthRank[left.health?.state] ?? 1) - (healthRank[right.health?.state] ?? 1))[0] || active[0];
  const respondents = active
    .filter((agent) => agent.id !== initiator?.id && agent.id !== cso?.id)
    .sort((left, right) => {
      const providerOrder = Number(right.provider !== initiator?.provider) - Number(left.provider !== initiator?.provider);
      if (providerOrder) return providerOrder;
      return ['agent-beta', 'agent-alpha'].indexOf(left.id) - ['agent-beta', 'agent-alpha'].indexOf(right.id);
    });
  return { active, initiator, respondents, synthesisAgent: cso || initiator, selected: [initiator, ...respondents].filter(Boolean) };
};
const buildAgentPrompt = ({ agent, role, prompt, constitution, conversation, limit, knowledgeContext = '' }) => `${rolePrompt(constitution, role)}\n\nAgent brief: ${agent.brief || 'No additional brief configured.'}\n\nKnowledge context:\n${knowledgeContext || 'No matching promoted knowledge summaries.'}\n\nConversation:\n${historyOf(conversation)}\n\nYou are ${agent.label} (${agent.id}), acting as ${role}. Per-agent limit: ${limit}.\nCurrent topic: ${prompt}`;
const contentFor = ({ role, agent, prompt, conversation, manifest }) => { const suffix = manifest ? ` [manifest:${manifest.id}@${manifest.version}:${manifest.hash}]` : ''; if (role === 'initiator') return `Initiator message: ${prompt}${suffix}`; const previous = conversation[conversation.length - 1]; if (role === 'synthesis') return `Synthesis by ${agent.label}: the conversation recommends reviewing ${previous ? previous.content.slice(0, 220) : prompt} and scheduling the next action if unresolved.${suffix}`; return `${agent.label} responds after reviewing the conversation: refine the proposal with a concrete, verifiable next step.${suffix}`; };
const pushMessage = async ({ role, agent, prompt, constitution, conversation, entries, manifest, limit, knowledgeContext, activeProviders }) => {
  const promptText = buildAgentPrompt({ agent, role, prompt, constitution, conversation, limit, knowledgeContext });
  
  // Invoke real agent via caller.js
  let agentResponse;
  try {
    agentResponse = await invokeAgent({
      agent_id: agent.id,
      prompt: promptText,
      provider: agent.provider,
      context: { role, conversation, manifest },
      activeProviders: [...activeProviders]
    });

    if (!agentResponse.ok) {
      console.error(`Agent ${agent.id} failed:`, agentResponse.error);
      agentResponse.content = `[Agent error: ${agentResponse.error}]`;
    }
  } catch (error) {
    console.error(`Failed to invoke agent ${agent.id}:`, error.message);
    agentResponse = {
      ok: false,
      content: `[Error invoking agent: ${error.message}]`,
      provider: agent.provider
    };
  }

  const suffix = manifest ? ` [manifest:${manifest.id}@${manifest.version}:${manifest.hash}]` : '';
  const servingProfile = agentResponse.profile_agent_id || agent.id;
  const servingProvider = agentResponse.provider || agent.provider;
  const servingModel = agentResponse.model ? `, model ${agentResponse.model}` : '';
  const fallbackNote = servingProfile !== agent.id ? ` (served by profile ${servingProfile} via ${servingProvider}${servingModel})` : '';
  const content = sanitizePlainText(`${agent.label} (${role})${fallbackNote}: ${agentResponse.content}${suffix}`);

  const record = await ledger.appendRecord({
    record_type: role === 'initiator' ? 'initiator_proposal' : role === 'synthesis' ? 'synthesis' : 'respondent_response',
    content_plain: content,
    brief_version: constitution && constitution.version
  });

  entries.push(record);
  if (agentResponse.provider && agentResponse.provider !== 'local') activeProviders.add(agentResponse.provider);
  conversation.push({
    author: agent.id,
    record_type: record.record_type,
    content,
    prompt: promptText,
    provider: agentResponse.provider,
    profile_agent_id: agentResponse.profile_agent_id || agent.id,
    used_fallback_profile: Boolean(agentResponse.profile_agent_id && agentResponse.profile_agent_id !== agent.id),
    model: agentResponse.model || agent.model,
    tokens_used: agentResponse.tokens_used || 0,
    created_at: record.created_at
  });

  return { record, content, prompt: promptText, agentResponse };
};
const buildBoardReview = (branches, synthesis, synthesisAgent, providerDiversity) => {
  const csoRecommendation = synthesis && synthesis.content ? synthesis.content.slice(0, 500) : 'No CSO synthesis available.';
  return {
    status: branches.length ? 'review_required' : 'no_action',
    summary: branches.length ? `Board review flagged ${branches.length} branch(es). CSO (${synthesisAgent.label}) authority: ${/promote|proceed/i.test(csoRecommendation) ? 'PROMOTION RECOMMENDED' : 'REVIEW REQUIRED'}.` : 'No branches were produced.',
    cso_agent: { id: synthesisAgent.id, label: synthesisAgent.label, role: synthesisAgent.role },
    cso_authority: true,
    cso_recommendation: csoRecommendation,
    provider_diversity: providerDiversity,
    diversity_flag: providerDiversity < 0.3 ? 'critical_provider_concentration' : null,
    branches: branches.map((branch) => ({
      ...branch,
      decision: /recommend|refine|next step|promote|proceed/i.test(branch.latest_summary) ? 'promote' : 'discard',
      tasks: [{ id: `${branch.id}-task`, title: `Review ${branch.label} recommendation`, branch_id: branch.id, status: 'queued', summary: branch.latest_summary }],
    })),
    synthesis,
  };
};

const simulateDeliberationCycle = async (opts = {}) => { 
  const constitution = opts.constitution || (opts.use_manifest ? await loadConfigConstitution() : null) || {}; 
  const manifest = opts.manifest || buildManifestReference(constitution); 
  const selection = buildDiverseAgentSequence(loadAgentPool(constitution));
  const { initiator, respondents, synthesisAgent } = selection;
  if (!initiator || !synthesisAgent) throw new Error('Unable to select cycle agents from pool.'); 
  console.log(`[Cycle] CSO (${synthesisAgent.label}) will author synthesis.`);
  const queuedTask = opts.task || taskqueue.dequeue();
  const prompt = opts.prompt || queuedTask?.topic || defaultPrompt;
  const limit = maxMessages(constitution, opts.max_messages); 
  const entries = []; 
  const conversation = []; 
  const activeProviders = new Set();
  const knowledgeContext = buildKnowledgeContext(prompt, { field: opts.field || queuedTask?.field, limit: 5 });
  await pushMessage({ role: 'initiator', agent: initiator, prompt, constitution, conversation, entries, manifest, limit, knowledgeContext, activeProviders }); 
  const respondentAgents = respondents.length ? respondents : [synthesisAgent];
  const branchByAgent = new Map(respondentAgents.map((agent, index) => [agent.id, {
    id: `branch-${index + 1}-${agent.id}`,
    agent_id: agent.id,
    label: agent.label,
    role: 'respondent',
    responses: [],
  }]));
  for (let turn = 0; turn < limit; turn += 1) {
    for (const agent of respondentAgents) {
      const response = await pushMessage({ role: 'respondent', agent, prompt, constitution, conversation, entries, manifest, limit, knowledgeContext, activeProviders });
      branchByAgent.get(agent.id).responses.push({ turn: turn + 1, author: agent.id, content: response.content, created_at: response.record.created_at });
    }
  }
  const branches = respondentAgents.map((agent) => {
    const branch = branchByAgent.get(agent.id);
    branch.latest_summary = branch.responses[branch.responses.length - 1].content.slice(0, 240);
    return branch;
  });
  const synthesis = await pushMessage({ role: 'synthesis', agent: synthesisAgent, prompt, constitution, conversation, entries, manifest, limit, knowledgeContext, activeProviders });
  const providersUsed = [...activeProviders];
  const providerDiversity = selection.selected.length ? Math.min(1, providersUsed.length / selection.selected.length) : 0;
  if (providerDiversity < 0.5) console.warn(`[Cycle] Provider diversity is low: ${providerDiversity.toFixed(2)}`);
  if (queuedTask?.id) taskqueue.markComplete(queuedTask.id);
  return { 
    ok: true, 
    prompt, 
    task: queuedTask || null,
    initiator, 
    queue: respondents.map((agent) => ({ id: agent.id, label: agent.label, role: agent.role })), 
    synthesis_agent: synthesisAgent, 
    branch_states: branches, 
    board_review: buildBoardReview(branches, synthesis, synthesisAgent, providerDiversity), 
    provider_diversity: providerDiversity,
    providers_used: providersUsed,
    constitution_loaded: Boolean(constitution), 
    manifest, 
    max_message_limit: limit, 
    per_agent_message_limit: limit, 
    total_conversation_messages: conversation.length, 
    entries, 
    conversation 
  }; 
};
module.exports = { simulateDeliberationCycle, buildDiverseAgentSequence, buildManifestReference, hashManifest, buildAgentPrompt };
