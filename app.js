// app.js
const path = require('path');
const cron = require('node-cron');
const createBoardServer = require('./src/board/server');
const { loadEnv } = require('./src/core/env');
const { runPulse } = require('./src/layers/pulse');
const { simulateDeliberationCycle } = require('./src/agents/cycle');

loadEnv(path.join(__dirname, '.env'));

const PORT = process.env.PORT || process.env.BOARD_PORT || 3000;
const HOST = '0.0.0.0';

const app = createBoardServer();

let schedulersStarted = false;
const startSchedulers = () => {
  if (schedulersStarted) return;
  schedulersStarted = true;
  const pulseInterval = parseInt(process.env.PULSE_INTERVAL_MS, 10) || 30000;
  setInterval(() => runPulse().catch((error) => console.error('PULSE error:', error.message)), pulseInterval);
  cron.schedule(process.env.CYCLE_SCHEDULE || '0 */6 * * *', () => simulateDeliberationCycle().catch((error) => console.error('Cycle error:', error.message)));
  runPulse().catch((error) => console.error('Boot PULSE error:', error.message));
};

startSchedulers();

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Dencken board server running at http://${HOST}:${PORT}/`);
  });
}

module.exports = app;
