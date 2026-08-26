const fs = require('fs');
const path = require('path');

const AGENTS_CONFIG_PATH = path.join(__dirname, '../../config/agents.json');
const DEFAULT_AGENTS = [
  {
    id: 'agent-alpha',
    label: 'Alpha',
    provider: 'openrouter',
    model: 'mistralai/mistral-7b-instruct',
    role: 'initiator',
    active: true,
  },
  {
    id: 'agent-beta',
    label: 'Beta',
    provider: 'groq',
    model: 'llama3-8b-8192',
    role: 'respondent',
    active: true,
  },
];

const normalizeAgent = (agent = {}) => ({
  id: agent.id || agent.name || 'agent-unnamed',
  label: agent.label || agent.name || agent.id || 'Unnamed Agent',
  provider: agent.provider || 'local',
  model: agent.model || 'local-simulation',
  role: agent.role || 'observer',
  brief: agent.brief || '',
  active: agent.active !== false,
  ...agent,
});

const getConstitutionAgents = (constitution) => {
  const candidates = [constitution && constitution.agents, constitution && constitution.agent_pool];
  return candidates.find(Array.isArray) || [];
};

const loadAgentPool = (constitution = null) => {
  try {
    if (!fs.existsSync(AGENTS_CONFIG_PATH)) {
      console.warn('Agent config file not found:', AGENTS_CONFIG_PATH);
      const constitutionalAgents = getConstitutionAgents(constitution).map(normalizeAgent);
      return constitutionalAgents.length ? constitutionalAgents : DEFAULT_AGENTS;
    }

    const raw = fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.agents)) {
      console.warn('Agent config file does not contain agents array.');
      return DEFAULT_AGENTS;
    }

    const activeAgents = parsed.agents.map(normalizeAgent).filter((agent) => agent.active === true);
    return activeAgents.length > 0 ? activeAgents : DEFAULT_AGENTS;
  } catch (error) {
    console.error('Failed to load agents pool:', error.message);
    return DEFAULT_AGENTS;
  }
};

module.exports = {
  loadAgentPool,
  normalizeAgent,
  DEFAULT_AGENTS,
};
