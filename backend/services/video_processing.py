"""FFmpeg video processing service."""
import os
import uuid
import subprocess
import json
from typing import List, Optional, Tuple
from models import VideoSegment, Rush, LogoConfig, LogoPosition, OutputFormat, TranscriptSegment

_base = "/data" if os.path.isdir("/data") else os.path.dirname(os.path.dirname(__file__))
STORAGE_DIR = os.path.join(_base, "storage")
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
OUTPUTS_DIR = os.path.join(STORAGE_DIR, "outputs")
LOGOS_DIR = os.path.join(STORAGE_DIR, "logos")
TEMP_DIR = os.path.join(STORAGE_DIR, "temp")

os.makedirs(TEMP_DIR, exist_ok=True)


def get_video_duration(filepath: str) -> float:
    """Get video duration in seconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", filepath
        ],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            return float(stream.get("duration", 0))
    return 0.0


def get_video_dimensions(filepath: str) -> Tuple[int, int]:
    """Get video width and height."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams", filepath
        ],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            return stream.get("width", 1920), stream.get("height", 1080)
    return 1920, 1080


def cut_segment(rush_filepath: str, start: float, end: float, output_path: str) -> bool:
    """Cut a segment from a video file using stream copy (fast, no re-encoding)."""
    duration = end - start
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", rush_filepath,
        "-t", str(duration),
        "-c", "copy",           # Stream copy = instant, no re-encoding
        "-avoid_negative_ts", "make_zero",
        output_path
    ]
    print(f"[CUT] {os.path.basename(rush_filepath)} {start}s→{end}s ({duration:.1f}s)", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"[CUT FAIL] returncode={result.returncode}\nstderr: {result.stderr[:500]}", flush=True)
        return False
    # Validate output
    if not os.path.exists(output_path):
        print(f"[CUT FAIL] output file missing", flush=True)
        return False
    sz = os.path.getsize(output_path)
    print(f"[CUT OK] {sz} bytes", flush=True)
    if sz < 1000:
        print(f"[CUT FAIL] output too small ({sz} bytes)", flush=True)
        return False
    return True


def concatenate_segments(segment_paths: List[str], output_path: str) -> bool:
    """Concatenate multiple video segments, re-encoding for consistency."""
    # Create a temporary file list
    list_file = os.path.join(TEMP_DIR, f"concat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w") as f:
        for path in segment_paths:
            f.write(f"file '{path}'\n")

    print(f"[CONCAT] {len(segment_paths)} segments → {os.path.basename(output_path)}", flush=True)

    # Re-encode during concat to ensure uniform format
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_file,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

    # Cleanup
    if os.path.exists(list_file):
        os.remove(list_file)

    if result.returncode != 0:
        print(f"[CONCAT FAIL] stderr: {result.stderr[:500]}", flush=True)
        return False

    sz = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    print(f"[CONCAT OK] {sz} bytes", flush=True)
    return True


def generate_srt(segments: List[VideoSegment], rushes: List[Rush]) -> str:
    """Generate SRT subtitle content from segments."""
    srt_lines = []
    subtitle_index = 1
    current_time = 0.0

    for seg in sorted(segments, key=lambda s: s.order):
        if not seg.transcript:
            duration = seg.end - seg.start
            current_time += duration
            continue

        # Find the rush transcript for timing
        duration = seg.end - seg.start

        start_srt = _seconds_to_srt_time(current_time)
        end_srt = _seconds_to_srt_time(current_time + duration)

        srt_lines.append(str(subtitle_index))
        srt_lines.append(f"{start_srt} --> {end_srt}")

        # Wrap long lines
        text = seg.transcript.strip()
        if len(text) > 60:
            words = text.split()
            mid = len(words) // 2
            text = " ".join(words[:mid]) + "\n" + " ".join(words[mid:])

        srt_lines.append(text)
        srt_lines.append("")

        subtitle_index += 1
        current_time += duration

    return "\n".join(srt_lines)


def add_subtitles(video_path: str, srt_path: str, output_path: str, style: str = "modern") -> bool:
    """Burn subtitles into video."""
    if style == "modern":
        subtitle_style = (
            "FontName=Arial,FontSize=20,Bold=1,"
            "PrimaryColour=&HFFFFFF,OutlineColour=&H000000,"
            "Outline=2,Shadow=1,Alignment=2,"
            "MarginV=40"
        )
    else:
        subtitle_style = "FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2"

    # Escape path for ffmpeg filter
    escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"subtitles='{escaped_srt}':force_style='{subtitle_style}'",
        "-c:a", "copy",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def add_logo(video_path: str, logo_path: str, output_path: str, config: LogoConfig) -> bool:
    """Add logo overlay to video."""
    # Get video dimensions for logo sizing
    width, height = get_video_dimensions(video_path)
    logo_width = int(width * config.size_percent / 100)

    # Calculate position
    margin = 20
    position_map = {
        LogoPosition.top_left: f"{margin}:{margin}",
        LogoPosition.top_right: f"W-w-{margin}:{margin}",
        LogoPosition.bottom_left: f"{margin}:H-h-{margin}",
        LogoPosition.bottom_right: f"W-w-{margin}:H-h-{margin}",
        LogoPosition.center: "(W-w)/2:(H-h)/2",
    }
    position = position_map.get(config.position, f"W-w-{margin}:H-h-{margin}")

    # Scale logo and overlay
    filter_complex = (
        f"[1:v]scale={logo_width}:-1,"
        f"format=rgba,colorchannelmixer=aa={config.opacity}[logo];"
        f"[0:v][logo]overlay={position}"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", logo_path,
        "-filter_complex", filter_complex,
        "-c:a", "copy",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def export_format(video_path: str, output_path: str, format: OutputFormat) -> bool:
    """Export video in a specific aspect ratio/format."""
    format_configs = {
        OutputFormat.landscape: (1920, 1080),   # 16:9
        OutputFormat.portrait: (1080, 1920),    # 9:16 (Reels, TikTok, Stories)
        OutputFormat.square: (1080, 1080),      # 1:1 (Instagram feed)
        OutputFormat.vertical: (1080, 1350),    # 4:5 (Instagram vertical)
    }

    target_w, target_h = format_configs.get(format, (1920, 1080))

    # Smart crop/pad to target aspect ratio
    filter_chain = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", filter_chain,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "fast",
        "-crf", "22",
        "-movflags", "+faststart",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def _seconds_to_srt_time(seconds: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cleanup_temp_files(project_id: str):
    """Remove temporary files for a project."""
    for filename in os.listdir(TEMP_DIR):
        if project_id in filename:
            try:
                os.remove(os.path.join(TEMP_DIR, filename))
            except Exception:
                pass
