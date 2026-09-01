import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  DevelopmentReadinessRepositoryError,
  getDevelopmentReadiness,
} from '@/lib/development/readiness';
import { resolveDevelopmentRepository } from '@/lib/development/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  const repositoryId = new URL(request.url).searchParams.get('repositoryId');
  const repository = resolveDevelopmentRepository(repositoryId);
  if (!repository) {
    return NextResponse.json(
      {
        ok: false,
        code: 'repository_not_allowed',
        message: 'Репозиторий не разрешён для консоли разработки.',
      },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const readiness = await getDevelopmentReadiness({ repositoryId: repository.id });
    return NextResponse.json(
      { ok: true, readiness },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof DevelopmentReadinessRepositoryError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: 'Репозиторий не разрешён для консоли разработки.',
        },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
    console.warn('[development-readiness] bounded check failed');
    return NextResponse.json(
      { ok: false, message: 'Не удалось проверить готовность. Повторите попытку.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
