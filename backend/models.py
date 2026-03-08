from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from enum import Enum
from datetime import datetime


class ProjectStatus(str, Enum):
    created = "created"
    uploading = "uploading"
    transcribing = "transcribing"
    transcribed = "transcribed"
    analyzing = "analyzing"
    review = "review"
    assembling = "assembling"
    done = "done"
    error = "error"


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class RushCategory(str, Enum):
    interview = "interview"
    broll = "broll"


class Rush(BaseModel):
    id: str
    filename: str
    original_filename: str
    duration: Optional[float] = None
    file_size: Optional[int] = None
    transcript: Optional[List[TranscriptSegment]] = None
    status: str = "uploaded"  # uploaded | transcribing | transcribed | error
    error: Optional[str] = None
    category: RushCategory = RushCategory.interview


class VideoSegment(BaseModel):
    id: str
    rush_id: str
    start: float  # seconds
    end: float    # seconds
    transcript: Optional[str] = None
    order: int = 0


class LogoPosition(str, Enum):
    top_left = "top-left"
    top_right = "top-right"
    bottom_left = "bottom-left"
    bottom_right = "bottom-right"
    center = "center"


class LogoConfig(BaseModel):
    filename: str
    position: LogoPosition = LogoPosition.bottom_right
    opacity: float = 0.85
    size_percent: float = 15  # % of video width


class OutputFormat(str, Enum):
    landscape = "16:9"
    portrait = "9:16"
    square = "1:1"
    vertical = "4:5"


class MusicConfig(BaseModel):
    filename: str
    volume: float = 0.15  # 0.0 to 1.0


class ExportSettings(BaseModel):
    formats: List[OutputFormat] = [OutputFormat.landscape]
    logo: Optional[LogoConfig] = None
    add_subtitles: bool = True
    subtitle_style: str = "modern"  # modern | classic | minimal
    transition_duration: float = 0.5  # seconds, 0 = no transition
    music: Optional[MusicConfig] = None


class OutputFile(BaseModel):
    format: str
    filename: str
    file_size: Optional[int] = None
    url: str


class Project(BaseModel):
    id: str
    name: str
    status: ProjectStatus = ProjectStatus.created
    brief: Optional[str] = None
    rushes: List[Rush] = []
    segments: List[VideoSegment] = []
    export_settings: ExportSettings = ExportSettings()
    outputs: List[OutputFile] = []
    error_message: Optional[str] = None
    progress: int = 0  # 0-100
    progress_message: str = ""
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# Request models
class CreateProjectRequest(BaseModel):
    name: str


class UpdateBriefRequest(BaseModel):
    brief: str


class UpdateSegmentsRequest(BaseModel):
    segments: List[VideoSegment]


class UpdateExportSettingsRequest(BaseModel):
    formats: List[OutputFormat]
    add_subtitles: bool = True
    subtitle_style: str = "modern"
