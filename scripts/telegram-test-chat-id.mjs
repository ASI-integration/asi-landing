import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INPUT_LABEL = /^telegram_test_chat_id\s*:\s*/i;
const INTEGER = /^-?\d+$/;
const MIN_SAFE_CHAT_ID = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_CHAT_ID = BigInt(Number.MAX_SAFE_INTEGER);

export class TestChatConfigurationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TestChatConfigurationError';
    this.code = code;
    this.stage = 'test_chat_configuration';
  }
}

function configurationError(code) {
  if (code === 'missing_test_chat_id') {
    return new TestChatConfigurationError(
      'telegram_test_chat_id is required for acceptance; use an integer such as 931919812 or -1001234567890',
      code,
    );
  }
  return new TestChatConfigurationError(
    'telegram_test_chat_id must contain only an integer such as 931919812 or -1001234567890',
    code,
  );
}

/**
 * @param {unknown} rawValue
 * @param {{ required?: boolean }} options
 */
export function normalizeTelegramTestChatId(rawValue, { required = true } = {}) {
  const input = String(rawValue ?? '').trim();
  if (!input) {
    if (!required) return null;
    throw configurationError('missing_test_chat_id');
  }

  const candidate = input.replace(INPUT_LABEL, '').trim();
  if (!INTEGER.test(candidate)) throw configurationError('invalid_test_chat_id');

  const chatId = BigInt(candidate);
  if (chatId < MIN_SAFE_CHAT_ID || chatId > MAX_SAFE_CHAT_ID) {
    throw configurationError('invalid_test_chat_id');
  }
  return chatId.toString();
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ required?: boolean }} options
 */
export function resolveTelegramTestChatId(env = process.env, { required = true } = {}) {
  const configured = [
    ['TELEGRAM_AUTOPILOT_TEST_CHAT_ID', env.TELEGRAM_AUTOPILOT_TEST_CHAT_ID],
    ['TELEGRAM_TEST_CHAT_ID', env.TELEGRAM_TEST_CHAT_ID],
  ].filter(([, value]) => String(value ?? '').trim());

  if (configured.length === 0) return normalizeTelegramTestChatId(null, { required });
  const normalized = configured.map(([name, value]) => [name, normalizeTelegramTestChatId(value)]);
  if (new Set(normalized.map(([, value]) => value)).size > 1) {
    throw new TestChatConfigurationError(
      'Telegram test chat id environment variables must resolve to the same integer',
      'conflicting_test_chat_id',
    );
  }
  return normalized[0][1];
}

function main() {
  try {
    console.log(normalizeTelegramTestChatId(process.argv[2]));
  } catch (error) {
    if (error instanceof TestChatConfigurationError) {
      console.error(`::error::Communication production acceptance failed at stage=${error.stage}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
