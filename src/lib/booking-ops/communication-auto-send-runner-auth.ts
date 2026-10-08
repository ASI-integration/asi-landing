import { timingSafeEqual } from 'node:crypto';

// Never authorize scheduled guest operations using the generic deployment/cron token.
export function isAuthorizedBookingOpsRunner(request: Request): boolean {
  const expected = process.env.BOOKING_OPS_AUTO_SEND_RUNNER_SECRET?.trim();
  const match = /^Bearer[ \t]+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  if (expectedBytes.length === 0 || expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
