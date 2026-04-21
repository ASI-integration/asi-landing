/**
 * PM2 process for asi-global.ru (and related hosts).
 *
 * Deterministic runtime root:
 * - cwd is ALWAYS `/var/www/asi/current`
 * - env.ASI_APP_ROOT is ALWAYS `/var/www/asi/current`
 *
 * This prevents any old/new release split after a symlink switch.
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

// IMPORTANT:
// Never anchor runtime to the directory where this config *physically* lives.
// During deploy we read this file via `/var/www/asi/current/ecosystem.config.cjs`,
// but depending on symlink resolution PM2/Node may treat `__dirname` as an older
// release directory. Always use the deterministic root instead.
const root = '/var/www/asi/current';
const envDir = root;
const fromLive = parseEnvFile(path.join(envDir, '.env.production.live'));
const fromLocal = parseEnvFile(path.join(envDir, '.env.production.local'));
const fileEnv = { ...fromLocal, ...fromLive };
delete fileEnv.ASI_RELEASE_SHA;

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
        ASI_APP_ROOT: root,
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
