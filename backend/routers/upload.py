"""File upload routes (videos + logo)."""
import os
import uuid
import shutil
import aiofiles
import json
import time
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List, Optional
from models import Rush, RushCategory
from database import load_project, save_project
from services.video_processing import get_video_duration

router = APIRouter()

# Use /data if Railway Volume is mounted there, else fall back to local
_BASE = "/data" if os.path.isdir("/data") else os.path.join(os.path.dirname(os.path.dirname(__file__)))
STORAGE_DIR = os.path.join(_BASE, "storage")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
LOGOS_DIR = os.path.join(STORAGE_DIR, "logos")
CHUNKS_DIR = os.path.join(STORAGE_DIR, "chunks")
TEMP_DIR = os.path.join(STORAGE_DIR, "temp")
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(LOGOS_DIR, exist_ok=True)
os.makedirs(CHUNKS_DIR, exist_ok=True)


def _auto_cleanup():
    """Auto-clean temp files and stale chunks (>2h old) to free disk space."""
    now = time.time()
    cleaned = 0

    # Clean temp dir
    for d in [TEMP_DIR, os.path.join(_BASE, "temp")]:
        if os.path.isdir(d):
            for f in os.listdir(d):
                fp = os.path.join(d, f)
                try:
                    if os.path.isfile(fp):
                        cleaned += os.path.getsize(fp)
                        os.remove(fp)
                    elif os.path.isdir(fp):
                        cleaned += sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(fp) for fn in fns)
                        shutil.rmtree(fp)
                except Exception:
                    pass

    # Clean stale chunk dirs (older than 2 hours)
    if os.path.isdir(CHUNKS_DIR):
        for name in os.listdir(CHUNKS_DIR):
            chunk_dir = os.path.join(CHUNKS_DIR, name)
            if os.path.isdir(chunk_dir):
                try:
                    age = now - os.path.getmtime(chunk_dir)
                    if age > 7200:  # 2 hours
                        cleaned += sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(chunk_dir) for fn in fns)
                        shutil.rmtree(chunk_dir)
                except Exception:
                    pass

    if cleaned > 0:
        print(f"[AUTO-CLEANUP] Freed {cleaned / 1e6:.1f} MB", flush=True)
    return cleaned


def _get_free_space_mb() -> float:
    """Get free disk space in MB."""
    try:
        usage = shutil.disk_usage(_BASE)
        return usage.free / 1e6
    except Exception:
        return 9999  # Assume plenty of space if can't check

ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/mpeg", "video/webm", "video/mov",
}
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2GB


@router.post("/{project_id}/videos")
async def upload_videos(project_id: str, files: List[UploadFile] = File(...), category: str = Form("interview")):
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
            category=RushCategory(category),
        )
        project.rushes.append(rush)
        uploaded_rushes.append(rush)

    save_project(project)
    return {"uploaded": len(uploaded_rushes), "rushes": [r.model_dump() for r in uploaded_rushes]}


# ─── Chunked upload endpoints (for large files) ─────────────────────────────

@router.post("/{project_id}/chunk/init")
async def chunk_init(project_id: str, filename: str = Form(...), file_size: int = Form(...), category: str = Form("interview")):
    """Initialize a chunked upload. Returns an upload_id."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Auto-cleanup temp files to free space before upload
    _auto_cleanup()

    # Check if we have enough space (need ~2x file_size for chunks + final file)
    needed_mb = (file_size * 2.5) / 1e6  # 2.5x for safety margin
    free_mb = _get_free_space_mb()
    if free_mb < needed_mb:
        raise HTTPException(
            status_code=507,
            detail=f"Espace disque insuffisant. Besoin de {needed_mb:.0f} Mo, disponible: {free_mb:.0f} Mo. Supprimez d'anciens projets."
        )

    upload_id = str(uuid.uuid4())
    upload_dir = os.path.join(CHUNKS_DIR, upload_id)
    os.makedirs(upload_dir, exist_ok=True)

    # Save metadata (including category)
    meta = {"filename": filename, "file_size": file_size, "project_id": project_id, "chunks_received": 0, "category": category}
    async with aiofiles.open(os.path.join(upload_dir, "meta.json"), "w") as f:
        await f.write(json.dumps(meta))

    return {"upload_id": upload_id}


@router.post("/{project_id}/chunk/upload")
async def chunk_upload(
    project_id: str,
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk: UploadFile = File(...),
):
    """Upload a single chunk."""
    upload_dir = os.path.join(CHUNKS_DIR, upload_id)
    if not os.path.isdir(upload_dir):
        raise HTTPException(status_code=404, detail="Upload session not found")

    chunk_path = os.path.join(upload_dir, f"chunk_{chunk_index:06d}")
    async with aiofiles.open(chunk_path, "wb") as f:
        while True:
            data = await chunk.read(1024 * 1024)
            if not data:
                break
            await f.write(data)

    # Update metadata
    meta_path = os.path.join(upload_dir, "meta.json")
    async with aiofiles.open(meta_path, "r") as f:
        meta = json.loads(await f.read())
    meta["chunks_received"] = meta.get("chunks_received", 0) + 1
    async with aiofiles.open(meta_path, "w") as f:
        await f.write(json.dumps(meta))

    return {"chunk_index": chunk_index, "received": True}


@router.post("/{project_id}/chunk/complete")
async def chunk_complete(project_id: str, upload_id: str = Form(...)):
    """Assemble all chunks into a final file and register the rush."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    upload_dir = os.path.join(CHUNKS_DIR, upload_id)
    if not os.path.isdir(upload_dir):
        raise HTTPException(status_code=404, detail="Upload session not found")

    # Read metadata
    meta_path = os.path.join(upload_dir, "meta.json")
    async with aiofiles.open(meta_path, "r") as f:
        meta = json.loads(await f.read())

    original_filename = meta["filename"]
    ext = os.path.splitext(original_filename)[1].lower() or ".mp4"
    rush_id = str(uuid.uuid4())
    stored_filename = f"{rush_id}{ext}"

    project_uploads_dir = os.path.join(UPLOADS_DIR, project_id)
    os.makedirs(project_uploads_dir, exist_ok=True)
    final_path = os.path.join(project_uploads_dir, stored_filename)

    # Assemble chunks in order
    chunk_files = sorted([f for f in os.listdir(upload_dir) if f.startswith("chunk_")])
    file_size = 0
    async with aiofiles.open(final_path, "wb") as out:
        for cf in chunk_files:
            cp = os.path.join(upload_dir, cf)
            async with aiofiles.open(cp, "rb") as inp:
                while True:
                    data = await inp.read(1024 * 1024)
                    if not data:
                        break
                    await out.write(data)
                    file_size += len(data)

    # Clean up chunks immediately to free disk space
    shutil.rmtree(upload_dir, ignore_errors=True)
    print(f"[UPLOAD] Chunks cleaned for {original_filename}", flush=True)

    # Get duration
    try:
        duration = get_video_duration(final_path)
    except Exception:
        duration = None

    rush_category = meta.get("category", "interview")
    rush = Rush(
        id=rush_id,
        filename=stored_filename,
        original_filename=original_filename,
        duration=duration,
        file_size=file_size,
        status="uploaded",
        category=RushCategory(rush_category),
    )
    project.rushes.append(rush)
    save_project(project)

    return {"rush": rush.model_dump()}


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
