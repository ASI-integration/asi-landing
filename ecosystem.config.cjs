/**
 * PM2 process for asi-global.ru (and related hosts).
 *
 * Uses `ASI_APP_ROOT` from `.env.production.live` when set (deploy writes `/var/www/asi/current`),
 * else `/var/www/asi/current` if that tree exists, else `__dirname` (local dev / nonstandard paths).
 *
 * Runs `next start` via Node on the bundled CLI under `node_modules/next` so cwd stays the app
 * root and no `npm` wrapper subprocess is required.
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

const envDir = __dirname;
const fromLive = parseEnvFile(path.join(envDir, '.env.production.live'));
const fromLocal = parseEnvFile(path.join(envDir, '.env.production.local'));
const fileEnv = { ...fromLocal, ...fromLive };
delete fileEnv.ASI_RELEASE_SHA;

function resolveRuntimeRoot() {
  const fromFile = (fileEnv.ASI_APP_ROOT || '').trim();
  if (fromFile && fs.existsSync(path.join(fromFile, 'package.json'))) {
    return path.resolve(fromFile);
  }
  const standard = '/var/www/asi/current';
  if (fs.existsSync(path.join(standard, 'package.json'))) {
    return standard;
  }
  return path.resolve(envDir);
}

const root = resolveRuntimeRoot();
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

module.exports = {
  apps: [
    {
      name: 'asi-landing',
      cwd: root,
      script: nextBin,
      interpreter: 'node',
      args: ['start', '-H', '127.0.0.1', '-p', '3000'],
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
