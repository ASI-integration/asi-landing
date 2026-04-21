import { logRuntimeReleaseBootOnce } from '@/lib/runtimeRelease';

export function register() {
  // Ensure we only log on Node runtime.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  logRuntimeReleaseBootOnce();
}

