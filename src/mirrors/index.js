/**
 * Dencken Mirrors Layer
 * Multi-node agent coordination and delegation
 *
 * Phase 0: Not used (single-node servernode prototype)
 *
 * Phase 1b+: Multi-node architecture
 *   - Mirror: Local proxy for a remote peer's agent
 *   - Borrowing: Request to use another node's agent in my cycle
 *   - Delegation: Assign task to peer node for execution
 *   - Verification: Validate peer agent responses via signature
 *
 * Mirrors enable:
 * 1. Agent Borrowing: "Can I use your CSO for this cycle?"
 * 2. Agent Pooling: "Who has agent-beta available?"
 * 3. Load Balancing: "Distribute this task across peers"
 * 4. Redundancy: "If primary peer unavailable, fall back to secondary"
 *
 * Example mirror structure:
 * {
 *   peer_node_id: "device-1",
 *   peer_node_url: "https://device-1.local:3000",
 *   mirrored_agents: [
 *     {
 *       agent_id: "agent-beta",
 *       available: true,
 *       last_checked: "2026-08-26T..."
 *     }
 *   ]
 * }
 */

const MIRROR_STATES = {
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale', // Last update > 5 min old
};

const createMirror = (peerNodeId, peerNodeUrl) => {
  return {
    peer_node_id: peerNodeId,
    peer_node_url: peerNodeUrl,
    mirrored_agents: [],
    state: MIRROR_STATES.ACTIVE,
    last_sync: null,
    sync_count: 0,
  };
};

const updateMirror = (mirror, agents) => {
  mirror.mirrored_agents = agents;
  mirror.last_sync = new Date().toISOString();
  mirror.sync_count += 1;
  return mirror;
};

const getMirroredAgent = (mirrors, agentId) => {
  for (const mirror of mirrors) {
    const agent = mirror.mirrored_agents.find((a) => a.agent_id === agentId);
    if (agent) {
      return { peer_node_id: mirror.peer_node_id, agent };
    }
  }
  return null;
};

module.exports = {
  MIRROR_STATES,
  createMirror,
  updateMirror,
  getMirroredAgent,
};
