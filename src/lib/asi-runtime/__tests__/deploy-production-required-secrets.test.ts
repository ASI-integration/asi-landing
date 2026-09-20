import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deploy workflow: required production runtime secrets', () => {
  const deployYml = readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'deploy.yml'),
    'utf8',
  );

  it('wires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SESSION_SECRET from the production environment', () => {
    expect(deployYml).toContain('SUPABASE_URL: ${{ secrets.SUPABASE_URL }}');
    expect(deployYml).toContain('SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    expect(deployYml).toContain('SESSION_SECRET: ${{ secrets.SESSION_SECRET }}');
  });

  it('fails closed before deploy when SUPABASE_URL is missing', () => {
    expect(deployYml).toMatch(/Missing required secret: SUPABASE_URL/);
  });

  it('fails closed before deploy when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    expect(deployYml).toMatch(/Missing required secret: SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('fails closed before deploy when SESSION_SECRET is missing', () => {
    expect(deployYml).toMatch(/Missing required secret: SESSION_SECRET/);
  });

  it('rejects a SESSION_SECRET shorter than 32 characters', () => {
    expect(deployYml).toMatch(/\$\{#SESSION_SECRET\}.*-lt 32/);
    expect(deployYml).toMatch(/does not meet the minimum length of 32 characters/);
  });

  it('never echoes a secret value directly to the workflow log (only into production.env)', () => {
    // The only place raw secret values are interpolated is inside a printf
    // writing into production.env; there must be no standalone `echo "$SUPABASE...`
    // or `echo "$SESSION_SECRET` that would print the value to the log.
    expect(deployYml).not.toMatch(/echo\s+["'].*\$\{?SUPABASE_SERVICE_ROLE_KEY/);
    expect(deployYml).not.toMatch(/echo\s+["'].*\$\{?SESSION_SECRET/);
  });

  it('places the required-secret checks in the "Prepare production environment" step, before the SSH deploy step', () => {
    const prepareIndex = deployYml.indexOf('Prepare production environment');
    const requiredCheckIndex = deployYml.indexOf('Missing required secret: SUPABASE_URL');
    const sshDeployIndex = deployYml.indexOf('Deploy systemd release over SSH');
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(requiredCheckIndex).toBeGreaterThan(prepareIndex);
    expect(sshDeployIndex).toBeGreaterThan(requiredCheckIndex);
  });

  it('writes SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SESSION_SECRET into production.env', () => {
    expect(deployYml).toContain("printf 'SUPABASE_URL=%s\\n' \"$SUPABASE_URL\"");
    expect(deployYml).toContain(
      "printf 'SUPABASE_SERVICE_ROLE_KEY=%s\\n' \"$SUPABASE_SERVICE_ROLE_KEY\"",
    );
    expect(deployYml).toContain("printf 'SESSION_SECRET=%s\\n' \"$SESSION_SECRET\"");
  });

  it('preserves existing production.env entries (NODE_ENV, PORT, BOOKING_OPS_AUTO_SEND_RUNNER_SECRET, optional map keys)', () => {
    expect(deployYml).toContain("printf 'NODE_ENV=production\\n'");
    expect(deployYml).toContain("printf 'PORT=3000\\n'");
    expect(deployYml).toContain(
      "printf 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=%s\\n' \"$BOOKING_OPS_AUTO_SEND_RUNNER_SECRET\"",
    );
    expect(deployYml).toContain('TWOGIS_CATALOG_API_KEY');
    expect(deployYml).toContain('GOOGLE_MAPS_SERVER_API_KEY');
  });

  it('does not introduce HOST_VARIANT=ru', () => {
    expect(deployYml).not.toContain('HOST_VARIANT=ru');
    expect(deployYml).not.toMatch(/HOST_VARIANT:\s*['"]?ru['"]?/);
  });

  it('does not require NEXT_PUBLIC_SUPABASE_URL for production deploy', () => {
    expect(deployYml).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
  });
});
