import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function isOggOpus(audio: Buffer): boolean {
  return audio.length >= 4 && audio.subarray(0, 4).toString('ascii') === 'OggS';
}

function findFfmpeg(): string | null {
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidates = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

export type TelegramVoiceAudioPrep = {
  oggBytes: Buffer | null;
  ffmpegUsed: boolean;
  ffmpegMissing: boolean;
};

export function prepareTelegramVoiceAudio(audio: ArrayBuffer, sourceFormat: string): TelegramVoiceAudioPrep {
  const buf = Buffer.from(audio);
  if (isOggOpus(buf)) {
    return { oggBytes: buf, ffmpegUsed: false, ffmpegMissing: false };
  }

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.warn('[tg:voice] ffmpeg_missing');
    return { oggBytes: null, ffmpegUsed: false, ffmpegMissing: true };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asi-voice-'));
  const ext = sourceFormat === 'mp3' ? 'mp3' : sourceFormat === 'wav' ? 'wav' : 'bin';
  const inputPath = path.join(tmpDir, `in.${ext}`);
  const outputPath = path.join(tmpDir, 'out.ogg');

  try {
    fs.writeFileSync(inputPath, buf);
    execFileSync(
      ffmpeg,
      ['-y', '-i', inputPath, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', outputPath],
      { stdio: 'ignore', timeout: 30_000 },
    );
    const oggBytes = fs.readFileSync(outputPath);
    return { oggBytes, ffmpegUsed: true, ffmpegMissing: false };
  } catch (err) {
    console.error('[tg:voice] ffmpeg_fail', (err as Error).message);
    return { oggBytes: null, ffmpegUsed: true, ffmpegMissing: false };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export function isFfmpegAvailable(): boolean {
  return findFfmpeg() !== null;
}
