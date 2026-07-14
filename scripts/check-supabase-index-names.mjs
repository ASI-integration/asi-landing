import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.resolve('supabase/migrations');
const sqlFiles = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();

const identifier = '(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)';
const schemaQualifiedIndexName = new RegExp(
  `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s*\\.\\s*${identifier}`,
  'giu',
);

const violations = [];

for (const fileName of sqlFiles) {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await readFile(filePath, 'utf8');

  for (const match of sql.matchAll(schemaQualifiedIndexName)) {
    const line = sql.slice(0, match.index).split(/\r?\n/u).length;
    violations.push(`${path.relative(process.cwd(), filePath)}:${line}: ${match[0]}`);
  }
}

if (violations.length > 0) {
  console.error('Schema-qualified index names are not valid in CREATE INDEX:');
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${sqlFiles.length} migrations: no schema-qualified index names found.`);
}
