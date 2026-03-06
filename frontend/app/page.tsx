"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Film, Clock, CheckCircle, AlertCircle, Loader2, Trash2 } from "lucide-react";

const API = "https://montage-videos-diploma-sante-production.up.railway.app";

interface Project {
  id: string;
  name: string;
  status: string;
  rushes: { id: string }[];
  segments: { id: string }[];
  outputs: { format: string; url: string }[];
  created_at: string;
  progress: number;
  progress_message: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  created: { label: "Créé", color: "text-gray-400", icon: Film },
  uploading: { label: "Upload...", color: "text-blue-400", icon: Loader2 },
  transcribing: { label: "Transcription...", color: "text-yellow-400", icon: Loader2 },
  transcribed: { label: "Transcrit", color: "text-blue-400", icon: CheckCircle },
  analyzing: { label: "Analyse IA...", color: "text-purple-400", icon: Loader2 },
  review: { label: "À valider", color: "text-orange-400", icon: Clock },
  assembling: { label: "Assemblage...", color: "text-blue-400", icon: Loader2 },
  done: { label: "Prêt", color: "text-green-400", icon: CheckCircle },
  error: { label: "Erreur", color: "text-red-400", icon: AlertCircle },
};

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API}/api/projects/`);
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 3000);
    return () => clearInterval(interval);
  }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/projects/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Supprimer ce projet ?")) return;
    await fetch(`${API}/api/projects/${id}`, { method: "DELETE" });
    fetchProjects();
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric", month: "short", year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-[#09090f]">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] px-8 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <Film size={16} className="text-white" />
            </div>
            <span className="font-semibold text-lg">VideoAI</span>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Nouveau projet
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10">
        {/* New project form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold mb-4">Nouveau projet</h2>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProject()}
                placeholder="Nom du projet (ex: Pub Nike Janvier)"
                className="w-full bg-[#09090f] border border-[#1e1e2e] rounded-lg px-4 py-3 text-sm outline-none focus:border-violet-600 transition-colors mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowForm(false); setNewName(""); }}
                  className="flex-1 bg-[#1e1e2e] hover:bg-[#2a2a3e] text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={createProject}
                  disabled={creating || !newName.trim()}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {creating ? "Création..." : "Créer"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Projects grid */}
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={32} className="animate-spin text-violet-500" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-32">
            <div className="w-16 h-16 bg-[#111118] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#1e1e2e]">
              <Film size={28} className="text-gray-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Aucun projet</h2>
            <p className="text-gray-500 mb-6 text-sm">Créez votre premier projet pour commencer</p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              Créer un projet
            </button>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold mb-6">Mes projets</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => {
                const cfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.created;
                const StatusIcon = cfg.icon;
                const isLoading = ["transcribing", "analyzing", "assembling", "uploading"].includes(project.status);

                return (
                  <div
                    key={project.id}
                    onClick={() => router.push(`/projects/${project.id}`)}
                    className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 cursor-pointer hover:border-violet-600/50 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-[#1e1e2e] rounded-lg flex items-center justify-center flex-shrink-0">
                        <Film size={18} className="text-violet-400" />
                      </div>
                      <button
                        onClick={(e) => deleteProject(project.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <h3 className="font-semibold mb-1 truncate">{project.name}</h3>
                    <p className="text-xs text-gray-500 mb-3">{formatDate(project.created_at)}</p>

                    {/* Stats */}
                    <div className="flex gap-3 text-xs text-gray-500 mb-3">
                      <span>{project.rushes?.length || 0} rush{(project.rushes?.length || 0) > 1 ? "es" : ""}</span>
                      <span>·</span>
                      <span>{project.segments?.length || 0} segment{(project.segments?.length || 0) > 1 ? "s" : ""}</span>
                      {project.outputs?.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{project.outputs.length} format{project.outputs.length > 1 ? "s" : ""}</span>
                        </>
                      )}
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <StatusIcon
                        size={13}
                        className={`${cfg.color} ${isLoading ? "animate-spin" : ""}`}
                      />
                      <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    </div>

                    {/* Progress bar for active processing */}
                    {isLoading && project.progress > 0 && (
                      <div className="mt-2">
                        <div className="h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-600 rounded-full transition-all duration-500"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        {project.progress_message && (
                          <p className="text-xs text-gray-500 mt-1">{project.progress_message}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
