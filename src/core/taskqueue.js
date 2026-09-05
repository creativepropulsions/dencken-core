const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../../data');
const queuePath = path.join(dataDir, 'tasks.json');
const seedPath = path.join(__dirname, '../../config/tasks.json');
const id = () => crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ensure = () => { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); };
const read = (filePath, fallback = []) => { try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback; } catch (err) { return fallback; } };
const normalize = (task = {}) => ({
	id: task.id || id(),
	topic: String(task.topic || task.summary || 'new task').trim(),
	field: String(task.field || 'operational'),
	source_cycle_id: task.source_cycle_id || null,
	created_at: task.created_at || new Date().toISOString(),
	status: task.status || 'pending',
	attempts: Number(task.attempts || 0),
	metadata: task.metadata || {},
});
const list = () => {
	ensure();
	const stored = read(queuePath, null);
	if (Array.isArray(stored) && stored.length) return stored.map(normalize);
	const seed = read(seedPath, []);
	return Array.isArray(seed) ? seed.map(normalize) : [];
};
const save = (tasks) => { ensure(); fs.writeFileSync(queuePath, JSON.stringify(tasks, null, 2), 'utf8'); return tasks; };
const bootstrapQueue = () => list();
const enqueue = (task = {}) => { const next = normalize(task); if (!next.topic) throw new Error('Task topic is required'); save([...list(), next]); return next; };
const peek = () => list().find((task) => task.status === 'pending') || null;
const update = (taskId, transform) => {
	let found = null;
	const tasks = list().map((task) => {
		if (task.id !== taskId) return task;
		found = transform(task);
		return found;
	});
	if (found) save(tasks);
	return found;
};
const dequeue = () => {
	const task = peek();
	return task ? update(task.id, (current) => ({ ...current, status: 'running', started_at: new Date().toISOString() })) : null;
};
const markComplete = (taskId) => update(taskId, (task) => ({ ...task, status: 'completed', completed_at: new Date().toISOString() }));
const markFailed = (taskId) => update(taskId, (task) => {
	const attempts = task.attempts + 1;
	return { ...task, attempts, status: attempts <= 1 ? 'pending' : 'failed', failed_at: new Date().toISOString() };
});

module.exports = { bootstrapQueue, enqueue, dequeue, peek, list, markComplete, markFailed, queuePath };
