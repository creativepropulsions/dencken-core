const ledger = require('../core/ledger');
const { loadAgentPool } = require('../agents/pool');
const { list } = require('../core/taskqueue');
const { getNodeId } = require('../core/identity');

const assessAgent = (agent) => {
	if (agent.active === false) return { status: 'inactive', reason: 'disabled' };
	if (!agent.model) return { status: 'degraded', reason: 'missing model' };
	return { status: 'ok', reason: null };
};

const getAgentStatuses = (agents) => Object.fromEntries((agents || []).map((agent) => [agent.id, { ...assessAgent(agent), provider: agent.provider || 'local', role: agent.role || 'observer' }]));

const runPulseCheck = async () => {
	const payload = {
		node_id: getNodeId(),
		ledger_height: await ledger.getLedgerHeight(),
		task_queue_depth: list().filter((task) => task.status === 'pending').length,
		agent_statuses: getAgentStatuses(loadAgentPool()),
		checked_at: new Date().toISOString(),
	};
	const entry = await ledger.appendRecord({ record_type: 'pulse', content_plain: JSON.stringify(payload) });
	return { ok: true, entry, payload };
};

let timer = null;
const startPulseScheduler = ({ intervalMs = Number(process.env.PULSE_INTERVAL_MS || 30000) } = {}) => {
	if (!timer) timer = setInterval(() => runPulseCheck().catch(() => undefined), Math.max(1000, intervalMs));
	return timer;
};
const stopPulseScheduler = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = { runPulseCheck, startPulseScheduler, stopPulseScheduler, getAgentStatuses };
