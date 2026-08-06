import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowPath = path.join(
  repoRoot,
  '.github/workflows/diagnose-initial-sync-recovery-production-env.yml',
);
const workflow = fs.readFileSync(workflowPath, 'utf8');

const confirmationPhrase = 'DIAGNOSE_INITIAL_SYNC_RECOVERY_PRODUCTION_ENV_READ_ONLY';
const expectedSqlPath =
  '/home/project_ayfaar/asi-migration-tmp/20260805120000-recovery-v1/20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql';
const expectedSqlSha256 = 'b87133906dea94b148b4778cd15006be9acec1e4cd995512ca975b12d8c69868';
const approvedKeys = [
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'PRODUCTION_DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

function uniqueMatches(regex: RegExp): string[] {
  return [...workflow.matchAll(regex)].map((m) => m[1]).filter((x, i, arr) => arr.indexOf(x) === i);
}

describe('diagnose initial sync recovery production env workflow', () => {
  it('is manual-only with exact owner phrase gate before SSH', () => {
    expect(workflow).toMatch(/\bon:\r?\n\s+workflow_dispatch:/);
    expect(workflow).not.toMatch(/\n\s*push:/);
    expect(workflow).not.toMatch(/\n\s*pull_request:/);
    expect(workflow).not.toMatch(/\n\s*schedule:/);
    expect(workflow).not.toMatch(/\n\s*workflow_call:/);
    expect(workflow).not.toMatch(/\n\s*repository_dispatch:/);
    expect(workflow).toContain('confirm_read_only_diagnostic:');
    expect(workflow).toContain(`REQUIRED="${confirmationPhrase}"`);
    expect(workflow).toContain('if [[ "$PROVIDED" != "$REQUIRED" ]]; then');
    const phraseGateIndex = workflow.indexOf('if [[ "$PROVIDED" != "$REQUIRED" ]]; then');
    const sshIndex = workflow.indexOf('ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${VPS_HOST}" "bash -s"');
    expect(phraseGateIndex).toBeGreaterThan(-1);
    expect(sshIndex).toBeGreaterThan(-1);
    expect(phraseGateIndex).toBeLessThan(sshIndex);
  });

  it('pins production environment, permissions, and concurrency', () => {
    expect(workflow).toContain('environment: production');
    expect(workflow).toMatch(/\bpermissions:\r?\n\s+contents:\s+read/);
    expect(workflow).toContain('group: diagnose-initial-sync-recovery-production-env');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('references only authorized production secrets', () => {
    const secrets = uniqueMatches(/secrets\.([A-Z0-9_]+)/g).sort();
    expect(secrets).toEqual(['VPS_HOST', 'VPS_PORT', 'VPS_SSH_KEY']);
  });

  it('uses exactly one SSH invocation and one pm2 jlist parse path', () => {
    const sshCalls = workflow.match(/^\s*ssh\s+"\$\{SSH_OPTS\[@\]\}"\s+"\$\{REMOTE_USER\}@\$\{VPS_HOST\}"\s+"bash -s"/gm) ?? [];
    expect(sshCalls).toHaveLength(1);
    const jlistCalls = workflow.match(/\bpm2 jlist\b/g) ?? [];
    expect(jlistCalls).toHaveLength(1);
    expect(workflow).not.toContain('pm2 jlist | tee');
    expect(workflow).not.toContain('echo "$PM2_CANDIDATES"');
    expect(workflow).not.toMatch(/\bscp\b/);
  });

  it('forbids db clients, sql execution, dispatching, and mutation commands', () => {
    expect(workflow).not.toMatch(/\bpsql\b/i);
    expect(workflow).not.toMatch(/\bpg_isready\b/i);
    expect(workflow).not.toMatch(/\bpsycopg\b/i);
    expect(workflow).not.toMatch(/\bsupabase\s+cli\b/i);
    expect(workflow).not.toMatch(/\bsupabase\s+db\b/i);
    expect(workflow).not.toMatch(/\bnode\s+.*pg\b/i);
    expect(workflow).not.toMatch(/\bworkflow\s+run\b/i);
    expect(workflow).not.toMatch(/\bgh\s+workflow\b/i);
    expect(workflow).not.toMatch(/\brm\b/);
    expect(workflow).not.toMatch(/\bmv\b/);
    expect(workflow).not.toMatch(/\bcp\b/);
    expect(workflow).not.toMatch(/\bchmod\b/);
    expect(workflow).not.toMatch(/\bchown\b/);
    expect(workflow).not.toMatch(/\bsed\s+-i\b/);
    expect(workflow).not.toMatch(/\bsystemctl\b/);
    expect(workflow).not.toMatch(/\bpm2\s+(restart|reload|delete)\b/);
  });

  it('keeps approved key allowlist and never prints raw env values', () => {
    for (const key of approvedKeys) {
      expect(workflow).toContain(`"${key}"`);
    }
    const declaredKeys = uniqueMatches(/"([A-Z][A-Z0-9_]+)"/g).filter((k) => k.includes('SUPABASE') || k === 'DATABASE_URL' || k === 'PRODUCTION_DATABASE_URL');
    expect(declaredKeys.sort()).toEqual([...approvedKeys].sort());

    expect(workflow).not.toMatch(/\bset\s+-x\b/);
    expect(workflow).not.toMatch(/\bprintenv\b/);
    expect(workflow).not.toMatch(/\becho\s+.*\$\{?(SUPABASE_DB_URL|DATABASE_URL|PRODUCTION_DATABASE_URL|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY)\}?/);
    expect(workflow).not.toMatch(/\bcat\s+.*\.env/);
    expect(workflow).toContain('PM2_ENV_OUTPUT="$(pm2 env "$asi_pm_id" || true)"');
    expect(workflow).toContain('present=yes nonempty=yes');
    expect(workflow).toContain('present=no nonempty=no');
  });

  it('pins immutable SSH action SHA and forbids mutable tags for VPS_SSH_KEY', () => {
    const immutableSshActionSha = 'dc588b651fe13675774614f8e6a936a468676387';
    const pinnedUses = `uses: webfactory/ssh-agent@${immutableSshActionSha} # v0.9.0`;
    expect(workflow).toContain(pinnedUses);
    expect(workflow).not.toContain('webfactory/ssh-agent@v0.9.0');
    expect(workflow).not.toMatch(/webfactory\/ssh-agent@v\d/);

    const actionUses = (workflow.match(/^\s+uses:\s+.+$/gm) ?? []).map((line) => line.trim());
    expect(actionUses).toEqual([pinnedUses]);
    expect(workflow.match(/secrets\.VPS_SSH_KEY/g)?.length).toBe(1);
  });

  it('pins exact SQL path and expected checksum', () => {
    expect(workflow).toContain(`EXPECTED_SQL_PATH="${expectedSqlPath}"`);
    expect(workflow).toContain(`EXPECTED_SQL_SHA256="${expectedSqlSha256}"`);
    expect(workflow).toContain('sha256sum "$EXPECTED_SQL_PATH"');
    expect(workflow).toContain('expectedChecksumMatch=');
    expect(workflow).not.toMatch(/\bcat\s+.*\.sql/i);
  });
});
