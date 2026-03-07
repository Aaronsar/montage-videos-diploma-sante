"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft, Upload, FileVideo, Sparkles, CheckCircle, AlertCircle,
  Loader2, Play, Trash2, Download, RefreshCw, ChevronRight, Film,
  Clock, Sliders, LayoutTemplate
} from "lucide-react";

const API = "https://montage-videos-diploma-sante-production.up.railway.app";

// ─── Types ───────────────────────────────────────────────────────────────────
interface TranscriptSegment { start: number; end: number; text: string; }
interface Rush {
  id: string; filename: string; original_filename: string;
  duration: number | null; file_size: number | null;
  status: string; transcript: TranscriptSegment[] | null;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
               : `${m}:${String(sec).padStart(2,"0")}`;
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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [formats, setFormats] = useState<string[]>(["16:9"]);
  const [addSubtitles, setAddSubtitles] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoFilename, setLogoFilename] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

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

      // Auto-advance step based on status
      const s = data.status;
      if (s === "created") setStep(0);
      else if (["uploading","transcribing","transcribed"].includes(s)) setStep(1);
      else if (s === "analyzing") setStep(2);
      else if (s === "review") setStep(3);
      else if (["assembling","done"].includes(s)) setStep(4);
    } catch {}
  }, [id, brief]);

  useEffect(() => {
    fetchProject();
    pollingRef.current = setInterval(fetchProject, 2500);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchProject]);

  // ── Upload videos ──
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadSpeed("");

    const totalSize = acceptedFiles.reduce((s, f) => s + f.size, 0);
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      acceptedFiles.forEach(f => formData.append("files", f));

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(pct);

        const elapsed = (Date.now() - startTime) / 1000;
        const bytesPerSec = e.loaded / elapsed;
        const remaining = (e.total - e.loaded) / bytesPerSec;

        const fmtSpd = bytesPerSec > 1024 * 1024
          ? `${(bytesPerSec / 1024 / 1024).toFixed(1)} Mo/s`
          : `${(bytesPerSec / 1024).toFixed(0)} Ko/s`;
        const fmtTime = remaining < 60
          ? `${Math.ceil(remaining)}s restantes`
          : `${Math.ceil(remaining / 60)}min restantes`;

        setUploadSpeed(`${fmtSpd} · ${fmtTime}`);
      };

      xhr.onloadend = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          console.error("Upload failed:", xhr.status, xhr.responseText);
        }
        resolve();
      };
      xhr.onerror = () => { console.error("Upload network error"); resolve(); };
      xhr.open("POST", `${API}/api/upload/${id}/videos`);
      xhr.send(formData);
    });

    await fetchProject();
    setUploading(false);
    setUploadProgress(0);
    setUploadSpeed("");
  }, [id, fetchProject]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm"] },
    multiple: true,
  });

  // ── Actions ──
  const startTranscription = async () => {
    await fetch(`${API}/api/process/${id}/transcribe`, { method: "POST" });
    fetchProject();
  };

  const saveBriefAndAnalyze = async () => {
    await fetch(`${API}/api/projects/${id}/brief`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    await fetch(`${API}/api/process/${id}/analyze`, { method: "POST" });
    fetchProject();
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
    };
    if (resolvedLogo) {
      body.logo_filename = resolvedLogo;
      body.logo_position = logoPosition;
      body.logo_opacity = 0.85;
      body.logo_size_percent = 15;
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

  if (!project) {
    return (
      <div className="min-h-screen bg-[#09090f] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-violet-500" />
      </div>
    );
  }

  const isProcessing = ["transcribing", "analyzing", "assembling", "uploading"].includes(project.status);

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
              <p className="text-gray-500 text-sm">Glissez vos fichiers vidéo bruts ici</p>
            </div>

            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all mb-6 ${
                isDragActive
                  ? "border-violet-500 bg-violet-500/10"
                  : "border-[#1e1e2e] hover:border-violet-600/50 hover:bg-[#111118]"
              }`}
            >
              <input {...getInputProps()} />
              <div className="w-14 h-14 bg-[#1e1e2e] rounded-2xl flex items-center justify-center mx-auto mb-4">
                {uploading ? (
                  <Loader2 size={24} className="animate-spin text-violet-400" />
                ) : (
                  <Upload size={24} className="text-violet-400" />
                )}
              </div>
              <p className="font-medium mb-1">
                {uploading ? `Upload en cours... ${uploadProgress}%` : isDragActive ? "Relâchez ici..." : "Glisser-déposer vos vidéos"}
              </p>
              {uploading ? (
                <div className="mt-3 w-full max-w-xs mx-auto">
                  <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  {uploadSpeed && <p className="text-xs text-gray-400">{uploadSpeed}</p>}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">MP4, MOV, AVI, MKV — Taille illimitée</p>
              )}
            </div>

            {/* Rush list */}
            {project.rushes.length > 0 && (
              <div className="space-y-2">
                {project.rushes.map((rush) => (
                  <div key={rush.id} className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 flex items-center gap-4">
                    <div className="w-9 h-9 bg-[#1e1e2e] rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileVideo size={16} className="text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{rush.original_filename}</p>
                      <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                        {rush.duration && <span><Clock size={10} className="inline mr-1" />{fmt(rush.duration)}</span>}
                        {rush.file_size && <span>{fmtSize(rush.file_size)}</span>}
                        <span className={rush.status === "transcribed" ? "text-green-400" : "text-gray-500"}>
                          {rush.status === "transcribed" ? "Transcrit ✓" : rush.status}
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
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 mb-6">
              <div className="flex items-center gap-3">
                {isProcessing ? (
                  <Loader2 size={16} className="animate-spin text-violet-400" />
                ) : (
                  <CheckCircle size={16} className="text-green-400" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {isProcessing ? "Transcription en cours..." : "Transcription terminée"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {project.rushes.filter(r => r.status === "transcribed").length}/{project.rushes.length} rush(es) transcrits
                  </p>
                </div>
              </div>
            </div>

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
                <li>• Précisez la durée souhaitée (30s, 60s, 2min...)</li>
                <li>• Décrivez le ton (dynamique, inspirant, informatif...)</li>
                <li>• Mentionnez les points clés à inclure</li>
                <li>• Précisez l'audience cible</li>
              </ul>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(0)}
                className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft size={16} /> Retour
              </button>
              <button
                onClick={saveBriefAndAnalyze}
                disabled={!brief.trim() || isProcessing || project.status === "transcribing"}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
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

        {/* ── STEP 3: Review segments ── */}
        {step === 3 && (
          <div>
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold mb-1">Révision des segments</h2>
                <p className="text-gray-500 text-sm">{project.segments.length} segment(s) sélectionné(s) par l'IA</p>
              </div>
              <button
                onClick={saveBriefAndAnalyze}
                disabled={isProcessing}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-[#1e1e2e] hover:border-[#333] px-3 py-2 rounded-lg transition-colors"
              >
                <RefreshCw size={14} /> Ré-analyser
              </button>
            </div>

            {project.segments.length === 0 ? (
              <div className="text-center py-16 text-gray-500">Aucun segment sélectionné</div>
            ) : (
              <div className="space-y-2 mb-6">
                {[...project.segments].sort((a, b) => a.order - b.order).map((seg, i) => {
                  const rush = project.rushes.find(r => r.id === seg.rush_id);
                  return (
                    <div key={seg.id} className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-6 h-6 bg-violet-600/20 rounded-md flex items-center justify-center text-violet-400 text-xs font-bold">
                          {i + 1}
                        </div>
                        <span className="text-xs text-gray-400 font-medium">
                          {rush?.original_filename || rush?.filename}
                        </span>
                        <span className="ml-auto text-xs text-violet-400 font-mono">
                          {fmt(seg.start)} → {fmt(seg.end)}
                          <span className="text-gray-600 ml-2">({fmt(seg.end - seg.start)})</span>
                        </span>
                      </div>
                      {seg.transcript && (
                        <p className="text-sm text-gray-400 pl-9 leading-relaxed">"{seg.transcript}"</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
                <ArrowLeft size={16} /> Modifier le brief
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={project.segments.length === 0}
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
                      href={out.url}
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
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setAddSubtitles(p => !p)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${addSubtitles ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${addSubtitles ? "translate-x-5" : "translate-x-0.5"}`} />
                </div>
                <div>
                  <p className="text-sm">Sous-titres automatiques</p>
                  <p className="text-xs text-gray-500">Générés depuis la transcription Whisper</p>
                </div>
              </label>
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
