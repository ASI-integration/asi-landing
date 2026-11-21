import { NextResponse } from 'next/server';
import { ownerDemoCorsHeaders } from '@/lib/owner-console/cors';
import {
  assertSandboxBody,
  readDemoRun,
  SandboxRejectedError,
  startDemoRun,
} from '@/lib/owner-console/demo-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(request: Request, body: unknown, status = 200) {
  const headers = ownerDemoCorsHeaders(request);
  headers.set('Content-Type', 'application/json');
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: ownerDemoCorsHeaders(request) });
}

export async function POST(request: Request) {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return json(request, { ok: false, error: 'sandbox_only', llmTokens: 0 }, 400);
  }
  if (raw.length > 2000) {
    return json(request, { ok: false, error: 'sandbox_only', llmTokens: 0 }, 400);
  }
  let body: unknown = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return json(request, { ok: false, error: 'sandbox_only', llmTokens: 0 }, 400);
    }
  }
  try {
    const { lang } = assertSandboxBody(body);
    return json(request, startDemoRun(lang));
  } catch (error) {
    if (error instanceof SandboxRejectedError) {
      return json(request, { ok: false, error: 'sandbox_only', llmTokens: 0 }, 400);
    }
    throw error;
  }
}

export function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get('runId') ?? '';
  if (!runId) return json(request, { ok: false, error: 'run_not_found', llmTokens: 0 }, 404);
  const snapshot = readDemoRun(runId);
  if (!snapshot) return json(request, { ok: false, error: 'run_not_found', llmTokens: 0 }, 404);
  return json(request, snapshot);
}
