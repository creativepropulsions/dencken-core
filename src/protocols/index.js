/**
 * Dencken Protocols Layer
 * Network communication and inter-node message protocols
 *
 * Phase 0: Not used (single-node servernode prototype)
 *
 * Phase 1b+: Multi-node architecture
 *   - Node Discovery Protocol: Announce presence and agent pool
 *   - Agent Invocation Protocol: Request agent execution from peer
 *   - Ledger Sync Protocol: Distributed append-only log synchronization
 *   - Task Distribution Protocol: Assign work to peer nodes
 *   - Verification Protocol: Cryptographic proof of remote execution
 *
 * Message flow example (Agent Invocation):
 *
 * RequestNode (ServerNode)              | PeerNode (DeviceNode)
 * ─────────────────────────────────────┼──────────────────────────
 * 1. Build request payload              |
 *    - agent_id, cycle_id, prompt       |
 *    - Sign with private key            |
 * 2. POST /protocols/invoke/agent       |
 *    ├─ Header: X-Request-Signature     |
 *    ├─ Header: X-Request-Node          |
 *    └─ Body: signed request            |
 *                                       | 3. Receive POST /protocols/invoke/agent
 *                                       | 4. Verify signature with requester's public key
 *                                       | 5. Check cycle_id in local ledger (authorized?)
 *                                       | 6. Load agent from keychain
 *                                       | 7. Invoke agent with prompt
 *                                       | 8. Sign response with private key
 * 9. Receive response with signature    |
 * 10. Verify signature with peer's pub key
 * 11. Index to local ledger as remote entry
 */

const PROTOCOL_VERSIONS = {
  AGENT_INVOCATION: 'v1.0',
  LEDGER_SYNC: 'v1.0',
  TASK_DISTRIBUTION: 'v1.0',
  NODE_DISCOVERY: 'v1.0',
};

const MESSAGE_TYPES = {
  AGENT_INVOKE_REQUEST: 'agent_invoke_request',
  AGENT_INVOKE_RESPONSE: 'agent_invoke_response',
  LEDGER_SYNC_REQUEST: 'ledger_sync_request',
  LEDGER_SYNC_RESPONSE: 'ledger_sync_response',
  TASK_ASSIGN: 'task_assign',
  TASK_RESULT: 'task_result',
  NODE_ANNOUNCE: 'node_announce',
  NODE_QUERY: 'node_query',
};

const buildAgentInvokeRequest = (opts = {}) => {
  const { agent_id, cycle_id, prompt, requester_node, request_nonce } = opts;
  return {
    message_type: MESSAGE_TYPES.AGENT_INVOKE_REQUEST,
    protocol_version: PROTOCOL_VERSIONS.AGENT_INVOCATION,
    agent_id,
    cycle_id,
    prompt,
    requester_node,
    request_nonce: request_nonce || require('crypto').randomUUID(),
    timestamp: new Date().toISOString(),
  };
};

const buildAgentInvokeResponse = (opts = {}) => {
  const { agent_id, cycle_id, response, origin_node, request_nonce, ledger_entry_id } = opts;
  return {
    message_type: MESSAGE_TYPES.AGENT_INVOKE_RESPONSE,
    protocol_version: PROTOCOL_VERSIONS.AGENT_INVOCATION,
    agent_id,
    cycle_id,
    response,
    origin_node,
    request_nonce,
    ledger_entry_id,
    timestamp: new Date().toISOString(),
  };
};

const buildNodeAnnounce = (opts = {}) => {
  const { node_id, node_url, agents_available, public_key } = opts;
  return {
    message_type: MESSAGE_TYPES.NODE_ANNOUNCE,
    protocol_version: PROTOCOL_VERSIONS.NODE_DISCOVERY,
    node_id,
    node_url,
    agents_available,
    public_key,
    timestamp: new Date().toISOString(),
  };
};

module.exports = {
  PROTOCOL_VERSIONS,
  MESSAGE_TYPES,
  buildAgentInvokeRequest,
  buildAgentInvokeResponse,
  buildNodeAnnounce,
};
