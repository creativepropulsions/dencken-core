const cookieHeaderToObject = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[name] = decodeURIComponent(value);
  });
  return cookies;
};

const getAdminToken = () => {
  const candidates = [
    process.env.ADMIN_TOKEN,
    process.env.BOARD_PASS,
    process.env.MASTER_KEY,
  ];

  const token = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return token ? String(token).trim() : null;
};

const getAdminTokenFromCookie = (req) => {
  const cookies = req.cookies || cookieHeaderToObject(req.headers && req.headers.cookie);
  return cookies.admin_token ? String(cookies.admin_token) : null;
};

const getAdminTokenFromRequest = (req) => {
  if (req.body && req.body.admin_token) return String(req.body.admin_token);
  if (req.query && req.query.admin_token) return String(req.query.admin_token);
  const cookieToken = getAdminTokenFromCookie(req);
  if (cookieToken) return cookieToken;
  const headerToken = req.headers['x-admin-token'];
  if (headerToken) return String(headerToken);
  return null;
};

const isAdminAuthenticated = (req) => {
  const adminToken = getAdminToken();
  const requestToken = getAdminTokenFromRequest(req);
  return Boolean(adminToken && requestToken === adminToken);
};

const createAdminAuthCookie = (token) => {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (process.env.FORCE_SECURE_COOKIES === 'true') {
    flags.push('Secure');
  }
  return `admin_token=${encodeURIComponent(token)}; ${flags.join('; ')}`;
};

const clearAdminAuthCookie = () => 'admin_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax';

const requireAdminAuth = (req, res, next) => {
  const adminToken = getAdminToken();
  if (!adminToken) {
    return res.status(503).json({ ok: false, error: 'ADMIN_TOKEN not configured' });
  }

  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid admin token' });
  }

  next();
};

module.exports = {
  getAdminToken,
  getAdminTokenFromRequest,
  isAdminAuthenticated,
  requireAdminAuth,
  createAdminAuthCookie,
  clearAdminAuthCookie,
};
