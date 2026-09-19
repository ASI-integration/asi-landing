#!/usr/bin/env node
/**
 * Wire every inventory class-A workflow to the shared production owner-gate.
 * Idempotent. Does not invent gate evidence — only adds required wiring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inventory = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'docs/agent-os/production-workflow-inventory.json'), 'utf8'),
);

const OWNER_GATE_INPUT = `      owner_gate_json:
        description: Approved asi.agent-os.owner-gate.v1 JSON (required; typed confirmation is not approval)
        required: true
        type: string
`;

function ensureOwnerGateInput(yaml) {
  if (/\bowner_gate_json\s*:/.test(yaml)) return yaml;

  if (!/^\s*workflow_dispatch\s*:/m.test(yaml)) {
    if (!/^on:\s*$/m.test(yaml) && !/^on:\s*\n/m.test(yaml)) {
      throw new Error('cannot find on: block');
    }
    return yaml.replace(
      /^on:\s*\n/m,
      `on:\n  workflow_dispatch:\n    inputs:\n${OWNER_GATE_INPUT}`,
    );
  }

  if (/workflow_dispatch:\s*\n\s*inputs:\s*\n/.test(yaml)) {
    return yaml.replace(
      /(workflow_dispatch:\s*\n\s*inputs:\s*\n)/,
      `$1${OWNER_GATE_INPUT}`,
    );
  }

  return yaml.replace(
    /(workflow_dispatch:\s*\n)/,
    `$1    inputs:\n${OWNER_GATE_INPUT}`,
  );
}

function ensureGateJob(yaml, action) {
  if (yaml.includes('./.github/workflows/production-owner-gate.yml')) return yaml;

  const gateJob = [
    '  production_owner_gate:',
    '    uses: ./.github/workflows/production-owner-gate.yml',
    '    with:',
    `      requested_action: ${action}`,
    '      environment_identity: production',
    '      owner_gate_json: ${{ inputs.owner_gate_json }}',
    '',
  ].join('\n');

  if (!/^jobs:\s*\n/m.test(yaml)) {
    throw new Error('cannot find jobs: section');
  }
  return yaml.replace(/^jobs:\s*\n/m, `jobs:\n${gateJob}`);
}

function ensureNeeds(yaml) {
  const lines = yaml.split('\n');
  const out = [];
  let inJobs = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) inJobs = true;

    if (inJobs && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      const jobName = line.trim().replace(/:$/, '');
      out.push(line);

      if (jobName === 'production_owner_gate') {
        continue;
      }

      // Collect the job body until next top-level job or EOF
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[j]) && !/^[^ \t#]/.test(lines[j])) {
        body.push(lines[j]);
        j += 1;
      }

      let needsIdx = body.findIndex((row) => /^    needs\s*:/.test(row));
      if (needsIdx >= 0) {
        const needsLine = body[needsIdx];
        if (!needsLine.includes('production_owner_gate')) {
          if (/needs\s*:\s*\[/.test(needsLine)) {
            body[needsIdx] = needsLine.replace(/needs\s*:\s*\[/, 'needs: [production_owner_gate, ');
          } else {
            // Scalar needs form — convert to list including gate
            const existing = needsLine.replace(/^    needs\s*:\s*/, '').trim();
            body[needsIdx] = `    needs: [production_owner_gate, ${existing}]`;
          }
        }
        out.push(...body);
      } else {
        // Insert needs immediately after job name (before first body line)
        out.push('    needs: [production_owner_gate]');
        out.push(...body);
      }
      i = j - 1;
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

for (const entry of inventory.workflows.filter((item) => item.class === 'A')) {
  const absolute = path.join(repoRoot, entry.path);
  let yaml = fs.readFileSync(absolute, 'utf8');
  yaml = ensureOwnerGateInput(yaml);
  yaml = ensureGateJob(yaml, entry.action);
  yaml = ensureNeeds(yaml);
  fs.writeFileSync(absolute, yaml);
  console.log(`wired ${entry.path} action=${entry.action}`);
}
