import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_REPOSITORY_ALLOWLIST,
  isAllowlistedDevelopmentRepositoryFullName,
  listDevelopmentRepositories,
  resolveDevelopmentRepository,
  resolveRememberedDevelopmentRepositoryId,
} from '../repositories';

describe('development repository allowlist', () => {
  it('exposes both allowlisted repositories for the console selector', () => {
    expect(listDevelopmentRepositories()).toEqual([
      {
        id: 'asi-landing',
        label: 'ASI-integration/asi-landing',
        fullName: 'ASI-integration/asi-landing',
      },
      {
        id: 'asi-os-runtime',
        label: 'ASI-integration/asi-os-runtime',
        fullName: 'ASI-integration/asi-os-runtime',
      },
    ]);
  });

  it('resolves each allowlisted repository by stable id', () => {
    expect(resolveDevelopmentRepository('asi-landing')).toEqual(DEVELOPMENT_REPOSITORY_ALLOWLIST[0]);
    expect(resolveDevelopmentRepository('asi-os-runtime')).toEqual(DEVELOPMENT_REPOSITORY_ALLOWLIST[1]);
    expect(resolveDevelopmentRepository('forged-repository')).toBeNull();
  });

  it('accepts only allowlisted full names', () => {
    expect(isAllowlistedDevelopmentRepositoryFullName('ASI-integration/asi-landing')).toBe(true);
    expect(isAllowlistedDevelopmentRepositoryFullName('ASI-integration/asi-os-runtime')).toBe(true);
    expect(isAllowlistedDevelopmentRepositoryFullName('ASI-integration/other-repo')).toBe(false);
  });

  it('restores remembered repository ids only when allowlisted', () => {
    const options = listDevelopmentRepositories();
    expect(resolveRememberedDevelopmentRepositoryId(options, 'asi-os-runtime')).toBe('asi-os-runtime');
    expect(resolveRememberedDevelopmentRepositoryId(options, 'forged-repository')).toBe('asi-landing');
  });
});
