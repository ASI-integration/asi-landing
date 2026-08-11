import type { RuntimeBridgeRepository } from '@/lib/asi-runtime/bridge-types';

type DevelopmentRepositoryName<Repository extends RuntimeBridgeRepository = RuntimeBridgeRepository> =
  Repository extends `ASI-integration/${infer Name}` ? Name : never;

export type DevelopmentRepositoryDefinition = {
  [Repository in DevelopmentRepositoryName]: {
    /** Stable selector id for the UI and API. */
    id: Repository;
    /** Exact GitHub full name accepted by Runtime Bridge. */
    fullName: `ASI-integration/${Repository}`;
    /** Human label shown in the console. */
    label: `ASI-integration/${Repository}`;
    /** Branch used for baseline SHA resolution (server-only). */
    defaultBranch: 'main';
    githubOwner: 'ASI-integration';
    githubRepo: Repository;
  };
}[DevelopmentRepositoryName];

/**
 * Server-defined repository allowlist for the Owner Development Console.
 * Add new entries here later without rewriting the page.
 */
export const DEVELOPMENT_REPOSITORY_ALLOWLIST = [
  {
    id: 'asi-landing',
    fullName: 'ASI-integration/asi-landing',
    label: 'ASI-integration/asi-landing',
    defaultBranch: 'main',
    githubOwner: 'ASI-integration',
    githubRepo: 'asi-landing',
  },
  {
    id: 'asi-os-runtime',
    fullName: 'ASI-integration/asi-os-runtime',
    label: 'ASI-integration/asi-os-runtime',
    defaultBranch: 'main',
    githubOwner: 'ASI-integration',
    githubRepo: 'asi-os-runtime',
  },
] as const satisfies readonly DevelopmentRepositoryDefinition[];

export type DevelopmentRepositoryId = (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['id'];

export const DEVELOPMENT_REPOSITORY_STORAGE_KEY = 'asi.owner-console.last-repository';

export function listDevelopmentRepositories(): Array<{ id: string; label: string; fullName: string }> {
  return DEVELOPMENT_REPOSITORY_ALLOWLIST.map((repo) => ({
    id: repo.id,
    label: repo.label,
    fullName: repo.fullName,
  }));
}

export function resolveRememberedDevelopmentRepositoryId(
  repositories: ReadonlyArray<{ id: string }>,
  rememberedId: string | null | undefined,
): string {
  const remembered = String(rememberedId ?? '').trim();
  if (remembered && repositories.some((repository) => repository.id === remembered)) {
    return remembered;
  }
  return repositories[0]?.id ?? '';
}

export function resolveDevelopmentRepository(
  repositoryId: string | null | undefined,
): DevelopmentRepositoryDefinition | null {
  const id = String(repositoryId ?? '').trim();
  if (!id) return null;
  const found = DEVELOPMENT_REPOSITORY_ALLOWLIST.find((repo) => repo.id === id);
  return found ?? null;
}

export function isAllowlistedDevelopmentRepositoryFullName(fullName: string): boolean {
  return DEVELOPMENT_REPOSITORY_ALLOWLIST.some((repo) => repo.fullName === fullName);
}
