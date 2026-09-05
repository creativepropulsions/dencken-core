const fs = require('fs');
const path = require('path');
const { defaultHealth, getHealth } = require('./health');

const AGENTS_CONFIG_PATH = path.join(__dirname, '../../config/agents.json');
const DEFAULT_AGENTS = [
  {
    id: 'agent-alpha',
    label: 'Alpha',
    provider: 'openrouter',
    model: 'mistralai/mistral-7b-instruct',
    role: 'initiator',
    brief: 'Chief Proposer: articulate the network topic and initial position.',
    active: true,
    health: defaultHealth(),
  },
  {
    id: 'agent-beta',
    label: 'Beta',
    provider: 'groq',
    model: 'llama3-8b-8192',
    role: 'respondent',
    brief: 'Strategic Respondent: review proposals and identify risks, opportunities, and refinements.',
    active: true,
    health: defaultHealth(),
  },
  {
    id: 'agent-cso',
    label: 'Chief Strategy Officer',
    provider: 'openrouter',
    model: 'mistralai/mistral-large-latest',
    role: 'synthesis',
    brief: 'Chief Strategy Officer (CSO): synthesize deliberation branches, assess risks and benefits, recommend board actions (promote to knowledge or discard), and chart next strategic steps.',
    active: true,
    health: defaultHealth(),
  },
];

const normalizeAgent = (agent = {}) => {
  const id = agent.id || agent.name || 'agent-unnamed';
  return {
  id,
  label: agent.label || agent.name || agent.id || 'Unnamed Agent',
  provider: agent.provider || 'local',
  model: agent.model || 'local-simulation',
  role: agent.role || 'observer',
  brief: agent.brief || '',
  active: agent.active !== false,
  ...agent,
  health: { ...defaultHealth(), ...agent.health, ...getHealth(id) },
  };
};

const getConstitutionAgents = (constitution) => {
  const candidates = [constitution && constitution.agents, constitution && constitution.agent_pool];
  return candidates.find(Array.isArray) || [];
};

const loadAgentPool = (constitution = null) => {
  try {
    if (!fs.existsSync(AGENTS_CONFIG_PATH)) {
      // Config file not found, falling back to DEFAULT_AGENTS (normal on first run)
      const constitutionalAgents = getConstitutionAgents(constitution).map(normalizeAgent);
      return constitutionalAgents.length ? constitutionalAgents : DEFAULT_AGENTS.map(normalizeAgent);
    }

    const raw = fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.agents)) {
      console.warn('Agent config file does not contain agents array.');
      return DEFAULT_AGENTS.map(normalizeAgent);
    }

    const activeAgents = parsed.agents.map(normalizeAgent).filter((agent) => agent.active === true);
    return activeAgents.length > 0 ? activeAgents : DEFAULT_AGENTS.map(normalizeAgent);
  } catch (error) {
    console.error('Failed to load agents pool:', error.message);
    return DEFAULT_AGENTS.map(normalizeAgent);
  }
};

module.exports = {
  loadAgentPool,
  normalizeAgent,
  DEFAULT_AGENTS,
};
