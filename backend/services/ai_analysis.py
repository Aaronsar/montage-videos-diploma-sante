"""Claude AI analysis service for intelligent segment selection."""
import os
import json
import uuid
from typing import List, Optional
import anthropic
from models import Rush, VideoSegment
from services.transcription import format_transcript_for_prompt

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    return _client


async def analyze_rushes_with_brief(
    rushes: List[Rush],
    brief: str,
) -> List[VideoSegment]:
    """
    Given a list of transcribed rushes and a brief,
    Claude selects the best segments to create the final video.
    """
    # Build the prompt with all transcripts
    transcripts_text = ""
    for i, rush in enumerate(rushes):
        if not rush.transcript:
            continue
        transcripts_text += f"\n\n=== RUSH {i+1}: {rush.original_filename} (ID: {rush.id}) ===\n"
        transcripts_text += f"Durée totale: {_format_duration(rush.duration)}\n"
        transcripts_text += "Transcription:\n"
        transcripts_text += format_transcript_for_prompt(rush.transcript)

    if not transcripts_text.strip():
        raise ValueError("Aucun rush n'a été transcrit correctement.")

    prompt = f"""Tu es un monteur vidéo expert spécialisé dans les publicités pour réseaux sociaux.

BRIEF DU CLIENT:
{brief}

RUSHES DISPONIBLES:
{transcripts_text}

Ta mission:
1. Analyser toutes les transcriptions
2. Sélectionner les meilleurs passages pour créer une vidéo percutante selon le brief
3. Ordonner les segments de façon narrative et dynamique
4. Chaque segment doit avoir minimum 3 secondes et maximum 30 secondes
5. La vidéo finale doit faire entre 30 secondes et 3 minutes selon le brief

Réponds UNIQUEMENT avec un JSON valide dans ce format exact, sans texte avant ou après:
{{
  "reasoning": "Explication courte de tes choix éditoriaux",
  "segments": [
    {{
      "rush_id": "ID_DU_RUSH",
      "start": 0.0,
      "end": 10.5,
      "transcript": "texte de ce segment"
    }}
  ]
}}

Important:
- Les timestamps start/end doivent être en secondes (float)
- rush_id doit correspondre exactement aux IDs fournis
- Sélectionne les passages les plus forts, clairs et pertinents par rapport au brief
- Évite les répétitions, hésitations ou passages faibles"""

    message = _get_client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Extract JSON (handle potential markdown code blocks)
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0].strip()
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0].strip()

    data = json.loads(response_text)

    segments = []
    for i, seg_data in enumerate(data.get("segments", [])):
        segments.append(
            VideoSegment(
                id=str(uuid.uuid4()),
                rush_id=seg_data["rush_id"],
                start=float(seg_data["start"]),
                end=float(seg_data["end"]),
                transcript=seg_data.get("transcript", ""),
                order=i,
            )
        )

    return segments, data.get("reasoning", "")


def _format_duration(duration: Optional[float]) -> str:
    if not duration:
        return "inconnue"
    m = int(duration // 60)
    s = int(duration % 60)
    return f"{m}min {s}s"
