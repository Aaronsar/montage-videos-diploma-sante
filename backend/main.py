"""Video Editing Platform — FastAPI Backend"""
import os
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

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
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

# Static files for downloads
STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
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
    return {"status": "ok", "version": "1.0.0"}
