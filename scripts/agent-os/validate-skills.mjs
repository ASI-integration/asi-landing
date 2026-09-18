#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const REQUIRED_SKILLS = [
  {
    id: 'asi-task-execution',
    requiredFiles: [
      'SKILL.md',
      'agents/openai.yaml',
      'references/change-to-test-map.md',
      'references/result-contract.md',
      'scripts/preflight.mjs',
    ],
  },
  {
    id: 'asi-staging-acceptance',
    requiredFiles: [
      'SKILL.md',
      'agents/openai.yaml',
      'references/staging-contract.md',
      'references/acceptance-fixtures.md',
      'scripts/staging-preflight.mjs',
      'scripts/staging-result.mjs',
    ],
  },
  {
    id: 'asi-production-rollout',
    requiredFiles: [
      'SKILL.md',
      'agents/openai.yaml',
      'references/production-preflight.md',
      'references/rollout-report.md',
      'scripts/verify-release-identity.mjs',
      'scripts/red-approval-check.mjs',
    ],
  },
  {
    id: 'asi-website-editor',
    requiredFiles: [
      'SKILL.md',
      'agents/openai.yaml',
      'references/editorial-contract.md',
      'references/ru-public-site-map.md',
      'references/result-contract.md',
      'scripts/preflight.mjs',
    ],
  },
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  invariant(match, 'SKILL.md must begin with YAML frontmatter');
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatter[key] = value;
  }
  return frontmatter;
}

export function validateSkillStructure(repoRoot = DEFAULT_REPO_ROOT) {
  const skillsRoot = path.join(repoRoot, '.agents/skills');
  invariant(fs.existsSync(skillsRoot), 'Missing .agents/skills directory');

  const findings = [];
  for (const skill of REQUIRED_SKILLS) {
    const skillRoot = path.join(skillsRoot, skill.id);
    invariant(fs.existsSync(skillRoot), `Missing required skill: ${skill.id}`);
    for (const relative of skill.requiredFiles) {
      const absolute = path.join(skillRoot, relative);
      invariant(fs.existsSync(absolute), `${skill.id} missing ${relative}`);
    }

    const skillMd = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const frontmatter = parseSkillFrontmatter(skillMd);
    invariant(frontmatter.name === skill.id, `${skill.id} frontmatter name mismatch`);
    invariant(typeof frontmatter.description === 'string' && frontmatter.description.length > 20, `${skill.id} description too short`);
    invariant(/Allowed actions/i.test(skillMd), `${skill.id} must declare allowed actions`);
    invariant(/Forbidden actions/i.test(skillMd) || /Mandatory stop conditions/i.test(skillMd), `${skill.id} must declare forbidden/stop conditions`);

    if (skill.id === 'asi-production-rollout') {
      invariant(/fail-closed|read-only|never dispatch|mutation/i.test(skillMd), `${skill.id} must declare fail-closed production behavior`);
      invariant(!/workflow_dispatch|gh workflow run|supabase db push/i.test(skillMd), `${skill.id} must not instruct live production mutation`);
    }
    if (skill.id === 'asi-staging-acceptance') {
      invariant(/never.*SSH|never mutates|not SSH/i.test(skillMd), `${skill.id} must forbid live staging mutation`);
    }
    if (skill.id === 'asi-website-editor') {
      invariant(/review/i.test(skillMd) && /apply/i.test(skillMd), `${skill.id} must declare review and apply modes`);
      invariant(/AWAITING_OWNER/.test(skillMd), `${skill.id} must declare an AWAITING_OWNER gate for apply`);
      invariant(/Public-site-first/i.test(skillMd), `${skill.id} must require a public-site-first review`);
      invariant(/site-audit/i.test(skillMd), `${skill.id} must use the deterministic site auditor for verification`);
      invariant(/PRODUCT_CONTRACT/.test(skillMd), `${skill.id} must ground edits in the product contract`);
      invariant(!/gh pr merge|npm run deploy|vercel deploy|workflow_dispatch/i.test(skillMd), `${skill.id} must not instruct a merge or deploy action`);
    }

    findings.push({
      id: skill.id,
      requiredFiles: skill.requiredFiles.length,
      descriptionLength: frontmatter.description.length,
    });
  }

  return {
    ok: true,
    skillCount: findings.length,
    skills: findings,
  };
}

function main() {
  try {
    const result = validateSkillStructure(DEFAULT_REPO_ROOT);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
