"""File upload routes (videos + logo)."""
import os
import uuid
import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import List
from models import Rush
from database import load_project, save_project
from services.video_processing import get_video_duration

router = APIRouter()

# Use /data if Railway Volume is mounted there, else fall back to local
_BASE = "/data" if os.path.isdir("/data") else os.path.join(os.path.dirname(os.path.dirname(__file__)))
STORAGE_DIR = os.path.join(_BASE, "storage")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
LOGOS_DIR = os.path.join(STORAGE_DIR, "logos")
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(LOGOS_DIR, exist_ok=True)

ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/mpeg", "video/webm", "video/mov",
}
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2GB


@router.post("/{project_id}/videos")
async def upload_videos(project_id: str, files: List[UploadFile] = File(...)):
    """Upload rush videos for a project."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_uploads_dir = os.path.join(UPLOADS_DIR, project_id)
    os.makedirs(project_uploads_dir, exist_ok=True)

    uploaded_rushes = []
    for file in files:
        # Generate unique filename
        ext = os.path.splitext(file.filename)[1].lower()
        rush_id = str(uuid.uuid4())
        stored_filename = f"{rush_id}{ext}"
        file_path = os.path.join(project_uploads_dir, stored_filename)

        # Save file in chunks (avoids loading entire file into RAM)
        file_size = 0
        async with aiofiles.open(file_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                await f.write(chunk)
                file_size += len(chunk)

        # Get duration
        try:
            duration = get_video_duration(file_path)
        except Exception:
            duration = None

        rush = Rush(
            id=rush_id,
            filename=stored_filename,
            original_filename=file.filename,
            duration=duration,
            file_size=file_size,
            status="uploaded",
        )
        project.rushes.append(rush)
        uploaded_rushes.append(rush)

    save_project(project)
    return {"uploaded": len(uploaded_rushes), "rushes": [r.model_dump() for r in uploaded_rushes]}


@router.post("/{project_id}/logo")
async def upload_logo(project_id: str, file: UploadFile = File(...)):
    """Upload logo image for a project."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_logos_dir = os.path.join(LOGOS_DIR, project_id)
    os.makedirs(project_logos_dir, exist_ok=True)

    ext = os.path.splitext(file.filename)[1].lower()
    logo_filename = f"logo_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(project_logos_dir, logo_filename)

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    return {"filename": logo_filename, "path": file_path}


@router.delete("/{project_id}/videos/{rush_id}")
async def delete_video(project_id: str, rush_id: str):
    """Delete a rush video from a project."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    rush = next((r for r in project.rushes if r.id == rush_id), None)
    if not rush:
        raise HTTPException(status_code=404, detail="Rush not found")

    # Delete file
    file_path = os.path.join(UPLOADS_DIR, project_id, rush.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    project.rushes = [r for r in project.rushes if r.id != rush_id]
    save_project(project)
    return {"success": True}
