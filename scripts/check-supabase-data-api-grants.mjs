import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const roots = ['supabase/migrations', 'scripts/migrations', 'docs/migrations'];
const createTablePattern =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?!if\b)(?:(["\w]+)\.)?(["\w]+)/gi;

function walkSqlFiles(dir) {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return walkSqlFiles(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.sql') ? [fullPath] : [];
  });
}

function cleanIdent(value) {
  return value.replaceAll('"', '');
}

function hasTableAccessStatement(windowText, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const grantOrRevoke = new RegExp(
    String.raw`\b(?:grant|revoke)\b[\s\S]{0,300}\b(?:on\s+(?:table\s+)?)?(?:public\.)?"?${escaped}"?\b`,
    'i',
  );
  return grantOrRevoke.test(windowText);
}

function hasRlsIntent(windowText, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const enableRls = new RegExp(
    String.raw`\balter\s+table\s+(?:public\.)?"?${escaped}"?\s+enable\s+row\s+level\s+security\b`,
    'i',
  );
  return enableRls.test(windowText) || /\bRLS\b|row level security/i.test(windowText);
}

const findings = [];

for (const root of roots) {
  for (const file of walkSqlFiles(root)) {
    const sql = readFileSync(file, 'utf8');
    const creates = [...sql.matchAll(createTablePattern)];

    for (let index = 0; index < creates.length; index += 1) {
      const match = creates[index];
      const schema = match[1] ? cleanIdent(match[1]) : 'public';
      const table = cleanIdent(match[2]);

      if (schema !== 'public') continue;

      const nextCreateIndex = creates[index + 1]?.index ?? sql.length;
      const localWindow = sql.slice(match.index, Math.min(nextCreateIndex, match.index + 5000));
      const hasAccess = hasTableAccessStatement(localWindow, table);
      const hasRls = hasRlsIntent(localWindow, table);

      findings.push({
        file: relative(process.cwd(), file),
        table: `public.${table}`,
        hasAccess,
        hasRls,
      });
    }
  }
}

if (findings.length === 0) {
  console.log('No public CREATE TABLE statements found in scanned SQL files.');
  process.exit(0);
}

console.log('Supabase Data API grant scan');
console.log('Scanned: ' + roots.join(', '));
console.log('');

for (const finding of findings) {
  const flags = [];
  if (!finding.hasAccess) flags.push('missing nearby GRANT/REVOKE');
  if (!finding.hasRls) flags.push('missing nearby RLS note');

  const status = flags.length > 0 ? `WARN: ${flags.join('; ')}` : 'OK';
  console.log(`${status} | ${finding.table} | ${finding.file}`);
}

console.log('');
console.log('Advisory only: review warnings manually; this script does not prove a table is unsafe.');
