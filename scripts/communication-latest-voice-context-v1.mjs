#!/usr/bin/env node

import fs from 'node:fs';

const input = fs.readFileSync(0, 'utf8');
const lines = input.split(/\r?\n/);

function readWindow(start, count = 18) {
  return lines.slice(start, Math.min(lines.length, start + count)).join('\n');
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function numberField(text, name) {
  return firstMatch(text, [
    new RegExp(`${name}\\s*:\\s*'?(-?\\d+)'?`),
    new RegExp(`"${name}"\\s*:\\s*"?(-?\\d+)"?`),
  ]);
}

function stringField(text, name) {
  return firstMatch(text, [
    new RegExp(`${name}\\s*:\\s*'([^']+)'`),
    new RegExp(`${name}\\s*:\\s*"([^"]+)"`),
    new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`),
  ]);
}

let voice = null;
for (let i = lines.length - 1; i >= 0; i -= 1) {
  if (!lines[i].includes('[tg:voice] download.ready_for_stt')) continue;
  const block = readWindow(i);
  const updateId = numberField(block, 'update_id');
  const fileId = stringField(block, 'file_id');
  if (updateId && fileId) {
    voice = { updateId, fileId };
    break;
  }
}

if (!voice) {
  console.error('No recent completed Telegram voice STT download context found in logs.');
  process.exit(2);
}

let webhook = null;
for (let i = lines.length - 1; i >= 0; i -= 1) {
  if (!lines[i].includes('[tg:webhook] recv')) continue;
  const block = readWindow(i);
  const updateId = numberField(block, 'update_id');
  if (updateId !== voice.updateId) continue;
  const chatId = numberField(block, 'chat_id');
  const hasVoice = /has_voice\s*:\s*true|"has_voice"\s*:\s*true/.test(block);
  if (chatId && hasVoice) {
    webhook = { chatId };
    break;
  }
}

if (!webhook) {
  console.error(`Found voice update_id=${voice.updateId}, but no matching webhook chat_id block.`);
  process.exit(3);
}

console.log(JSON.stringify({
  updateId: Number(voice.updateId),
  chatId: webhook.chatId,
  fileId: voice.fileId,
}));
