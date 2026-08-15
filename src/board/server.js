const express = require('express');
const routes = require('./routes');

module.exports = function createBoardServer() {
  const app = express();

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use((req, res, next) => {
    const cookieHeader = req.headers && req.headers.cookie;
    req.cookies = {};
    if (cookieHeader) {
      cookieHeader.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        req.cookies[name] = decodeURIComponent(value);
      });
    }
    next();
  });

  app.get('/ping', (req, res) => {
    res.type('text/plain').send('ok');
  });

  app.use('/', routes);

  return app;
};
