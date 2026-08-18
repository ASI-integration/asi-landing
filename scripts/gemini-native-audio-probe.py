#!/usr/bin/env python3
import asyncio
import base64
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import wave

from google import genai
from google.genai import types

ALLOWED_CHAT_ID = "931919812"
MODEL = os.getenv("GEMINI_NATIVE_AUDIO_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025").strip()
VOICES = ["Aoede", "Achird", "Schedar", "Kore"]

PROMPT = """RESPOND IN RUSSIAN. YOU MUST RESPOND UNMISTAKABLY IN RUSSIAN.
Ты живой, естественный русскоязычный консьерж ASI. Произнеси ответ разговорно, как человек: с естественными паузами, интонацией и ритмом. Не читай время как техническую строку или набор символов — передай его естественной устной речью. Не добавляй новых фактов и не меняй смысл. Название ASI произнеси слитно как английские названия букв A-S-I: «эй-эс-ай», без искусственных пауз.

Передай гостю только эти факты:
«В квартире не курят и не устраивают вечеринки. Пожалуйста, соблюдайте тишину после 22:00. Уборка завтра в 14:30. Если понадобится помощь, ASI на связи.»
"""


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"missing required env {name}")
    return value


def write_wav(pcm: bytes, path: pathlib.Path) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)


def to_ogg(wav_path: pathlib.Path, ogg_path: pathlib.Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg missing on probe host")
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav_path), "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "48k", str(ogg_path)],
        check=True,
        timeout=30,
    )


def send_voice(token: str, chat_id: str, voice_name: str, index: int, ogg_path: pathlib.Path) -> dict:
    caption = f"Gemini Native Audio {index}/4 — {voice_name}"
    result = subprocess.run(
        [
            "curl", "-fsS", "--max-time", "30", "-X", "POST",
            f"https://api.telegram.org/bot{token}/sendVoice",
            "-F", f"chat_id={chat_id}",
            "-F", f"caption={caption}",
            "-F", f"voice=@{ogg_path};type=audio/ogg",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=40,
    )
    payload = json.loads(result.stdout)
    if not payload.get("ok"):
        raise RuntimeError("Telegram sendVoice returned ok=false")
    voice = payload.get("result", {}).get("voice", {})
    return {
        "messageId": payload.get("result", {}).get("message_id"),
        "duration": voice.get("duration"),
        "fileSize": voice.get("file_size"),
    }


async def generate_native_audio(client: genai.Client, voice_name: str) -> bytes:
    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
            )
        ),
    )
    chunks: list[bytes] = []
    async with client.aio.live.connect(model=MODEL, config=config) as session:
        await session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=PROMPT)]),
            turn_complete=True,
        )
        async for message in session.receive():
            content = message.server_content
            if content and content.model_turn:
                for part in content.model_turn.parts or []:
                    inline = part.inline_data
                    if not inline or inline.data is None:
                        continue
                    data = inline.data
                    if isinstance(data, str):
                        data = base64.b64decode(data)
                    chunks.append(bytes(data))
            if content and content.turn_complete:
                break
    pcm = b"".join(chunks)
    if len(pcm) < 4800:
        raise RuntimeError(f"native audio response too small: {len(pcm)} bytes")
    return pcm


async def main() -> None:
    chat_id = required("GEMINI_PROBE_CHAT_ID")
    if chat_id != ALLOWED_CHAT_ID:
        raise RuntimeError(f"refusing non-dedicated Telegram chat id: {chat_id}")
    token = required("TELEGRAM_BOT_TOKEN")
    api_key = required("GEMINI_API_KEY")

    print(f"PROBE_PROVIDER=gemini_developer_live_api")
    print(f"PROBE_MODEL={MODEL}")
    print(f"PROBE_CHAT_ID={chat_id}")
    print("GEMINI_API_KEY=PRESENT_NONEMPTY")
    print("PROBE_CALLS_PLANNED=4")

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(api_version="v1alpha"),
    )

    results = []
    with tempfile.TemporaryDirectory(prefix="asi-gemini-native-audio-") as tmp:
        tmpdir = pathlib.Path(tmp)
        for index, voice_name in enumerate(VOICES, start=1):
            print(f"GENERATING={index}/4 voice={voice_name}")
            pcm = await generate_native_audio(client, voice_name)
            wav_path = tmpdir / f"{index}-{voice_name}.wav"
            ogg_path = tmpdir / f"{index}-{voice_name}.ogg"
            write_wav(pcm, wav_path)
            to_ogg(wav_path, ogg_path)
            delivery = send_voice(token, chat_id, voice_name, index, ogg_path)
            item = {
                "index": index,
                "voice": voice_name,
                "pcmBytes": len(pcm),
                **delivery,
            }
            results.append(item)
            print("DELIVERED=" + json.dumps(item, ensure_ascii=False))

    print("PROBE_RESULT=" + json.dumps({
        "pass": True,
        "provider": "gemini_developer_live_native_audio",
        "model": MODEL,
        "calls": 4,
        "deliveries": 4,
        "results": results,
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
