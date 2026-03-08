"""Transcription + AI analysis routes."""
import os
from fastapi import APIRouter, HTTPException, BackgroundTasks
from models import ProjectStatus
from database import load_project, save_project
from services.transcription import transcribe_video
from services.ai_analysis import analyze_rushes_with_brief

router = APIRouter()

_BASE = "/data" if os.path.isdir("/data") else os.path.dirname(os.path.dirname(__file__))
STORAGE_DIR = os.path.join(_BASE, "storage")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")


@router.post("/{project_id}/transcribe")
async def start_transcription(project_id: str, background_tasks: BackgroundTasks):
    """Start transcription of all rush videos."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.rushes:
        raise HTTPException(status_code=400, detail="No videos uploaded")

    project.status = ProjectStatus.transcribing
    project.progress = 5
    project.progress_message = "Démarrage de la transcription..."
    save_project(project)

    background_tasks.add_task(_run_transcription, project_id)
    return {"status": "started", "project_id": project_id}


@router.post("/{project_id}/analyze")
async def start_analysis(project_id: str, background_tasks: BackgroundTasks):
    """Start AI analysis to select segments based on brief."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.brief:
        raise HTTPException(status_code=400, detail="Brief is required before analysis")
    if project.status not in [ProjectStatus.transcribed, ProjectStatus.review]:
        raise HTTPException(status_code=400, detail="Videos must be transcribed first")

    project.status = ProjectStatus.analyzing
    project.progress = 60
    project.progress_message = "L'IA analyse vos rushes..."
    save_project(project)

    background_tasks.add_task(_run_analysis, project_id)
    return {"status": "started", "project_id": project_id}


async def _run_transcription(project_id: str):
    """Background task: transcribe all rushes."""
    project = load_project(project_id)
    if not project:
        return

    total = len(project.rushes)
    for i, rush in enumerate(project.rushes):
        project = load_project(project_id)  # Reload to get latest state
        rush_obj = next((r for r in project.rushes if r.id == rush.id), None)
        if not rush_obj:
            continue

        # Skip B-roll: no transcription needed
        if getattr(rush_obj, 'category', 'interview') == 'broll':
            rush_obj.status = "transcribed"
            rush_obj.transcript = []
            rush_obj.error = "B-roll (pas de transcription)"
            project.progress = int(5 + ((i + 1) / total) * 50)
            project.progress_message = f"B-roll {rush_obj.original_filename} — pas de transcription ({i+1}/{total})"
            save_project(project)
            continue

        rush_obj.status = "transcribing"
        project.progress = int(5 + (i / total) * 50)
        project.progress_message = f"Transcription de {rush_obj.original_filename}... ({i+1}/{total})"
        save_project(project)

        file_path = os.path.join(UPLOADS_DIR, project_id, rush_obj.filename)
        if not os.path.exists(file_path):
            rush_obj.status = "error"
            rush_obj.error = "File not found"
            save_project(project)
            continue

        try:
            segments, error = await transcribe_video(file_path)
            if segments:
                rush_obj.transcript = segments
                rush_obj.status = "transcribed"
            elif error == "no_audio":
                rush_obj.transcript = []
                rush_obj.status = "transcribed"  # Mark as done (just no audio)
                rush_obj.error = "Pas de piste audio (vidéo muette)"
            else:
                rush_obj.status = "error"
                rush_obj.error = error or "Erreur inconnue"
        except Exception as e:
            rush_obj.status = "error"
            rush_obj.error = str(e)

        save_project(project)

    # Update final status — allow partial success (no-audio rushes are OK)
    project = load_project(project_id)
    has_any_transcribed = any(r.status == "transcribed" for r in project.rushes)
    all_done = all(r.status in ("transcribed", "error") for r in project.rushes)

    if has_any_transcribed and all_done:
        project.status = ProjectStatus.transcribed
        n_ok = sum(1 for r in project.rushes if r.status == "transcribed")
        n_audio = sum(1 for r in project.rushes if r.transcript and len(r.transcript) > 0)
        project.progress = 55
        project.progress_message = f"Transcription terminée — {n_audio}/{total} rushes avec audio"
    elif all_done:
        project.status = ProjectStatus.error
        project.progress_message = "Erreur: aucun rush n'a pu être transcrit"
    save_project(project)


async def _run_analysis(project_id: str):
    """Background task: AI analysis to select segments."""
    project = load_project(project_id)
    if not project:
        return

    try:
        transcribed_rushes = [r for r in project.rushes if r.transcript]
        segments, reasoning = await analyze_rushes_with_brief(transcribed_rushes, project.brief)

        project = load_project(project_id)
        project.segments = segments
        project.status = ProjectStatus.review
        project.progress = 75
        project.progress_message = f"Analyse terminée — {len(segments)} segments sélectionnés"
        save_project(project)
    except Exception as e:
        project = load_project(project_id)
        project.status = ProjectStatus.error
        project.error_message = f"Erreur analyse IA: {str(e)}"
        save_project(project)
