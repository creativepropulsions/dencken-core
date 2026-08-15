const { loadAgentPool } = require('./pool');
const ledger = require('../core/ledger');

const defaultPrompt = 'Propose a new action for the network.';

const chooseAgent = (agents, role) => {
  return agents.find((agent) => agent.role === role) || agents[0] || null;
};

const makeContent = (stage, prompt, initiator, respondent) => {
  switch (stage) {
    case 'initiator_proposal':
      return `${initiator.label} (${initiator.id}) proposes: ${prompt}`;
    case 'respondent_response':
      return `${respondent.label} (${respondent.id}) responds to ${initiator.label}: I reviewed the proposal and suggest a refinement that improves resilience and clarity.`;
    case 'synthesis':
      return `Synthesis by the board: we accept the proposal with the following summary and next step. ${respondent.label}'s refinement has been incorporated.`;
    default:
      return `${stage}: ${prompt}`;
  }
};

const simulateDeliberationCycle = async (opts = {}) => {
  const prompt = opts.prompt || defaultPrompt;
  const agents = loadAgentPool();
  const initiator = chooseAgent(agents, 'initiator');
  const respondent = chooseAgent(agents, 'respondent') || initiator;

  if (!initiator || !respondent) {
    throw new Error('Unable to select cycle agents from pool.');
  }

  const stages = [
    { record_type: 'initiator_proposal', author: initiator, prompt },
    { record_type: 'respondent_response', author: respondent, prompt },
    { record_type: 'synthesis', author: respondent, prompt },
  ];

  const entries = [];
  for (const stage of stages) {
    const content_plain = makeContent(stage.record_type, prompt, initiator, respondent);
    const entry = await ledger.appendRecord({ record_type: stage.record_type, content_plain });
    entries.push(entry);
  }

  return {
    ok: true,
    prompt,
    initiator,
    respondent,
    entries,
  };
};

module.exports = {
  simulateDeliberationCycle,
};
