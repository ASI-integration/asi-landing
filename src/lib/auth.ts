import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export type SessionData = {
  userId: string;
  email: string;
};

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'asi_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax' as const,
    path: '/',
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}
