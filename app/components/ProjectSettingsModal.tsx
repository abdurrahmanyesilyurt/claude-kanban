"use client";

import { useState } from "react";
import type { Project, ProjectType } from "@/lib/types";
import { AVAILABLE_TOOLS, PROJECT_TYPE_LABELS, PROJECT_TYPE_ICONS } from "@/lib/types";

interface ProjectSettingsModalProps {
  project: Project;
  allProjects: Project[];
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

export default function ProjectSettingsModal({
  project,
  allProjects,
  onClose,
  onUpdated,
}: ProjectSettingsModalProps) {
  const currentTools = new Set(project.allowed_tools?.split(",").filter(Boolean) ?? []);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(currentTools);
  const [maxTurns, setMaxTurns] = useState(project.max_turns ?? 30);
  const [projectType, setProjectType] = useState<ProjectType>(project.project_type as ProjectType || "backend");
  const [parentProjectId, setParentProjectId] = useState(project.parent_project_id || "");
  const [docOutputDir, setDocOutputDir] = useState(project.doc_output_dir || "");

  // Backend projeleri listesi (parent seçimi için)
  const backendProjects = allProjects.filter(p => p.id !== project.id && (p.project_type === "backend" || !p.project_type));
  // Bu projenin child'ları (frontend/mobile)
  const childProjects = allProjects.filter(p => p.parent_project_id === project.id);
  const [extraPaths, setExtraPaths] = useState<string[]>(() => {
    try { return JSON.parse(project.extra_paths || "[]"); } catch { return []; }
  });
  const [urls, setUrls] = useState<string[]>(() => {
    try { return JSON.parse(project.urls || "[]"); } catch { return []; }
  });
  const [newPath, setNewPath] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [docTemplate, setDocTemplate] = useState(project.doc_template || "");
  const [buildCommand, setBuildCommand] = useState(project.build_command || "");
  const [customInstructions, setCustomInstructions] = useState(project.custom_instructions || "");
  const [testCommand, setTestCommand] = useState(project.test_command || "");
  const [preTaskCommand, setPreTaskCommand] = useState(project.pre_task_command || "");
  const [loading, setLoading] = useState(false);

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const addPath = () => {
    if (newPath.trim()) {
      setExtraPaths((prev) => [...prev, newPath.trim()]);
      setNewPath("");
    }
  };

  const removePath = (idx: number) => {
    setExtraPaths((prev) => prev.filter((_, i) => i !== idx));
  };

  const addUrl = () => {
    if (newUrl.trim()) {
      setUrls((prev) => [...prev, newUrl.trim()]);
      setNewUrl("");
    }
  };

  const removeUrl = (idx: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          project_type: projectType,
          parent_project_id: parentProjectId,
          allowed_tools: Array.from(selectedTools).join(","),
          max_turns: maxTurns,
          extra_paths: JSON.stringify(extraPaths),
          urls: JSON.stringify(urls),
          doc_template: docTemplate,
          doc_output_dir: docOutputDir,
          build_command: buildCommand,
          custom_instructions: customInstructions,
          test_command: testCommand,
          pre_task_command: preTaskCommand,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdated(updated);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface border border-border rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Proje Ayarları</h2>
          <span className="text-xs text-muted">{project.name}</span>
        </div>

        {/* Primary Path (read-only display) */}
        <div>
          <label className="text-xs text-muted mb-1 block">Ana Dizin</label>
          <div className="text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-muted font-mono">
            {project.path}
          </div>
        </div>

        {/* Project Type & Relations */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted mb-3">Proje Tipi & İlişkiler</h3>

          <div className="flex gap-2 mb-3">
            {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setProjectType(type)}
                className={`flex-1 px-3 py-2 rounded-md border text-xs transition-colors text-center ${
                  projectType === type
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                    : "border-border bg-background text-muted hover:border-border-hover"
                }`}
              >
                <div className="text-base mb-0.5">{PROJECT_TYPE_ICONS[type]}</div>
                <div className="font-medium">{PROJECT_TYPE_LABELS[type]}</div>
              </button>
            ))}
          </div>

          {/* Parent Project (for frontend/mobile) */}
          {projectType !== "backend" && (
            <div className="mb-3">
              <label className="text-xs text-muted mb-1 block">Bağlı Backend Proje</label>
              <select
                value={parentProjectId}
                onChange={(e) => setParentProjectId(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover"
              >
                <option value="">Seçiniz...</option>
                {backendProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Child projects display (for backend) */}
          {projectType === "backend" && childProjects.length > 0 && (
            <div className="mb-3">
              <label className="text-xs text-muted mb-1.5 block">Bağlı Projeler</label>
              <div className="flex flex-wrap gap-1.5">
                {childProjects.map((p) => (
                  <span key={p.id} className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-background text-muted">
                    {PROJECT_TYPE_ICONS[p.project_type as ProjectType] || "🌐"} {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Doc Output Directory */}
          <div>
            <label className="text-xs text-muted mb-1 block">Doküman Çıktı Dizini</label>
            <p className="text-[10px] text-muted mb-1.5">
              Görev tamamlandığında üretilen dokümanların kaydedileceği klasör
            </p>
            <input
              value={docOutputDir}
              onChange={(e) => setDocOutputDir(e.target.value)}
              placeholder="Örn: C:/Users/HP/source/repos/Karbon/docs"
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
          </div>
        </div>

        {/* Custom Instructions */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Proje Talimatları
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent&apos;a projeye özel kurallar ve yönergeler. Her görevde otomatik uygulanır.
          </p>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder={`Örnek:\n- Türkçe yorum yaz\n- Repository pattern kullan\n- Her servis IService interface'i implemente etsin\n- Hata mesajlarını Türkçe yaz\n- async/await kullan, callback kullanma`}
            rows={5}
            className="w-full bg-background border border-border rounded-md px-2.5 py-2 text-xs outline-none focus:border-border-hover font-mono resize-y min-h-[80px]"
          />
          {customInstructions.trim() && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] text-emerald-400">Aktif</span>
              <button
                type="button"
                onClick={() => setCustomInstructions("")}
                className="text-[10px] text-muted hover:text-red-400 transition-colors"
              >
                Temizle
              </button>
            </div>
          )}
        </div>

        {/* Extra Paths */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Ek Dizinler
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent&apos;ın erişebileceği ek proje klasörleri (ör. frontend, backend ayrı dizinlerde ise)
          </p>
          {extraPaths.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <div className="flex-1 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 font-mono truncate">
                {p}
              </div>
              <button
                type="button"
                onClick={() => removePath(i)}
                className="text-red-400 hover:text-red-300 text-xs px-1.5 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              placeholder="C:/projects/frontend"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPath())}
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
            <button
              type="button"
              onClick={addPath}
              disabled={!newPath.trim()}
              className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-md transition-colors disabled:opacity-30"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* URLs */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Referans URL&apos;ler
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent&apos;ın WebFetch ile inceleyebileceği web sayfaları (ör. canlı uygulama, API docs)
          </p>
          {urls.map((u, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <div className="flex-1 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 font-mono truncate text-indigo-300">
                {u}
              </div>
              <button
                type="button"
                onClick={() => removeUrl(i)}
                className="text-red-400 hover:text-red-300 text-xs px-1.5 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              placeholder="https://example.com/dashboard"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrl())}
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
            <button
              type="button"
              onClick={addUrl}
              disabled={!newUrl.trim()}
              className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-md transition-colors disabled:opacity-30"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* Commands Section */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted mb-3">Komutlar</h3>

          {/* Pre-task Command */}
          <div className="mb-3">
            <label className="text-xs text-muted mb-1 block">
              Ön Komut (Görev Öncesi)
            </label>
            <p className="text-[10px] text-muted mb-1.5">
              Görev başlamadan önce çalışır: bağımlılık yükleme, güncel kodu çekme vb.
            </p>
            <input
              value={preTaskCommand}
              onChange={(e) => setPreTaskCommand(e.target.value)}
              placeholder="Örn: git pull && dotnet restore"
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
          </div>

          {/* Build Command */}
          <div className="mb-3">
            <label className="text-xs text-muted mb-1 block">
              Build Komutu
            </label>
            <p className="text-[10px] text-muted mb-1.5">
              Görev bittikten sonra çalışır. Hata alırsa agent düzeltip tekrar dener.
            </p>
            <input
              value={buildCommand}
              onChange={(e) => setBuildCommand(e.target.value)}
              placeholder="Örn: dotnet build, npm run build, tsc --noEmit"
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
          </div>

          {/* Test Command */}
          <div>
            <label className="text-xs text-muted mb-1 block">
              Test Komutu
            </label>
            <p className="text-[10px] text-muted mb-1.5">
              Build başarılı olduktan sonra çalışır. Test geçmeden görev tamamlanmaz.
            </p>
            <input
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
              placeholder="Örn: dotnet test, npm test, pytest"
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
          </div>

          {/* Active commands indicator */}
          {(preTaskCommand.trim() || buildCommand.trim() || testCommand.trim()) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {preTaskCommand.trim() && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Ön Komut
                </span>
              )}
              {buildCommand.trim() && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Build
                </span>
              )}
              {testCommand.trim() && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Test
                </span>
              )}
            </div>
          )}
        </div>

        {/* Document Template */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Döküman Şablonu
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent döküman üretirken bu formata uyar. Boş bırakılırsa agent kendi formatını kullanır.
          </p>
          <textarea
            value={docTemplate}
            onChange={(e) => setDocTemplate(e.target.value)}
            placeholder={`Örnek:\n# [Başlık]\n\n## Özet\nKısa açıklama...\n\n## API Değişiklikleri\n### Endpoint\n- Method: POST/GET/...\n- URL: /api/...\n- Request Body: ...\n- Response: ...\n\n## Frontend Senaryoları\n1. ...\n2. ...\n\n## Kullanım Notları\n...`}
            rows={8}
            className="w-full bg-background border border-border rounded-md px-2.5 py-2 text-xs outline-none focus:border-border-hover font-mono resize-y min-h-[100px]"
          />
          {docTemplate.trim() && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] text-emerald-400">Aktif</span>
              <button
                type="button"
                onClick={() => setDocTemplate("")}
                className="text-[10px] text-muted hover:text-red-400 transition-colors"
              >
                Temizle
              </button>
            </div>
          )}
        </div>

        {/* Allowed Tools */}
        <div>
          <label className="text-xs text-muted mb-2 block">
            İzin Verilen Tool&apos;lar
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {AVAILABLE_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => toggleTool(tool.id)}
                className={`text-left px-2.5 py-1.5 rounded-md border text-xs transition-colors ${
                  selectedTools.has(tool.id)
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                    : "border-border bg-background text-muted hover:border-border-hover"
                }`}
              >
                <div className="font-medium">{tool.label}</div>
                <div className="text-[10px] opacity-60">{tool.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Max Turns */}
        <div>
          <label className="text-xs text-muted mb-1 block">
            Maks. Tur Sayısı
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={100}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm font-mono w-8 text-right">{maxTurns}</span>
          </div>
          <p className="text-[10px] text-muted mt-0.5">
            Agent&apos;ın kaç adım atabileceğini belirler
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
