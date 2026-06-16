export type TelegramRoutingRole = 'owner' | 'guest' | 'lead' | 'support' | 'unknown';

export type TelegramCommunicationMode = 'manual' | 'draft' | 'autopilot';

export type TelegramRoutingSession = {
  role: TelegramRoutingRole;
  selectedRole?: TelegramRoutingRole;
  communicationMode: TelegramCommunicationMode;
  leadSource?: string;
  testGuest?: boolean;
  testPropertyId?: string | null;
  updatedAt: string;
};

const sessions = new Map<number, TelegramRoutingSession>();

export function __resetTelegramRoutingSessionsForTests(): void {
  sessions.clear();
}

export function getTelegramRoutingSession(chatId: number): TelegramRoutingSession | undefined {
  return sessions.get(chatId);
}

export function setTelegramRoutingSession(chatId: number, session: TelegramRoutingSession): void {
  sessions.set(chatId, session);
}

export function clearTelegramRoutingSession(chatId: number): void {
  sessions.delete(chatId);
}

export function patchTelegramRoutingSession(
  chatId: number,
  patch: Partial<Omit<TelegramRoutingSession, 'updatedAt'>>,
): TelegramRoutingSession {
  const current = sessions.get(chatId);
  const next: TelegramRoutingSession = {
    role: patch.role ?? current?.role ?? 'unknown',
    selectedRole: patch.selectedRole ?? current?.selectedRole,
    communicationMode: patch.communicationMode ?? current?.communicationMode ?? 'autopilot',
    leadSource: patch.leadSource ?? current?.leadSource,
    testGuest: patch.testGuest ?? current?.testGuest,
    testPropertyId: patch.testPropertyId ?? current?.testPropertyId,
    updatedAt: new Date().toISOString(),
  };
  sessions.set(chatId, next);
  return next;
}

export function resolveTelegramCommunicationMode(
  session?: TelegramRoutingSession | null,
): TelegramCommunicationMode {
  const envMode = process.env.TELEGRAM_GUEST_COMMUNICATION_MODE?.trim().toLowerCase();
  if (envMode === 'manual' || envMode === 'draft' || envMode === 'autopilot') {
    return envMode;
  }
  return session?.communicationMode ?? 'autopilot';
}
