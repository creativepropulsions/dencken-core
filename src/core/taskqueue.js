const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../../data');
const queuePath = path.join(dataDir, 'tasks.json');
const seedPath = path.join(__dirname, '../../config/tasks.json');
const id = () => crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ensure = () => { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); };
const read = (filePath, fallback = []) => { try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback; } catch (err) { return fallback; } };
const list = () => { ensure(); const tasks = read(queuePath, []); return Array.isArray(tasks) ? tasks : []; };
const save = (tasks) => { ensure(); fs.writeFileSync(queuePath, JSON.stringify(tasks, null, 2), 'utf8'); return tasks; };
const bootstrapQueue = () => { if (!fs.existsSync(queuePath)) save(read(seedPath, [])); return list(); };
const enqueue = (task = {}) => { const next = { id: task.id || id(), topic: String(task.topic || task.summary || 'new task').trim(), source_cycle_id: task.source_cycle_id || null, created_at: task.created_at || new Date().toISOString(), status: task.status || 'pending', metadata: task.metadata || {} }; if (!next.topic) throw new Error('Task topic is required'); save([...list(), next]); return next; };
const dequeue = () => { const tasks = list(); if (!tasks.length) return null; save(tasks.slice(1)); return tasks[0]; };
const peek = () => list()[0] || null;
const markComplete = (taskId) => { let found = null; const tasks = list().map((task) => { if (task.id !== taskId) return task; found = { ...task, status: 'completed', completed_at: new Date().toISOString() }; return found; }); if (found) save(tasks); return found; };
bootstrapQueue();
module.exports = { bootstrapQueue, enqueue, dequeue, peek, list, markComplete, queuePath };
