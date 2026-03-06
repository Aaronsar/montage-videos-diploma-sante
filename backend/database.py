"""Simple JSON-based storage for projects (no DB needed for MVP)."""
import json
import os
from typing import Optional
from models import Project
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)


def _project_path(project_id: str) -> str:
    return os.path.join(DATA_DIR, f"{project_id}.json")


def save_project(project: Project) -> None:
    project.updated_at = datetime.utcnow().isoformat()
    with open(_project_path(project.id), "w", encoding="utf-8") as f:
        json.dump(project.model_dump(), f, ensure_ascii=False, indent=2)


def load_project(project_id: str) -> Optional[Project]:
    path = _project_path(project_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return Project(**data)


def list_projects() -> list[Project]:
    projects = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            project_id = filename[:-5]
            project = load_project(project_id)
            if project:
                projects.append(project)
    projects.sort(key=lambda p: p.created_at, reverse=True)
    return projects


def delete_project(project_id: str) -> bool:
    path = _project_path(project_id)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False
