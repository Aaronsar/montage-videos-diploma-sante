"""Video assembly and export routes."""
import os
import uuid
import shutil
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
from models import ProjectStatus, OutputFormat, LogoConfig, LogoPosition, OutputFile, ExportSettings, MusicConfig
from database import load_project, save_project
from services.video_processing import (
    cut_segment, concatenate_segments, concatenate_with_transitions, generate_srt,
    add_subtitles, add_logo, add_background_music, export_format, cleanup_temp_files
)

router = APIRouter()

_BASE = "/data" if os.path.isdir("/data") else os.path.dirname(os.path.dirname(__file__))
STORAGE_DIR = os.path.join(_BASE, "storage")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
OUTPUTS_DIR = os.path.join(STORAGE_DIR, "outputs")
LOGOS_DIR = os.path.join(STORAGE_DIR, "logos")
TEMP_DIR = os.path.join(STORAGE_DIR, "temp")
ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")


class AssembleRequest(BaseModel):
    formats: List[OutputFormat] = [OutputFormat.landscape]
    add_subtitles: bool = True
    subtitle_style: str = "modern"
    logo_filename: Optional[str] = None
    logo_position: Optional[LogoPosition] = LogoPosition.bottom_right
    logo_opacity: float = 0.85
    logo_size_percent: float = 15
    transition_duration: float = 0.5  # 0 = no transitions
    music_track: Optional[str] = None  # filename from assets/music/
    music_volume: float = 0.15


@router.get("/music-tracks")
async def list_music_tracks():
    """List available background music tracks."""
    music_dir = os.path.join(ASSETS_DIR, "music")
    tracks = []
    if os.path.isdir(music_dir):
        for f in sorted(os.listdir(music_dir)):
            if f.endswith((".mp3", ".m4a", ".wav", ".ogg")):
                name = f.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title()
                tracks.append({"filename": f, "name": name})
    return {"tracks": tracks}


@router.post("/{project_id}/assemble")
async def assemble_video(
    project_id: str,
    request: AssembleRequest,
    background_tasks: BackgroundTasks,
):
    """Start video assembly with the selected segments."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not project.segments:
        raise HTTPException(status_code=400, detail="No segments selected")
    if project.status not in [ProjectStatus.review, ProjectStatus.done]:
        raise HTTPException(status_code=400, detail="Project must be in review state")

    # Update export settings
    logo_config = None
    if request.logo_filename:
        logo_config = LogoConfig(
            filename=request.logo_filename,
            position=request.logo_position,
            opacity=request.logo_opacity,
            size_percent=request.logo_size_percent,
        )

    music_config = None
    if request.music_track:
        music_config = MusicConfig(
            filename=request.music_track,
            volume=request.music_volume,
        )

    project.export_settings = ExportSettings(
        formats=request.formats,
        logo=logo_config,
        add_subtitles=request.add_subtitles,
        subtitle_style=request.subtitle_style,
        transition_duration=request.transition_duration,
        music=music_config,
    )
    project.status = ProjectStatus.assembling
    project.progress = 80
    project.progress_message = "Assemblage de la vidéo en cours..."
    project.outputs = []
    save_project(project)

    background_tasks.add_task(_run_assembly, project_id)
    return {"status": "started", "project_id": project_id}


def _run_assembly(project_id: str):
    """Background task: assemble video from segments (sync for thread pool)."""
    project = load_project(project_id)
    if not project:
        return

    try:
        # Auto-cleanup previous temp files to free space before assembly
        cleanup_temp_files(project_id)

        project_uploads_dir = os.path.join(UPLOADS_DIR, project_id)
        project_outputs_dir = os.path.join(OUTPUTS_DIR, project_id)
        project_temp_dir = os.path.join(TEMP_DIR, project_id)
        project_logos_dir = os.path.join(LOGOS_DIR, project_id)

        os.makedirs(project_outputs_dir, exist_ok=True)
        os.makedirs(project_temp_dir, exist_ok=True)

        # Build rush lookup
        rush_lookup = {r.id: r for r in project.rushes}
        segments = sorted(project.segments, key=lambda s: s.order)

        # Step 1: Cut each segment (with per-segment progress)
        total_segs = len(segments)
        cut_paths = []
        for idx, seg in enumerate(segments):
            project = load_project(project_id)
            project.progress_message = f"Découpe segment {idx + 1}/{total_segs}..."
            project.progress = 80 + int((idx / total_segs) * 8)  # 80-88%
            save_project(project)

            rush = rush_lookup.get(seg.rush_id)
            if not rush:
                print(f"[ASSEMBLY] Segment {idx}: rush {seg.rush_id} not found, skipping", flush=True)
                continue
            rush_path = os.path.join(project_uploads_dir, rush.filename)
            if not os.path.exists(rush_path):
                print(f"[ASSEMBLY] Segment {idx}: file {rush_path} not found, skipping", flush=True)
                continue

            cut_path = os.path.join(project_temp_dir, f"seg_{seg.id}.mp4")
            success = cut_segment(rush_path, seg.start, seg.end, cut_path)
            if success:
                cut_paths.append(cut_path)
            else:
                print(f"[ASSEMBLY] Segment {idx}: cut failed, skipping", flush=True)

        if not cut_paths:
            raise Exception("Aucun segment n'a pu être découpé.")

        # Step 2: Concatenate (with transitions if enabled)
        project = load_project(project_id)
        td = project.export_settings.transition_duration
        project.progress_message = f"Assemblage des segments{' avec fondus' if td > 0 else ''}..."
        project.progress = 88
        save_project(project)

        base_video = os.path.join(project_temp_dir, "base.mp4")
        if td and td > 0:
            success = concatenate_with_transitions(cut_paths, base_video, td)
        else:
            success = concatenate_segments(cut_paths, base_video)
        if not success:
            raise Exception("Erreur lors de la concatenation.")

        # Step 3: Add subtitles if requested
        current_video = base_video
        if project.export_settings.add_subtitles:
            project = load_project(project_id)
            project.progress_message = "Ajout des sous-titres..."
            project.progress = 90
            save_project(project)

            srt_content = generate_srt(segments, project.rushes)
            srt_path = os.path.join(project_temp_dir, "subtitles.srt")
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write(srt_content)

            subtitled_video = os.path.join(project_temp_dir, "with_subtitles.mp4")
            success = add_subtitles(
                current_video, srt_path, subtitled_video,
                style=project.export_settings.subtitle_style
            )
            if success:
                current_video = subtitled_video

        # Step 4: Add logo if configured
        if project.export_settings.logo:
            project = load_project(project_id)
            project.progress_message = "Ajout du logo..."
            project.progress = 92
            save_project(project)

            logo_path = os.path.join(project_logos_dir, project.export_settings.logo.filename)
            if os.path.exists(logo_path):
                logo_video = os.path.join(project_temp_dir, "with_logo.mp4")
                success = add_logo(current_video, logo_path, logo_video, project.export_settings.logo)
                if success:
                    current_video = logo_video

        # Step 5: Add background music if configured
        if project.export_settings.music:
            project = load_project(project_id)
            project.progress_message = "Ajout de la musique de fond..."
            project.progress = 94
            save_project(project)

            music_path = os.path.join(ASSETS_DIR, "music", project.export_settings.music.filename)
            if os.path.exists(music_path):
                music_video = os.path.join(project_temp_dir, "with_music.mp4")
                success = add_background_music(
                    current_video, music_path, music_video,
                    volume=project.export_settings.music.volume
                )
                if success:
                    current_video = music_video

        # Step 6: Export each format
        project = load_project(project_id)
        project.progress_message = "Export des formats..."
        project.progress = 95
        save_project(project)

        output_files = []
        total_formats = len(project.export_settings.formats)
        for i, fmt in enumerate(project.export_settings.formats):
            format_name = fmt.value.replace(":", "x")
            output_filename = f"{project_id}_{format_name}.mp4"
            output_path = os.path.join(project_outputs_dir, output_filename)

            success = export_format(current_video, output_path, fmt)
            if success and os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                output_files.append(OutputFile(
                    format=fmt.value,
                    filename=output_filename,
                    file_size=file_size,
                    url=f"/storage/outputs/{project_id}/{output_filename}",
                ))

            project = load_project(project_id)
            project.progress = 95 + int((i + 1) / total_formats * 4)
            save_project(project)

        # Done!
        project = load_project(project_id)
        project.outputs = output_files
        project.status = ProjectStatus.done
        project.progress = 100
        project.progress_message = f"Vidéo prête ! {len(output_files)} format(s) exporté(s)"
        save_project(project)

        # Cleanup temp files
        cleanup_temp_files(project_id)

    except Exception as e:
        project = load_project(project_id)
        project.status = ProjectStatus.error
        project.error_message = f"Erreur assemblage: {str(e)}"
        save_project(project)
