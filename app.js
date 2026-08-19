// app.js
const path = require('path');
const dotenv = require('dotenv');
const createBoardServer = require('./src/board/server');

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || process.env.BOARD_PORT || 3000;
const HOST = '0.0.0.0';

const app = createBoardServer();

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Dencken board server running at http://${HOST}:${PORT}/`);
  });
}

module.exports = app;
