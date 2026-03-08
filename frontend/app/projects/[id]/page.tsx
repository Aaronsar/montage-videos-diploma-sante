"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft, Upload, FileVideo, Sparkles, CheckCircle, AlertCircle,
  Loader2, Play, Trash2, Download, RefreshCw, ChevronRight, Film,
  Clock, Sliders, LayoutTemplate, ArrowUp, ArrowDown, Plus, Save,
  Music, Camera, Mic, GripVertical
} from "lucide-react";

const API = "https://montage-videos-diploma-sante-production.up.railway.app";

// ─── Types ───────────────────────────────────────────────────────────────────
interface TranscriptSegment { start: number; end: number; text: string; }
interface Rush {
  id: string; filename: string; original_filename: string;
  duration: number | null; file_size: number | null;
  status: string; transcript: TranscriptSegment[] | null;
  category: "interview" | "broll";
}
interface Segment {
  id: string; rush_id: string; start: number; end: number;
  transcript: string | null; order: number;
}
interface OutputFile { format: string; filename: string; file_size: number | null; url: string; }
interface Project {
  id: string; name: string; status: string; brief: string | null;
  rushes: Rush[]; segments: Segment[]; outputs: OutputFile[];
  progress: number; progress_message: string; error_message: string | null;
}
interface MusicTrack { filename: string; name: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
               : `${m}:${String(sec).padStart(2,"0")}`;
};
const fmtDec = (s: number) => {
  const m = Math.floor(s / 60), sec = (s % 60);
  return m > 0 ? `${m}m ${sec.toFixed(1)}s` : `${sec.toFixed(1)}s`;
};
const fmtSize = (bytes: number | null) => {
  if (!bytes) return "—";
  if (bytes > 1e9) return `${(bytes/1e9).toFixed(1)} Go`;
  return `${(bytes/1e6).toFixed(0)} Mo`;
};
const STEPS = ["Rushes", "Brief", "Analyse IA", "Révision", "Export"];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ProjectPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<"interview" | "broll">("interview");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [formats, setFormats] = useState<string[]>(["16:9"]);
  const [addSubtitles, setAddSubtitles] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoFilename, setLogoFilename] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  // Transitions
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const [transitionDuration, setTransitionDuration] = useState(0.5);
  // Music
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [selectedMusic, setSelectedMusic] = useState<string>("");
  const [musicVolume, setMusicVolume] = useState(0.15);
  // Segment editor
  const [editedSegments, setEditedSegments] = useState<Segment[]>([]);
  const [segmentsModified, setSegmentsModified] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [addingSegment, setAddingSegment] = useState(false);
  const [newSegRushId, setNewSegRushId] = useState("");
  const [newSegStart, setNewSegStart] = useState(0);
  const [newSegEnd, setNewSegEnd] = useState(5);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const prevStatusRef = useRef<string>("");

  // ── Fetch project ──
  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/projects/${id}`);
      if (!res.ok) {
        if (res.status === 404) router.push("/");
        return;
      }
      const data: Project = await res.json();
      setProject(data);
      if (data.brief && !brief) setBrief(data.brief);

      // Auto-advance step based on status transitions
      const prev = prevStatusRef.current;
      const s = data.status;
      prevStatusRef.current = s;

      // During active processing: always force the correct step
      if (s === "transcribing") setStep(1);
      else if (s === "analyzing") setStep(2);
      else if (s === "assembling") setStep(4);
      // On completion transitions: advance ONCE then let user navigate freely
      else if (s === "review" && (prev === "analyzing" || prev === "")) setStep(3);
      else if (s === "done" && prev === "assembling") setStep(4);
    } catch {}
  }, [id, brief]);

  // Init segments for editor when project loads
  useEffect(() => {
    if (project && project.segments.length > 0 && editedSegments.length === 0) {
      setEditedSegments([...project.segments].sort((a, b) => a.order - b.order));
    }
  }, [project?.segments]);

  useEffect(() => {
    fetchProject();
    pollingRef.current = setInterval(fetchProject, 2500);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchProject]);

  // Fetch music tracks
  useEffect(() => {
    fetch(`${API}/api/assembly/music-tracks`)
      .then(r => r.json())
      .then(data => setMusicTracks(data.tracks || []))
      .catch(() => {});
  }, []);

  // ── Upload videos (chunked for large files) ──
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

  const uploadFileChunked = async (file: File, category: "interview" | "broll"): Promise<boolean> => {
    // 1. Init chunked upload
    const initForm = new FormData();
    initForm.append("filename", file.name);
    initForm.append("file_size", String(file.size));
    initForm.append("category", category);
    const initRes = await fetch(`${API}/api/upload/${id}/chunk/init`, { method: "POST", body: initForm });
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      setUploadError(err.detail || `Erreur init (${initRes.status})`);
      return false;
    }
    const { upload_id } = await initRes.json();

    // 2. Upload chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const startTime = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      const chunkForm = new FormData();
      chunkForm.append("upload_id", upload_id);
      chunkForm.append("chunk_index", String(i));
      chunkForm.append("chunk", blob, `chunk_${i}`);

      let retries = 0;
      let success = false;
      while (retries < 3 && !success) {
        try {
          const res = await fetch(`${API}/api/upload/${id}/chunk/upload`, { method: "POST", body: chunkForm });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (retries >= 2) {
              setUploadError(err.detail || `Erreur chunk ${i} (${res.status})`);
              return false;
            }
            retries++;
            await new Promise(r => setTimeout(r, 1000 * retries));
          } else {
            success = true;
          }
        } catch {
          retries++;
          if (retries >= 3) {
            setUploadError(`Erreur réseau au chunk ${i + 1}/${totalChunks}`);
            return false;
          }
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }

      // Update progress
      const bytesSent = end;
      const pct = Math.round((bytesSent / file.size) * 100);
      setUploadProgress(pct);

      const elapsed = (Date.now() - startTime) / 1000;
      const bytesPerSec = bytesSent / elapsed;
      const remaining = (file.size - bytesSent) / bytesPerSec;
      const fmtSpd = bytesPerSec > 1024 * 1024
        ? `${(bytesPerSec / 1024 / 1024).toFixed(1)} Mo/s`
        : `${(bytesPerSec / 1024).toFixed(0)} Ko/s`;
      const fmtTime = remaining < 60
        ? `${Math.ceil(remaining)}s restantes`
        : `${Math.ceil(remaining / 60)}min restantes`;
      setUploadSpeed(`${fmtSpd} · ${fmtTime} · Chunk ${i + 1}/${totalChunks}`);
    }

    // 3. Complete — assemble on server
    setUploadSpeed("Assemblage du fichier sur le serveur...");
    const completeForm = new FormData();
    completeForm.append("upload_id", upload_id);
    const completeRes = await fetch(`${API}/api/upload/${id}/chunk/complete`, { method: "POST", body: completeForm });
    if (!completeRes.ok) {
      const err = await completeRes.json().catch(() => ({}));
      setUploadError(err.detail || `Erreur assemblage (${completeRes.status})`);
      return false;
    }
    return true;
  };

  const onDropInterview = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    setUploadCategory("interview");
    setUploadProgress(0);
    setUploadSpeed("");
    setUploadError("");

    let allOk = true;
    for (const file of acceptedFiles) {
      setUploadSpeed(`Upload de ${file.name} (interview)...`);
      const ok = await uploadFileChunked(file, "interview");
      if (!ok) { allOk = false; break; }
    }

    if (allOk) await fetchProject();
    setUploading(false);
    setUploadProgress(0);
    setUploadSpeed("");
  }, [id, fetchProject]);

  const onDropBroll = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    setUploadCategory("broll");
    setUploadProgress(0);
    setUploadSpeed("");
    setUploadError("");

    let allOk = true;
    for (const file of acceptedFiles) {
      setUploadSpeed(`Upload de ${file.name} (illustration)...`);
      const ok = await uploadFileChunked(file, "broll");
      if (!ok) { allOk = false; break; }
    }

    if (allOk) await fetchProject();
    setUploading(false);
    setUploadProgress(0);
    setUploadSpeed("");
  }, [id, fetchProject]);

  const interviewDropzone = useDropzone({
    onDrop: onDropInterview,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"] },
    multiple: true,
    disabled: uploading,
  });

  const brollDropzone = useDropzone({
    onDrop: onDropBroll,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"] },
    multiple: true,
    disabled: uploading,
  });

  // ── Actions ──
  const startTranscription = async () => {
    await fetch(`${API}/api/process/${id}/transcribe`, { method: "POST" });
    fetchProject();
  };

  const [analysisError, setAnalysisError] = useState("");

  const saveBriefAndAnalyze = async () => {
    setAnalysisError("");
    try {
      await fetch(`${API}/api/projects/${id}/brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const res = await fetch(`${API}/api/process/${id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAnalysisError(err.detail || "Erreur lors de l'analyse. Vérifiez que les rushes sont transcrits.");
        return;
      }
      fetchProject();
    } catch (e) {
      setAnalysisError("Erreur réseau. Réessayez.");
    }
  };

  const uploadLogo = async (file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/api/upload/${id}/logo`, { method: "POST", body: fd });
    if (!res.ok) return null;
    const data = await res.json();
    return data.filename;
  };

  const assembleVideo = async () => {
    let resolvedLogo: string | null = logoFilename;
    if (logoFile && !logoFilename) {
      resolvedLogo = await uploadLogo(logoFile);
      if (resolvedLogo) setLogoFilename(resolvedLogo);
    }
    const body: Record<string, unknown> = {
      formats: formats.map(f => f),
      add_subtitles: addSubtitles,
      subtitle_style: "modern",
      transition_duration: transitionsEnabled ? transitionDuration : 0,
    };
    if (resolvedLogo) {
      body.logo_filename = resolvedLogo;
      body.logo_position = logoPosition;
      body.logo_opacity = 0.85;
      body.logo_size_percent = 15;
    }
    if (selectedMusic) {
      body.music_track = selectedMusic;
      body.music_volume = musicVolume;
    }
    await fetch(`${API}/api/assembly/${id}/assemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchProject();
  };

  const deleteRush = async (rushId: string) => {
    await fetch(`${API}/api/upload/${id}/videos/${rushId}`, { method: "DELETE" });
    fetchProject();
  };

  // ── Segment editor actions ──
  const updateSegmentField = (index: number, field: "start" | "end", value: number) => {
    setEditedSegments(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: Math.max(0, value) };
      return copy;
    });
    setSegmentsModified(true);
  };

  const moveSegment = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= editedSegments.length) return;
    setEditedSegments(prev => {
      const copy = [...prev];
      const tmp = copy[index];
      copy[index] = copy[newIndex];
      copy[newIndex] = tmp;
      return copy.map((seg, i) => ({ ...seg, order: i }));
    });
    setSegmentsModified(true);
  };

  const removeSegment = (index: number) => {
    setEditedSegments(prev => prev.filter((_, i) => i !== index).map((seg, i) => ({ ...seg, order: i })));
    setSegmentsModified(true);
  };

  const addNewSegment = () => {
    if (!newSegRushId || newSegEnd <= newSegStart) return;
    const rush = project?.rushes.find(r => r.id === newSegRushId);
    const newSeg: Segment = {
      id: `new_${Date.now()}`,
      rush_id: newSegRushId,
      start: newSegStart,
      end: newSegEnd,
      transcript: rush?.category === "broll" ? "" : null,
      order: editedSegments.length,
    };
    setEditedSegments(prev => [...prev, newSeg]);
    setSegmentsModified(true);
    setAddingSegment(false);
    setNewSegStart(0);
    setNewSegEnd(5);
  };

  const saveSegments = async () => {
    setSavingSegments(true);
    try {
      await fetch(`${API}/api/projects/${id}/segments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: editedSegments }),
      });
      setSegmentsModified(false);
      await fetchProject();
    } catch (e) {
      console.error("Error saving segments:", e);
    }
    setSavingSegments(false);
  };

  const totalDuration = editedSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

  if (!project) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-violet-500" />
      </div>
    );
  }

  const isProcessing = ["transcribing", "analyzing", "assembling", "uploading"].includes(project.status);
  const interviewRushes = project.rushes.filter(r => (r.category || "interview") === "interview");
  const brollRushes = project.rushes.filter(r => r.category === "broll");

  return (
    <div className="min-h-screen bg-[#09090f]">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button onClick={() => router.push("/")} className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
              <Film size={14} />
            </div>
            <span className="font-semibold text-sm">{project.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            {isProcessing && <Loader2 size={13} className="animate-spin text-violet-400" />}
            <span>{project.progress_message || project.status}</span>
          </div>
        </div>
      </header>

      {/* Step nav */}
      <div className="border-b border-[#1e1e2e] px-8 py-0">
        <div className="max-w-5xl mx-auto flex">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center">
              <button
                onClick={() => !isProcessing && setStep(i)}
                className={`px-4 py-3 text-sm border-b-2 transition-colors ${
                  step === i
                    ? "border-violet-500 text-white font-medium"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={14} className="text-gray-700 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-8 py-8">
        {/* Error banner */}
        {project.status === "error" && project.error_message && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-400 text-sm">Une erreur est survenue</p>
              <p className="text-red-300/70 text-xs mt-1">{project.error_message}</p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {isProcessing && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>{project.progress_message}</span>
              <span>{project.progress}%</span>
            </div>
            <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-600 rounded-full transition-all duration-700 relative"
                style={{ width: `${project.progress}%` }}
              >
                <div className="absolute inset-0 shimmer" />
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 0: Upload Rushes ── */}
        {step === 0 && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-1">Importer vos rushes</h2>
              <p className="text-gray-500 text-sm">Importez vos vidéos d'interview et d'illustration séparément</p>
            </div>

            {/* Two Upload Zones */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {/* Interview dropzone */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Mic size={14} className="text-violet-400" />
                  <span className="text-sm font-medium">Vidéos principales</span>
                  <span className="text-xs text-gray-500">(interviews, discours)</span>
                </div>
                <div
                  {...interviewDropzone.getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    interviewDropzone.isDragActive
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-[#1e1e2e] hover:border-violet-600/50 hover:bg-[#111118]"
                  } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input {...interviewDropzone.getInputProps()} />
                  <div className="w-12 h-12 bg-[#1e1e2e] rounded-xl flex items-center justify-center mx-auto mb-3">
                    {uploading && uploadCategory === "interview" ? (
                      <Loader2 size={20} className="animate-spin text-violet-400" />
                    ) : (
                      <Mic size={20} className="text-violet-400" />
                    )}
                  </div>
                  <p className="font-medium text-sm mb-1">
                    {uploading && uploadCategory === "interview" ? `Upload... ${uploadProgress}%` : "Glisser vos interviews ici"}
                  </p>
                  <p className="text-gray-500 text-xs">Avec paroles à transcrire</p>
                </div>
              </div>

              {/* B-Roll dropzone */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Camera size={14} className="text-orange-400" />
                  <span className="text-sm font-medium">Vidéos d'illustration</span>
                  <span className="text-xs text-gray-500">(drone, B-roll)</span>
                </div>
                <div
                  {...brollDropzone.getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    brollDropzone.isDragActive
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-[#1e1e2e] hover:border-orange-600/50 hover:bg-[#111118]"
                  } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input {...brollDropzone.getInputProps()} />
                  <div className="w-12 h-12 bg-[#1e1e2e] rounded-xl flex items-center justify-center mx-auto mb-3">
                    {uploading && uploadCategory === "broll" ? (
                      <Loader2 size={20} className="animate-spin text-orange-400" />
                    ) : (
                      <Camera size={20} className="text-orange-400" />
                    )}
                  </div>
                  <p className="font-medium text-sm mb-1">
                    {uploading && uploadCategory === "broll" ? `Upload... ${uploadProgress}%` : "Glisser vos vidéos B-roll ici"}
                  </p>
                  <p className="text-gray-500 text-xs">Sans paroles (pas de transcription)</p>
                </div>
              </div>
            </div>

            {/* Upload progress bar */}
            {uploading && (
              <div className="mb-4 bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 size={14} className="animate-spin text-violet-400" />
                  <span className="text-sm">Upload en cours...</span>
                </div>
                <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                {uploadSpeed && <p className="text-xs text-gray-400">{uploadSpeed}</p>}
              </div>
            )}

            {/* Upload error */}
            {uploadError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm">{uploadError}</p>
              </div>
            )}

            {/* Interview rush list */}
            {interviewRushes.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Mic size={13} className="text-violet-400" />
                  <h3 className="text-sm font-medium text-gray-300">Interviews ({interviewRushes.length})</h3>
                </div>
                <div className="space-y-2">
                  {interviewRushes.map((rush) => (
                    <div key={rush.id} className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex items-center gap-4">
                      <div className="w-9 h-9 bg-violet-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Mic size={14} className="text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{rush.original_filename}</p>
                        <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                          {rush.duration && <span><Clock size={10} className="inline mr-1" />{fmt(rush.duration)}</span>}
                          {rush.file_size && <span>{fmtSize(rush.file_size)}</span>}
                          <span className={rush.status === "transcribed" ? "text-green-400" : "text-gray-500"}>
                            {rush.status === "transcribed" ? "Transcrit" : rush.status}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteRush(rush.id)}
                        className="p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* B-roll rush list */}
            {brollRushes.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Camera size={13} className="text-orange-400" />
                  <h3 className="text-sm font-medium text-gray-300">Illustrations / B-roll ({brollRushes.length})</h3>
                </div>
                <div className="space-y-2">
                  {brollRushes.map((rush) => (
                    <div key={rush.id} className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex items-center gap-4">
                      <div className="w-9 h-9 bg-orange-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Camera size={14} className="text-orange-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{rush.original_filename}</p>
                        <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                          {rush.duration && <span><Clock size={10} className="inline mr-1" />{fmt(rush.duration)}</span>}
                          {rush.file_size && <span>{fmtSize(rush.file_size)}</span>}
                          <span className="text-orange-400">B-roll</span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteRush(rush.id)}
                        className="p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action */}
            {project.rushes.length > 0 && (
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => { startTranscription(); setStep(1); }}
                  disabled={isProcessing}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  Transcrire les rushes
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 1: Brief ── */}
        {step === 1 && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-1">Votre brief</h2>
              <p className="text-gray-500 text-sm">Décrivez la vidéo que vous voulez créer</p>
            </div>

            {/* Transcription status */}
            {(() => {
              const transcribed = project.rushes.filter(r => r.status === "transcribed").length;
              const total = project.rushes.length;
              const allDone = transcribed === total && total > 0;
              const isTranscribing = project.status === "transcribing";
              const hasError = transcribed === 0 && !isTranscribing && total > 0;
              return (
                <div className={`border rounded-xl p-4 mb-6 ${hasError ? "bg-red-500/10 border-red-500/30" : "bg-[#111118] border-[#1e1e2e]"}`}>
                  <div className="flex items-center gap-3">
                    {isTranscribing ? (
                      <Loader2 size={16} className="animate-spin text-violet-400" />
                    ) : allDone ? (
                      <CheckCircle size={16} className="text-green-400" />
                    ) : (
                      <AlertCircle size={16} className={hasError ? "text-red-400" : "text-yellow-400"} />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {isTranscribing ? "Transcription en cours..." : allDone ? "Transcription terminée" : hasError ? "Rushes non transcrits" : `${transcribed}/${total} rush(es) transcrits`}
                      </p>
                      {!allDone && !isTranscribing && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {hasError ? "Retournez à l'étape précédente pour transcrire" : `${transcribed}/${total} transcrits`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Brief de la vidéo</label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={`Exemple:\n"Crée une pub de 60 secondes pour nos services de coaching. Commence par un hook fort, mets en avant les résultats clients, et termine par un call-to-action. Ton dynamique et inspirant."`}
                rows={8}
                className="w-full bg-[#111118] border border-[#1e1e2e] rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 transition-colors resize-none"
              />
            </div>

            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 mb-6">
              <p className="text-xs text-gray-400 font-medium mb-2">Conseils pour un bon brief :</p>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>- Précisez la durée souhaitée (30s, 60s, 2min...)</li>
                <li>- Décrivez le ton (dynamique, inspirant, informatif...)</li>
                <li>- Mentionnez les points clés à inclure</li>
                <li>- Précisez l'audience cible</li>
              </ul>
            </div>

            {analysisError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4 text-sm text-red-400">
                <AlertCircle size={15} />
                {analysisError}
              </div>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setStep(0)}
                className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft size={16} /> Retour
              </button>
              <button
                onClick={saveBriefAndAnalyze}
                disabled={!brief.trim() || isProcessing || project.rushes.filter(r => r.status === "transcribed").length === 0}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Sparkles size={16} />
                Analyser avec l'IA
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: AI Analysis ── */}
        {step === 2 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 bg-violet-600/20 rounded-2xl flex items-center justify-center mb-6">
              <Sparkles size={36} className="text-violet-400 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold mb-2">L'IA analyse vos rushes</h2>
            <p className="text-gray-500 text-sm mb-8 text-center max-w-md">
              Claude lit toutes les transcriptions et sélectionne les meilleurs passages selon votre brief
            </p>
            <div className="w-64">
              <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                <div className="h-full bg-violet-600 rounded-full relative" style={{ width: `${project.progress}%` }}>
                  <div className="absolute inset-0 shimmer" />
                </div>
              </div>
              <p className="text-xs text-gray-500 text-center mt-2">{project.progress_message}</p>
            </div>
          </div>
        )}

        {/* ── STEP 3: Review & Edit Segments ── */}
        {step === 3 && (
          <div>
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold mb-1">Éditeur de segments</h2>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-gray-500 text-sm">{editedSegments.length} segment(s)</p>
                  <span className="text-gray-600">·</span>
                  <p className="text-sm text-violet-400 font-mono">Durée totale : {fmtDec(totalDuration)}</p>
                  {segmentsModified && (
                    <>
                      <span className="text-gray-600">·</span>
                      <span className="text-xs text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">
                        Non sauvegardé
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {segmentsModified && (
                  <button
                    onClick={saveSegments}
                    disabled={savingSegments}
                    className="flex items-center gap-2 text-sm bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {savingSegments ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Sauvegarder
                  </button>
                )}
                <button
                  onClick={saveBriefAndAnalyze}
                  disabled={isProcessing}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-[#1e1e2e] hover:border-[#333] px-3 py-2 rounded-lg transition-colors"
                >
                  <RefreshCw size={14} /> Ré-analyser
                </button>
              </div>
            </div>

            {editedSegments.length === 0 ? (
              <div className="text-center py-16 text-gray-500">Aucun segment sélectionné</div>
            ) : (
              <div className="space-y-2 mb-4">
                {editedSegments.map((seg, i) => {
                  const rush = project.rushes.find(r => r.id === seg.rush_id);
                  const isBroll = rush?.category === "broll";
                  const segDuration = seg.end - seg.start;
                  return (
                    <div key={seg.id} className={`bg-[#111118] border rounded-xl p-4 ${isBroll ? "border-orange-500/20" : "border-[#1e1e2e]"}`}>
                      <div className="flex items-start gap-3">
                        {/* Number + drag handle */}
                        <div className="flex flex-col items-center gap-1 pt-1">
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                            isBroll ? "bg-orange-600/20 text-orange-400" : "bg-violet-600/20 text-violet-400"
                          }`}>
                            {i + 1}
                          </div>
                          <GripVertical size={14} className="text-gray-600" />
                        </div>

                        {/* Main content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {isBroll ? (
                              <Camera size={12} className="text-orange-400" />
                            ) : (
                              <Mic size={12} className="text-violet-400" />
                            )}
                            <span className="text-xs text-gray-400 font-medium truncate">
                              {rush?.original_filename || rush?.filename}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              isBroll ? "bg-orange-500/10 text-orange-400" : "bg-violet-500/10 text-violet-400"
                            }`}>
                              {isBroll ? "B-roll" : "Interview"}
                            </span>
                            <span className="ml-auto text-xs text-gray-500 font-mono">
                              {fmtDec(segDuration)}
                            </span>
                          </div>

                          {/* Time inputs */}
                          <div className="flex items-center gap-3 mb-2">
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs text-gray-500 w-10">Début</label>
                              <input
                                type="number"
                                value={seg.start}
                                onChange={(e) => updateSegmentField(i, "start", parseFloat(e.target.value) || 0)}
                                step="0.1"
                                min="0"
                                className="w-20 bg-[#09090f] border border-[#2a2a3e] rounded-md px-2 py-1 text-xs font-mono text-center outline-none focus:border-violet-600"
                              />
                              <span className="text-xs text-gray-600">s</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs text-gray-500 w-6">Fin</label>
                              <input
                                type="number"
                                value={seg.end}
                                onChange={(e) => updateSegmentField(i, "end", parseFloat(e.target.value) || 0)}
                                step="0.1"
                                min="0"
                                className="w-20 bg-[#09090f] border border-[#2a2a3e] rounded-md px-2 py-1 text-xs font-mono text-center outline-none focus:border-violet-600"
                              />
                              <span className="text-xs text-gray-600">s</span>
                            </div>
                            {rush?.duration && (
                              <span className="text-xs text-gray-600">/ {fmtDec(rush.duration)}</span>
                            )}
                          </div>

                          {/* Transcript */}
                          {seg.transcript && (
                            <p className="text-xs text-gray-500 leading-relaxed italic truncate">
                              &quot;{seg.transcript}&quot;
                            </p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => moveSegment(i, -1)}
                            disabled={i === 0}
                            className="p-1.5 hover:bg-[#1e1e2e] rounded-md text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                            title="Monter"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            onClick={() => moveSegment(i, 1)}
                            disabled={i === editedSegments.length - 1}
                            className="p-1.5 hover:bg-[#1e1e2e] rounded-md text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                            title="Descendre"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            onClick={() => removeSegment(i)}
                            className="p-1.5 hover:bg-red-500/20 rounded-md text-gray-500 hover:text-red-400 transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add segment */}
            {!addingSegment ? (
              <button
                onClick={() => {
                  setAddingSegment(true);
                  if (project.rushes.length > 0 && !newSegRushId) {
                    setNewSegRushId(project.rushes[0].id);
                  }
                }}
                className="w-full border-2 border-dashed border-[#1e1e2e] hover:border-violet-600/50 rounded-xl p-3 flex items-center justify-center gap-2 text-gray-500 hover:text-violet-400 transition-colors text-sm"
              >
                <Plus size={16} /> Ajouter un segment
              </button>
            ) : (
              <div className="bg-[#111118] border border-violet-600/30 rounded-xl p-4 mb-4">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Plus size={14} className="text-violet-400" /> Nouveau segment
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Rush source</label>
                    <select
                      value={newSegRushId}
                      onChange={(e) => setNewSegRushId(e.target.value)}
                      className="w-full bg-[#09090f] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-600"
                    >
                      {project.rushes.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.category === "broll" ? "[B-roll] " : ""}{r.original_filename} {r.duration ? `(${fmt(r.duration)})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Début (s)</label>
                    <input
                      type="number"
                      value={newSegStart}
                      onChange={(e) => setNewSegStart(parseFloat(e.target.value) || 0)}
                      step="0.1"
                      min="0"
                      className="w-full bg-[#09090f] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-violet-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Fin (s)</label>
                    <input
                      type="number"
                      value={newSegEnd}
                      onChange={(e) => setNewSegEnd(parseFloat(e.target.value) || 0)}
                      step="0.1"
                      min="0"
                      className="w-full bg-[#09090f] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-violet-600"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setAddingSegment(false)}
                    className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={addNewSegment}
                    disabled={!newSegRushId || newSegEnd <= newSegStart}
                    className="text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <button onClick={() => setStep(1)} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
                <ArrowLeft size={16} /> Modifier le brief
              </button>
              <button
                onClick={() => {
                  if (segmentsModified) saveSegments();
                  setStep(4);
                }}
                disabled={editedSegments.length === 0}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Configurer l'export <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Export ── */}
        {step === 4 && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-1">Export</h2>
              <p className="text-gray-500 text-sm">Configurez les formats et options finales</p>
            </div>

            {/* Outputs if done */}
            {project.status === "done" && project.outputs.length > 0 && (
              <div className="mb-6 bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="font-medium text-green-400 text-sm">Vidéos prêtes !</span>
                </div>
                <div className="space-y-2">
                  {project.outputs.map((out) => (
                    <a
                      key={out.format}
                      href={`${API}${out.url}`}
                      download
                      className="flex items-center justify-between bg-[#111118] border border-[#1e1e2e] rounded-lg px-4 py-3 hover:border-green-500/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <LayoutTemplate size={16} className="text-green-400" />
                        <span className="text-sm font-medium">{out.format}</span>
                        {out.file_size && <span className="text-xs text-gray-500">{fmtSize(out.file_size)}</span>}
                      </div>
                      <Download size={16} className="text-gray-400" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Formats */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 mb-4">
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <LayoutTemplate size={16} className="text-violet-400" /> Formats d'export
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "16:9", label: "16:9", desc: "YouTube, TV" },
                  { value: "9:16", label: "9:16", desc: "Reels, TikTok, Stories" },
                  { value: "1:1", label: "1:1", desc: "Instagram carré" },
                  { value: "4:5", label: "4:5", desc: "Instagram vertical" },
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setFormats(prev =>
                      prev.includes(f.value) ? prev.filter(x => x !== f.value) : [...prev, f.value]
                    )}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      formats.includes(f.value)
                        ? "border-violet-600 bg-violet-600/10"
                        : "border-[#2a2a3e] hover:border-[#444]"
                    }`}
                  >
                    <p className="font-medium text-sm">{f.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 mb-4">
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <Sliders size={16} className="text-violet-400" /> Options
              </h3>

              {/* Subtitles toggle */}
              <label className="flex items-center gap-3 cursor-pointer mb-5">
                <div
                  onClick={() => setAddSubtitles(p => !p)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${addSubtitles ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${addSubtitles ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
                <div>
                  <p className="text-sm">Sous-titres automatiques</p>
                  <p className="text-xs text-gray-500">Style EduMove (orange, une ligne)</p>
                </div>
              </label>

              {/* Transitions toggle + slider */}
              <div className="mb-5">
                <label className="flex items-center gap-3 cursor-pointer mb-2">
                  <div
                    onClick={() => setTransitionsEnabled(p => !p)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${transitionsEnabled ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${transitionsEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                  </div>
                  <div>
                    <p className="text-sm">Transitions (crossfade)</p>
                    <p className="text-xs text-gray-500">Fondus enchaînés entre les segments</p>
                  </div>
                </label>
                {transitionsEnabled && (
                  <div className="ml-[52px] mt-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0.3"
                        max="1.5"
                        step="0.1"
                        value={transitionDuration}
                        onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
                        className="flex-1 accent-violet-600 h-1"
                      />
                      <span className="text-xs text-gray-400 font-mono w-10 text-right">{transitionDuration.toFixed(1)}s</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>Court</span>
                      <span>Long</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Music */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 mb-4">
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <Music size={16} className="text-violet-400" /> Musique de fond
              </h3>
              <div className="space-y-3">
                <select
                  value={selectedMusic}
                  onChange={(e) => setSelectedMusic(e.target.value)}
                  className="w-full bg-[#09090f] border border-[#2a2a3e] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-violet-600 transition-colors"
                >
                  <option value="">Pas de musique</option>
                  {musicTracks.map(t => (
                    <option key={t.filename} value={t.filename}>{t.name}</option>
                  ))}
                </select>

                {selectedMusic && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-500">Volume</label>
                      <span className="text-xs text-gray-400 font-mono">{Math.round(musicVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.05"
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                      className="w-full accent-violet-600 h-1"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>Subtil</span>
                      <span>Fort</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Logo */}
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 mb-6">
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <Film size={16} className="text-violet-400" /> Logo (optionnel)
              </h3>
              <input
                type="file"
                accept="image/*"
                onChange={e => { if (e.target.files?.[0]) { setLogoFile(e.target.files[0]); setLogoFilename(null); }}}
                className="text-sm text-gray-400 mb-3"
              />
              {logoFile && (
                <div className="mt-2">
                  <label className="block text-xs text-gray-500 mb-2">Position</label>
                  <select
                    value={logoPosition}
                    onChange={e => setLogoPosition(e.target.value)}
                    className="bg-[#09090f] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-600"
                  >
                    <option value="top-left">En haut à gauche</option>
                    <option value="top-right">En haut à droite</option>
                    <option value="bottom-left">En bas à gauche</option>
                    <option value="bottom-right">En bas à droite</option>
                    <option value="center">Centre</option>
                  </select>
                </div>
              )}
            </div>

            {/* Assembling state */}
            {isProcessing && (
              <div className="mb-4 text-center py-8">
                <Loader2 size={32} className="animate-spin text-violet-400 mx-auto mb-3" />
                <p className="text-sm text-gray-400">{project.progress_message}</p>
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(3)} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
                <ArrowLeft size={16} /> Révision
              </button>
              <button
                onClick={assembleVideo}
                disabled={formats.length === 0 || isProcessing}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Play size={16} />
                {project.status === "done" ? "Ré-exporter" : "Générer la vidéo"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
