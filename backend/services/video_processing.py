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


def _has_audio_stream(filepath: str) -> bool:
    """Check if a video file has an audio stream."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-select_streams", "a",
                "-show_entries", "stream=codec_type",
                "-of", "csv=p=0",
                filepath,
            ],
            capture_output=True, text=True, timeout=30,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def cut_segment(rush_filepath: str, start: float, end: float, output_path: str) -> bool:
    """Cut a segment from a video file, normalizing to 1920x1080 h264+aac.

    Re-encodes every segment to the same format so they can be concatenated:
    - Video: h264, 1920x1080, 30fps
    - Audio: AAC stereo 44100Hz (adds silent audio if source has none)
    """
    duration = end - start
    has_audio = _has_audio_stream(rush_filepath)

    print(f"[CUT] {os.path.basename(rush_filepath)} {start}s→{end}s ({duration:.1f}s) audio={has_audio}", flush=True)

    # Normalize video: scale to fit 1920x1080 (letterbox if needed), 30fps
    vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p"

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", rush_filepath,
    ]

    if not has_audio:
        # Add silent audio source so all segments have audio
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"])

    cmd.extend([
        "-t", str(duration),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "ultrafast",    # ultrafast for speed on Railway
        "-crf", "23",
        "-threads", "0",           # Use all available CPU cores
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
    ])

    if not has_audio:
        # Map video from input 0, audio from silent source (input 1)
        cmd.extend(["-map", "0:v:0", "-map", "1:a:0", "-shortest"])

    cmd.extend(["-movflags", "+faststart", output_path])

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
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
    """Concatenate pre-normalized video segments using stream copy (fast).

    All segments must already be in the same format (h264, 1080p, aac)
    thanks to cut_segment normalization.
    """
    # Create a temporary file list
    list_file = os.path.join(TEMP_DIR, f"concat_{uuid.uuid4().hex}.txt")
    with open(list_file, "w") as f:
        for path in segment_paths:
            f.write(f"file '{path}'\n")

    print(f"[CONCAT] {len(segment_paths)} segments → {os.path.basename(output_path)}", flush=True)
    for i, p in enumerate(segment_paths):
        sz = os.path.getsize(p) if os.path.exists(p) else 0
        print(f"  [{i}] {os.path.basename(p)} — {sz} bytes", flush=True)

    # Stream copy since all segments are already normalized to same format
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_file,
        "-c", "copy",
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
    """Generate SRT subtitle content from segments using Whisper timestamps.

    Uses the original Whisper transcript segments (per-phrase timing) from each Rush
    to create properly timed subtitles that appear progressively as the person speaks.
    B-roll segments (no transcript) advance the timeline without subtitles.
    """
    srt_lines = []
    subtitle_index = 1
    current_time = 0.0

    # Build rush lookup for accessing Whisper transcript segments
    rush_lookup = {r.id: r for r in rushes}

    for seg in sorted(segments, key=lambda s: s.order):
        duration = seg.end - seg.start
        rush = rush_lookup.get(seg.rush_id)

        # B-roll or no transcript: just advance timeline
        if not seg.transcript or not rush or not rush.transcript:
            current_time += duration
            continue

        # Find Whisper transcript segments that fall within this VideoSegment's time range
        matching_whisper_segs = []
        for ws in rush.transcript:
            # Whisper segment overlaps with our cut range [seg.start, seg.end]
            if ws.end > seg.start and ws.start < seg.end:
                # Clamp to segment boundaries
                ws_start = max(ws.start, seg.start)
                ws_end = min(ws.end, seg.end)
                # Remap to final video timeline
                offset_in_seg = ws_start - seg.start
                final_start = current_time + offset_in_seg
                final_end = current_time + (ws_end - seg.start)
                matching_whisper_segs.append((final_start, final_end, ws.text.strip()))

        if matching_whisper_segs:
            # Create individual SRT entries for each phrase
            for ws_start, ws_end, text in matching_whisper_segs:
                if not text:
                    continue
                srt_lines.append(str(subtitle_index))
                srt_lines.append(f"{_seconds_to_srt_time(ws_start)} --> {_seconds_to_srt_time(ws_end)}")

                # Wrap long lines at ~42 chars for readability
                if len(text) > 42:
                    words = text.split()
                    mid = len(words) // 2
                    text = " ".join(words[:mid]) + "\n" + " ".join(words[mid:])

                srt_lines.append(text)
                srt_lines.append("")
                subtitle_index += 1
        else:
            # Fallback: single subtitle for the whole segment
            srt_lines.append(str(subtitle_index))
            srt_lines.append(f"{_seconds_to_srt_time(current_time)} --> {_seconds_to_srt_time(current_time + duration)}")
            text = seg.transcript.strip()
            if len(text) > 42:
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
            "FontName=Arial,FontSize=22,Bold=1,"
            "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
            "BackColour=&H80000000,"
            "Outline=2,Shadow=1,Alignment=2,"
            "MarginV=50"
        )
    else:
        subtitle_style = "FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2"

    # Escape path for ffmpeg filter
    escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"subtitles='{escaped_srt}':force_style='{subtitle_style}'",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path
    ]
    print(f"[SUBTITLES] Burning subtitles into video...", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"[SUBTITLES FAIL] stderr: {result.stderr[:500]}", flush=True)
        return False
    print(f"[SUBTITLES OK]", flush=True)
    return True


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
    """Remove temporary files for a project (both flat files and project subdirectory)."""
    import shutil

    # Clean flat files matching project_id
    for filename in os.listdir(TEMP_DIR):
        if project_id in filename:
            try:
                fpath = os.path.join(TEMP_DIR, filename)
                if os.path.isdir(fpath):
                    shutil.rmtree(fpath)
                else:
                    os.remove(fpath)
            except Exception:
                pass

    # Clean project-specific temp subdirectory
    project_temp = os.path.join(TEMP_DIR, project_id)
    if os.path.isdir(project_temp):
        try:
            shutil.rmtree(project_temp)
            print(f"[CLEANUP] Removed temp dir for {project_id}", flush=True)
        except Exception:
            pass
