"""Video Editing Platform — FastAPI Backend"""
import os
import tempfile
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

# Use /data volume for temp files (8GB) instead of /tmp (Railway ephemeral = 1GB)
# This prevents upload failures for large video files
if os.path.isdir("/data"):
    _tmp = "/data/temp"
    os.makedirs(_tmp, exist_ok=True)
    tempfile.tempdir = _tmp

from routers import projects, upload, process, assembly

app = FastAPI(title="Video Editing Platform API", version="1.0.0")


@app.middleware("http")
async def add_cors(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=200)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response
    try:
        response = await call_next(request)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        from fastapi.responses import JSONResponse
        response = JSONResponse(
            status_code=500,
            content={"detail": f"Erreur interne: {type(exc).__name__}: {str(exc)}"},
        )
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

# Static files — use volume if available (same path as upload/assembly routers)
_base = "/data" if os.path.isdir("/data") else os.path.dirname(__file__)
STORAGE_DIR = os.path.join(_base, "storage")
os.makedirs(os.path.join(STORAGE_DIR, "outputs"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "uploads"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "logos"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "temp"), exist_ok=True)

try:
    app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")
except Exception as e:
    print(f"StaticFiles warning: {e}", flush=True)

app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(assembly.router, prefix="/api/assembly", tags=["assembly"])


@app.get("/health")
async def health():
    import shutil
    info = {"status": "ok", "version": "1.0.0"}
    info["data_mounted"] = os.path.isdir("/data")
    info["tempdir"] = tempfile.gettempdir()
    try:
        usage = shutil.disk_usage("/data")
        info["data_total_gb"] = round(usage.total / 1e9, 2)
        info["data_used_gb"] = round(usage.used / 1e9, 2)
        info["data_free_gb"] = round(usage.free / 1e9, 2)
    except Exception:
        info["data_free_gb"] = "N/A"
    return info


@app.post("/cleanup")
async def cleanup_temp():
    """Clean up temp files, stale chunks and old outputs to free disk space."""
    import shutil
    cleaned = 0
    for d in ["/data/temp", "/data/storage/temp", "/data/storage/chunks"]:
        if os.path.isdir(d):
            for f in os.listdir(d):
                fp = os.path.join(d, f)
                try:
                    if os.path.isfile(fp):
                        sz = os.path.getsize(fp)
                        os.remove(fp)
                        cleaned += sz
                    elif os.path.isdir(fp):
                        sz = sum(os.path.getsize(os.path.join(dp, fn)) for dp, dn, fns in os.walk(fp) for fn in fns)
                        shutil.rmtree(fp)
                        cleaned += sz
                except Exception:
                    pass
    # Also clean old output files for all projects (re-exported anyway)
    outputs_dir = "/data/storage/outputs"
    if os.path.isdir(outputs_dir):
        for folder in os.listdir(outputs_dir):
            folder_path = os.path.join(outputs_dir, folder)
            if os.path.isdir(folder_path):
                try:
                    sz = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(folder_path) for fn in fns)
                    shutil.rmtree(folder_path)
                    cleaned += sz
                except Exception:
                    pass
    usage = shutil.disk_usage("/data")
    return {
        "cleaned_mb": round(cleaned / 1e6, 1),
        "free_gb": round(usage.free / 1e9, 2),
        "total_gb": round(usage.total / 1e9, 2),
    }


@app.post("/cleanup/orphans")
async def cleanup_orphans():
    """Delete upload files that don't belong to any existing project."""
    import shutil
    from database import list_projects

    projects = list_projects()
    valid_ids = {p.id for p in projects}
    cleaned = 0

    uploads_dir = "/data/storage/uploads"
    if os.path.isdir(uploads_dir):
        for folder in os.listdir(uploads_dir):
            folder_path = os.path.join(uploads_dir, folder)
            if os.path.isdir(folder_path) and folder not in valid_ids:
                sz = sum(os.path.getsize(os.path.join(dp, fn)) for dp, dn, fns in os.walk(folder_path) for fn in fns)
                shutil.rmtree(folder_path)
                cleaned += sz

    # Also clean orphan outputs
    outputs_dir = "/data/storage/outputs"
    if os.path.isdir(outputs_dir):
        for folder in os.listdir(outputs_dir):
            folder_path = os.path.join(outputs_dir, folder)
            if os.path.isdir(folder_path) and folder not in valid_ids:
                sz = sum(os.path.getsize(os.path.join(dp, fn)) for dp, dn, fns in os.walk(folder_path) for fn in fns)
                shutil.rmtree(folder_path)
                cleaned += sz

    usage = shutil.disk_usage("/data")
    return {
        "cleaned_mb": round(cleaned / 1e6, 1),
        "free_gb": round(usage.free / 1e9, 2),
        "total_gb": round(usage.total / 1e9, 2),
        "valid_projects": len(valid_ids),
    }
