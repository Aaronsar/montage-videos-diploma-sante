"""Video Editing Platform — FastAPI Backend"""
import os
import sys
print(">>> STEP 1: imports starting", flush=True)
from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
print(">>> STEP 2: fastapi imported", flush=True)

load_dotenv()
print(f">>> STEP 3: dotenv loaded, PORT={os.environ.get('PORT','NOT SET')}", flush=True)

from routers import projects, upload, process, assembly
print(">>> STEP 4: all routers imported", flush=True)

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
print(f">>> STEP 5: STORAGE_DIR={STORAGE_DIR}, exists={os.path.exists(STORAGE_DIR)}", flush=True)
os.makedirs(os.path.join(STORAGE_DIR, "outputs"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "uploads"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "logos"), exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, "temp"), exist_ok=True)
print(f">>> STEP 6: directories created", flush=True)

try:
    app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")
    print(">>> STEP 7: StaticFiles mounted OK", flush=True)
except Exception as e:
    print(f">>> STEP 7 ERROR: StaticFiles failed: {e}", flush=True)

app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(assembly.router, prefix="/api/assembly", tags=["assembly"])
print(">>> STEP 8: all routers registered - APP READY", flush=True)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
