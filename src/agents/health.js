const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const healthPath = path.join(dataDir, 'agent-health.json');
const MAX_SAMPLES = 10;

const defaultHealth = () => ({
  state: 'unknown',
  last_call_at: null,
  last_latency_ms: null,
  baseline_latency_ms: null,
  consecutive_failures: 0,
  last_error: null,
  latency_samples: [],
});

const normalizeHealth = (value = {}) => ({
  ...defaultHealth(),
  ...value,
  latency_samples: Array.isArray(value.latency_samples) ? value.latency_samples.filter(Number.isFinite).slice(-MAX_SAMPLES) : [],
});

const readHealth = () => {
  try {
    if (!fs.existsSync(healthPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[AGENT HEALTH] Failed to read health state:', err.message);
    return {};
  }
};

const writeHealth = (states) => {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(healthPath, JSON.stringify(states, null, 2), 'utf8');
};

const getHealth = (agentId) => normalizeHealth(readHealth()[agentId]);

const updateHealth = (agentId, { ok, latency_ms = null, error = null } = {}) => {
  const states = readHealth();
  const previous = normalizeHealth(states[agentId]);
  const samples = Number.isFinite(latency_ms)
    ? [...previous.latency_samples, latency_ms].slice(-MAX_SAMPLES)
    : previous.latency_samples.slice(-MAX_SAMPLES);
  const baseline = samples.length ? Math.round(samples.reduce((total, sample) => total + sample, 0) / samples.length) : null;
  const failures = ok ? 0 : previous.consecutive_failures + 1;
  const slow = ok && previous.baseline_latency_ms && latency_ms > previous.baseline_latency_ms * 2;
  const state = failures >= 3 ? 'error' : ok ? (slow ? 'degraded' : 'ok') : 'degraded';
  const next = {
    state,
    last_call_at: new Date().toISOString(),
    last_latency_ms: Number.isFinite(latency_ms) ? latency_ms : null,
    baseline_latency_ms: baseline,
    consecutive_failures: failures,
    last_error: ok ? null : String(error || 'Provider call failed'),
    latency_samples: samples,
  };
  states[agentId] = next;
  writeHealth(states);
  return next;
};

const getHealthMap = () => readHealth();

module.exports = { defaultHealth, normalizeHealth, getHealth, getHealthMap, updateHealth, healthPath };
