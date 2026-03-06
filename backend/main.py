"""Video Editing Platform — FastAPI Backend"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

from routers import projects, upload, process, assembly

app = FastAPI(title="Video Editing Platform API", version="1.0.0", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for downloads
STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(os.path.join(STORAGE_DIR, "outputs"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "uploads"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "logos"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "temp"), exist_ok=True)

app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")

app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(assembly.router, prefix="/api/assembly", tags=["assembly"])


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
