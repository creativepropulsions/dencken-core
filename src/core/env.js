const fs = require('fs');
const path = require('path');

const loadEnv = (envPath = path.join(__dirname, '../../.env')) => {
  if (!fs.existsSync(envPath)) return process.env;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\n/g, '\n') : value;
  }
  return process.env;
};

module.exports = { loadEnv };
