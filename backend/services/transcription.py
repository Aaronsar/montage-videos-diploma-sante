"""Whisper transcription service using OpenAI API."""
import os
import subprocess
import tempfile
import openai
from typing import List, Optional, Tuple
from models import TranscriptSegment

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


def has_audio_track(file_path: str) -> bool:
    """Check if a video file has an audio stream."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-select_streams", "a",
                "-show_entries", "stream=codec_type",
                "-of", "csv=p=0",
                file_path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def extract_audio(video_path: str, output_path: str) -> bool:
    """Extract audio from video and compress to m4a (Whisper-friendly).

    Compresses to mono 16kHz AAC which keeps file size very small
    while preserving speech quality for transcription.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",                # No video
                "-ac", "1",           # Mono
                "-ar", "16000",       # 16kHz sample rate
                "-c:a", "aac",        # AAC codec
                "-b:a", "32k",        # 32kbps bitrate (very small)
                output_path,
            ],
            capture_output=True, text=True, timeout=300,
        )
        return result.returncode == 0
    except Exception:
        return False


async def transcribe_video(file_path: str) -> Tuple[Optional[List[TranscriptSegment]], Optional[str]]:
    """Transcribe a video file and return (segments, error_message).

    Returns:
        (segments, None) on success
        (None, "no_audio") if video has no audio track
        (None, error_message) on failure
    """
    # 1. Check for audio track
    if not has_audio_track(file_path):
        return None, "no_audio"

    # 2. Extract audio to a small temp file
    temp_audio = None
    try:
        temp_audio = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
        temp_audio_path = temp_audio.name
        temp_audio.close()

        if not extract_audio(file_path, temp_audio_path):
            return None, "Erreur extraction audio (ffmpeg)"

        # Check file size (Whisper limit = 25MB)
        audio_size = os.path.getsize(temp_audio_path)
        if audio_size > 25 * 1024 * 1024:
            return None, f"Audio trop volumineux ({audio_size // (1024*1024)} Mo > 25 Mo)"

        if audio_size < 1000:  # Less than 1KB = probably empty/silent
            return None, "no_audio"

        # 3. Send to Whisper
        with open(temp_audio_path, "rb") as audio_file:
            response = _get_client().audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        segments = []
        if response.segments:
            for seg in response.segments:
                segments.append(
                    TranscriptSegment(
                        start=round(seg.start, 2),
                        end=round(seg.end, 2),
                        text=seg.text.strip(),
                    )
                )

        if not segments:
            return None, "no_audio"

        return segments, None

    except Exception as e:
        err_str = str(e)
        if "insufficient_quota" in err_str or "429" in err_str:
            return None, "Crédit OpenAI épuisé — ajoutez du crédit sur platform.openai.com/billing"
        return None, f"Erreur Whisper: {err_str}"
    finally:
        # Clean up temp file
        if temp_audio and os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except Exception:
                pass


def format_transcript_for_prompt(segments: List[TranscriptSegment]) -> str:
    """Format transcript segments into readable text for Claude."""
    lines = []
    for seg in segments:
        start = _format_time(seg.start)
        end = _format_time(seg.end)
        lines.append(f"[{start} → {end}] {seg.text}")
    return "\n".join(lines)


def _format_time(seconds: float) -> str:
    """Convert seconds to HH:MM:SS format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:05.2f}"
