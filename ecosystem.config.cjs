/**
 * PM2 process for asi-global.ru (and related hosts).
 * Run from repo root on the VPS: pm2 startOrReload ecosystem.config.cjs
 *
 * Reads `.env.production.live` and `.env.production.local` (deploy copies live → local before build).
 * `.env.production.live` wins on duplicate keys so a manual edit to live is not overridden by a
 * stale local copy when someone runs `pm2 restart` without re-copying.
 * Injects vars into the process env so Next `next start` always sees server secrets (e.g.
 * GOOGLE_CLIENT_SECRET) and OAuth flags even if dotenv resolution from cwd differs under PM2.
 */
const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const root = __dirname;
const fromLive = parseEnvFile(path.join(root, '.env.production.live'));
const fromLocal = parseEnvFile(path.join(root, '.env.production.local'));
const fileEnv = { ...fromLocal, ...fromLive };

module.exports = {
  apps: [
    {
      name: 'asi-landing',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
