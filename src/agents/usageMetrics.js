const fs = require('fs');
const path = require('path');

const usagePath = path.join(__dirname, '../../data/usage.jsonl');

const ensureReady = () => {
  const dir = path.dirname(usagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(usagePath)) fs.writeFileSync(usagePath, '', 'utf8');
};

const recordUsage = ({ agent_id, provider, model, tokens_used = 0, ok = true, latency_ms = null, error = null }) => {
  try {
    ensureReady();
    const entry = { agent_id, provider, model, tokens_used, ok, latency_ms, error, at: new Date().toISOString() };
    fs.appendFileSync(usagePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('[USAGE] Failed to record usage:', err.message);
  }
};

const bumpBucket = (bucket, key, entry) => {
  const stat = bucket[key] || { calls: 0, tokens: 0, errors: 0 };
  stat.calls += 1;
  stat.tokens += entry.tokens_used || 0;
  if (!entry.ok) stat.errors += 1;
  bucket[key] = stat;
};

const getUsageSummary = ({ limit = 500 } = {}) => {
  try {
    ensureReady();
    const raw = fs.readFileSync(usagePath, 'utf8').trim();
    if (!raw) return { total_calls: 0, total_tokens: 0, success_count: 0, error_count: 0, by_agent: {}, by_provider: {}, by_model: {} };

    const lines = raw
      .split(/\r?\n/)
      .slice(-limit)
      .map((line) => {
        try { return JSON.parse(line); } catch (err) { return null; }
      })
      .filter(Boolean);

    const summary = { total_calls: lines.length, total_tokens: 0, success_count: 0, error_count: 0, by_agent: {}, by_provider: {}, by_model: {} };

    for (const entry of lines) {
      summary.total_tokens += entry.tokens_used || 0;
      if (entry.ok) summary.success_count += 1; else summary.error_count += 1;
      bumpBucket(summary.by_agent, entry.agent_id, entry);
      bumpBucket(summary.by_provider, entry.provider, entry);
      bumpBucket(summary.by_model, `${entry.provider}:${entry.model}`, entry);
    }

    return summary;
  } catch (err) {
    return { total_calls: 0, total_tokens: 0, by_agent: {}, by_provider: {}, by_model: {}, error: err.message };
  }
};

module.exports = { recordUsage, getUsageSummary };
