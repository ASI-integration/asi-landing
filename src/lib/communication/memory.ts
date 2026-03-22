import { ConversationContext } from './types';

// In-memory store keyed by chatId
// Represents short-term memory for active conversations.
const memoryStore = new Map<number, ConversationContext>();

export function getContext(chatId: number): ConversationContext {
  if (!memoryStore.has(chatId)) {
    memoryStore.set(chatId, { lastMessageAt: new Date() });
  }
  return memoryStore.get(chatId)!;
}

export function updateContext(chatId: number, updates: Partial<ConversationContext>): void {
  const ctx = getContext(chatId);
  memoryStore.set(chatId, { ...ctx, ...updates, lastMessageAt: new Date() });
}

export function clearContext(chatId: number): void {
  memoryStore.delete(chatId);
}
