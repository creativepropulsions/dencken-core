const ledger = require('../core/ledger');
const { loadAgentPool } = require('../agents/pool');
const taskqueue = require('../core/taskqueue');
const constitution = require('../core/constitutionStore');
const identity = require('../core/identity');

const decodeRecord = (entry) => {
	try { return JSON.parse(Buffer.from(entry.content_encrypted || '', 'base64').toString('utf8')); } catch (err) { return null; }
};
const cycleDiversityTrend = async () => {
	const entries = await ledger.getEntries({ limit: 200 });
	const values = entries
		.filter((entry) => entry.record_type === 'deliberation_cycle_result')
		.map(decodeRecord)
		.map((record) => Number(record?.provider_diversity))
		.filter(Number.isFinite)
		.slice(0, 5);
	return values.length ? values.reduce((total, value) => total + Math.max(0, Math.min(1, value)), 0) / values.length : 1;
};

const getAgentStatuses = (agents) => Object.fromEntries((agents || []).map((agent) => [agent.id, agent.health?.state || 'unknown']));

const runPulse = async () => {
	const agents = loadAgentPool();
	const agent_statuses = getAgentStatuses(agents);
	const lastCycle = await ledger.getLastByType('deliberation_cycle_result');
	const diversityTrend = await cycleDiversityTrend();
	const taskQueueDepth = taskqueue.list().filter((task) => task.status === 'pending').length;
	const constitutionLoaded = await constitution.isLoaded();
	const identityReady = identity.isReady();
	const lastCycleAge = lastCycle ? Date.now() - new Date(lastCycle.created_at).getTime() : null;
	const states = Object.values(agent_statuses);
	const ledgerReadable = typeof ledger.isAvailable === 'function' && ledger.isAvailable();
	const allAgentsError = states.length > 0 && states.every((state) => state === 'error');
	const critical = !ledgerReadable || !constitutionLoaded || !identityReady || allAgentsError;
	const degraded = states.includes('degraded') || (lastCycleAge !== null && lastCycleAge > 24 * 60 * 60 * 1000) || taskQueueDepth > 50 || diversityTrend < 0.5;
	const overall = critical ? 'critical' : degraded ? 'degraded' : 'ok';
	const payload = {
		node_id: identity.getNodeId(),
		ledger_height: await ledger.getLedgerHeight(),
		last_cycle_at: lastCycle?.created_at || null,
		task_queue_depth: taskQueueDepth,
		constitution_loaded: constitutionLoaded,
		identity_ready: identityReady,
		agent_statuses,
		provider_diversity_trend: diversityTrend,
		overall,
		checked_at: new Date().toISOString(),
	};
	if (overall === 'critical') console.error(`[PULSE] CRITICAL ${payload.checked_at}`, payload);
	const entry = await ledger.appendRecord({ record_type: 'pulse', content_plain: JSON.stringify(payload), audience: 'internal', graph_type: 'task_state', status: 'promoted' });
	return { ok: true, entry, payload };
};

let timer = null;
const startPulseScheduler = ({ intervalMs = Number(process.env.PULSE_INTERVAL_MS || 30000) } = {}) => {
	if (!timer) timer = setInterval(() => runPulse().catch((error) => console.error('[PULSE] error:', error.message)), Math.max(1000, intervalMs));
	return timer;
};
const stopPulseScheduler = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = { runPulse, runPulseCheck: runPulse, startPulseScheduler, stopPulseScheduler, getAgentStatuses };
