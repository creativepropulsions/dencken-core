const http = require('http');
const { URL } = require('url');

const parseRoute = (pattern) => {
  const names = [];
  const source = pattern.split('/').map((part) => {
    if (part.startsWith(':')) {
      names.push(part.slice(1));
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${source}/?$`), names };
};

const createResponse = (res) => {
  res.type = (type) => {
    res.setHeader('Content-Type', type.includes('/') ? type : `text/${type}; charset=utf-8`);
    return res;
  };
  res.send = (body) => {
    if (!res.headersSent) res.end(String(body));
    return res;
  };
  res.json = (body) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    }
    return res;
  };
  res.status = (status) => {
    res.statusCode = status;
    return res;
  };
  res.redirect = (location) => {
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.end();
    return res;
  };
  return res;
};

const runHandlers = async (handlers, req, res) => {
  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (!handler || res.writableEnded) return;
    await handler(req, res, next);
  };
  await next();
};

const createRouter = () => {
  const routes = [];
  const router = {
    get(pattern, ...handlers) { routes.push({ method: 'GET', ...parseRoute(pattern), handlers }); return router; },
    post(pattern, ...handlers) { routes.push({ method: 'POST', ...parseRoute(pattern), handlers }); return router; },
    async handle(req, res) {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const route = routes.find((candidate) => candidate.method === req.method && candidate.regex.test(requestUrl.pathname));
      if (!route) return false;
      const match = route.regex.exec(requestUrl.pathname);
      req.params = {};
      route.names.forEach((name, index) => { req.params[name] = decodeURIComponent(match[index + 1]); });
      req.query = Object.fromEntries(requestUrl.searchParams.entries());
      await runHandlers(route.handlers, req, res);
      return true;
    },
  };
  return router;
};

const parseBody = (req) => new Promise((resolve, reject) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return resolve({});
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 5 * 1024 * 1024) reject(new Error('Request body too large')); });
  req.on('end', () => {
    if (!raw) return resolve({});
    try {
      const contentType = String(req.headers['content-type'] || '');
      resolve(contentType.includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw).entries()));
    } catch (err) {
      reject(err);
    }
  });
  req.on('error', reject);
});

const createApp = () => {
  const middlewares = [];
  const appRoutes = [];
  const app = {
    use(pathOrHandler, maybeHandler) {
      middlewares.push(typeof pathOrHandler === 'string' ? { prefix: pathOrHandler, handler: maybeHandler } : { prefix: null, handler: pathOrHandler });
      return app;
    },
    get(pattern, ...handlers) { appRoutes.push({ method: 'GET', ...parseRoute(pattern), handlers }); return app; },
    listen(port, host, callback) {
      const server = http.createServer(async (request, response) => {
        const res = createResponse(response);
        try {
          request.body = await parseBody(request);
          let handled = false;
          for (const middleware of middlewares) {
            if (middleware.handler && middleware.handler.handle) continue;
            if (middleware.prefix === null || new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname.startsWith(middleware.prefix)) {
              await middleware.handler(request, res, async () => {});
            }
          }
          const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
          const route = appRoutes.find((candidate) => candidate.method === request.method && candidate.regex.test(requestUrl.pathname));
          if (route) {
            const match = route.regex.exec(requestUrl.pathname);
            request.params = {};
            route.names.forEach((name, index) => { request.params[name] = decodeURIComponent(match[index + 1]); });
            request.query = Object.fromEntries(requestUrl.searchParams.entries());
            await runHandlers(route.handlers, request, res);
            handled = true;
          } else {
            const mounted = middlewares.find((middleware) => middleware.prefix === '/' && middleware.handler && middleware.handler.handle);
            if (mounted) handled = await mounted.handler.handle(request, res);
          }
          if (!handled && !res.writableEnded) res.status(404).send('Not found');
        } catch (err) {
          if (!res.writableEnded) res.status(500).json({ ok: false, error: err.message });
        }
      });
      return server.listen(port, host, callback);
    },
  };
  return app;
};

module.exports = { createApp, createRouter };
