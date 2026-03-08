"""Project management routes."""
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from models import Project, ProjectStatus, CreateProjectRequest, UpdateBriefRequest, UpdateSegmentsRequest
from database import save_project, load_project, list_projects, delete_project

router = APIRouter()


@router.get("/")
async def get_projects():
    """List all projects."""
    projects = list_projects()
    return {"projects": [p.model_dump() for p in projects]}


@router.post("/")
async def create_project(request: CreateProjectRequest):
    """Create a new project."""
    project = Project(
        id=str(uuid.uuid4()),
        name=request.name,
        created_at=datetime.utcnow().isoformat(),
        updated_at=datetime.utcnow().isoformat(),
    )
    save_project(project)
    return project.model_dump()


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get a single project."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.model_dump()


@router.put("/{project_id}/brief")
async def update_brief(project_id: str, request: UpdateBriefRequest):
    """Update project brief."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.brief = request.brief
    save_project(project)
    return project.model_dump()


@router.put("/{project_id}/segments")
async def update_segments(project_id: str, request: UpdateSegmentsRequest):
    """Update/adjust segments (user manual edits)."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.segments = request.segments
    save_project(project)
    return project.model_dump()


@router.post("/{project_id}/reset")
async def reset_project(project_id: str):
    """Reset project and rush statuses to allow re-transcription."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.status = ProjectStatus.created
    project.progress = 0
    project.progress_message = ""
    project.error_message = None
    for rush in project.rushes:
        rush.status = "uploaded"
        rush.error = None
        rush.transcript = None
    save_project(project)
    return project.model_dump()


@router.post("/{project_id}/reset-assembly")
async def reset_assembly(project_id: str):
    """Reset project to review state (keeps transcription + segments)."""
    project = load_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.status = ProjectStatus.review
    project.progress = 75
    project.progress_message = "Prêt pour l'assemblage"
    project.error_message = None
    project.outputs = []
    save_project(project)
    return project.model_dump()


@router.delete("/{project_id}")
async def delete_project_route(project_id: str):
    """Delete a project."""
    success = delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}
