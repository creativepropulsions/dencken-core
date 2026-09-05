/**
 * Dencken Roles Layer
 * Phase 1: Baseline roles
 *   - CSO (Chief Strategy Officer): Synthesis, board authority
 *   - Agent roles: initiator, respondent, observer, analyst
 *
 * Phase 2+: Extended roles
 *   - Compliance Officer: Policy enforcement
 *   - Risk Officer: Anomaly detection
 *   - Learning Officer: Model optimization
 *
 * Implementation notes:
 * - Roles are constraints on agent capabilities
 * - Each role has a constitutional brief (permissions, responsibilities)
 * - Roles can be verified by looking up agent.role and validating against constitution
 */

const DEFAULT_ROLES = {
  initiator: {
    description: 'Propose topics and initial positions',
    permissions: ['propose', 'initiate_cycle'],
    constraints: [],
  },
  respondent: {
    description: 'Review and respond to proposals',
    permissions: ['respond', 'critique', 'suggest_refinement'],
    constraints: ['cannot_initiate'],
  },
  synthesis: {
    description: 'Synthesize branches and recommend board actions',
    permissions: ['synthesize', 'recommend_promote', 'recommend_discard', 'write_knowledge'],
    constraints: ['only_in_closing'],
  },
  observer: {
    description: 'Monitor but do not participate in deliberation',
    permissions: ['read_ledger', 'read_knowledge'],
    constraints: ['cannot_write', 'cannot_speak'],
  },
  analyst: {
    description: 'Analyze knowledge base and recommend improvements',
    permissions: ['read_ledger', 'read_knowledge', 'analyze', 'write_analysis'],
    constraints: ['cannot_initiate_cycle'],
  },
  // Phase 2+
  // compliance: { ... },
  // risk_monitor: { ... },
  // self_optimizer: { ... },
};

const loadRole = (roleId) => {
  return DEFAULT_ROLES[roleId] || null;
};

const validateAgentRole = (agent, constitution) => {
  // Phase 1b: Validate that agent's role is defined in constitution
  // TODO: Implement constitutional role validation
  return true;
};

module.exports = {
  DEFAULT_ROLES,
  loadRole,
  validateAgentRole,
};
