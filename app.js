// app.js
const path = require('path');
const createBoardServer = require('./src/board/server');
const { loadEnv } = require('./src/core/env');
const { startNodeServices } = require('./src');

loadEnv(path.join(__dirname, '.env'));

const PORT = process.env.PORT || process.env.BOARD_PORT || 3000;
const HOST = '0.0.0.0';

const app = createBoardServer();

if (require.main === module) {
  startNodeServices();
  app.listen(PORT, HOST, () => {
    console.log(`Dencken board server running at http://${HOST}:${PORT}/`);
  });
}

module.exports = app;
