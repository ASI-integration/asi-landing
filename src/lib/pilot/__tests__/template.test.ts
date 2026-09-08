import { describe, expect, it } from 'vitest';
import {
  assertNoPrivilegedPilotFields,
  assertPilotGoalIsGreen,
  buildPilotGreenTemplate,
  PILOT_FIXED_REPOSITORY,
  PILOT_FORBIDDEN_CLIENT_FIELDS,
  PILOT_TEMPLATE_ID,
  toBridgeTaskRequest,
} from '../template';
import { PilotAccessError } from '../errors';

describe('SP-02 — Pilot task template + green policy guard', () => {
  it('accepts a green proof-style goal', () => {
    const pkg = buildPilotGreenTemplate({
      goal: 'Add a proof markdown under docs/pilot/ describing the Strigunov beta checklist.',
      title: 'Pilot proof docs',
    });
    expect(pkg.templateId).toBe(PILOT_TEMPLATE_ID);
    expect(pkg.repository).toBe(PILOT_FIXED_REPOSITORY);
    expect(pkg.title).toBe('Pilot proof docs');
    expect(pkg.instructions.join('\n')).toMatch(/docs\/pilot/);
    expect(pkg.safetyConstraints.join('\n')).toMatch(/merge|deploy/i);
    expect(pkg.objective).toMatch(/strigunov_pilot_green_v1/);
  });

  it('rejects red objectives without building a package', () => {
    expect(() => buildPilotGreenTemplate({
      goal: 'Please merge this into main and deploy production.',
    })).toThrow(PilotAccessError);
    try {
      buildPilotGreenTemplate({ goal: 'deploy production secrets' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'red_objective_rejected', status: 400 });
    }
  });

  it('rejects empty, oversized, or secret-like goals', () => {
    expect(() => buildPilotGreenTemplate({ goal: '' })).toThrow(PilotAccessError);
    expect(() => buildPilotGreenTemplate({ goal: 'x'.repeat(2001) })).toThrow(PilotAccessError);
    expect(() => buildPilotGreenTemplate({ goal: 'ASI_RUNTIME_TOKEN=supersecretvalue' })).toThrow(
      PilotAccessError,
    );
  });

  it('rejects privileged client fields', () => {
    for (const field of ['baselineSha', 'repository', 'provider', 'merge', 'deploy', 'conversationId']) {
      expect(() => assertNoPrivilegedPilotFields({ goal: 'ok', [field]: 'x' })).toThrow(PilotAccessError);
    }
    expect(PILOT_FORBIDDEN_CLIENT_FIELDS).toContain('baselineSha');
    expect(() => assertNoPrivilegedPilotFields({ goal: 'ok', shellCommand: 'rm -rf /' })).toThrow(
      PilotAccessError,
    );
  });

  it('maps template into a canonical Bridge task request', () => {
    const pkg = buildPilotGreenTemplate({
      goal: 'Document the pilot acceptance notes under docs/pilot/.',
    });
    const sha = 'a'.repeat(40);
    const request = toBridgeTaskRequest(pkg, sha);
    expect(request).toEqual({
      title: pkg.title,
      objective: pkg.objective,
      instructions: pkg.instructions,
      acceptanceCriteria: pkg.acceptanceCriteria,
      safetyConstraints: pkg.safetyConstraints,
      repository: PILOT_FIXED_REPOSITORY,
      baselineSha: sha,
    });
  });

  it('assertPilotGoalIsGreen allows docs-only wording', () => {
    expect(() => assertPilotGoalIsGreen('Update docs/pilot/readme.md with checklist')).not.toThrow();
  });
});
