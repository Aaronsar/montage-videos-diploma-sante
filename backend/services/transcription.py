"""Whisper transcription service using OpenAI API."""
import os
import openai
from typing import List
from models import TranscriptSegment

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    return _client


async def transcribe_video(file_path: str) -> List[TranscriptSegment]:
    """Transcribe a video file and return segments with timestamps."""
    with open(file_path, "rb") as audio_file:
        response = _get_client().audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    segments = []
    for seg in response.segments:
        segments.append(
            TranscriptSegment(
                start=round(seg.start, 2),
                end=round(seg.end, 2),
                text=seg.text.strip(),
            )
        )
    return segments


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
