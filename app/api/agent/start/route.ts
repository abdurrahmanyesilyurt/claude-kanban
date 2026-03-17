import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runAgent } from "@/lib/claude-agent";
import type { Task, Project } from "@/lib/db";

const BROWSER_INSTRUCTIONS = `
--- Tarayıcı Aracı (Browser Tool) ---
Web sayfalarını açıp incelemek, tıklamak, form doldurmak için Bash üzerinden browser-cli komutlarını kullanabilirsin.
Bu komutlar gerçek bir Chromium tarayıcı kontrol eder (Playwright).

Kullanım (Bash ile):
  node scripts/browser-cli.mjs open <url>           — Sayfayı aç (otomatik screenshot alır)
  node scripts/browser-cli.mjs screenshot            — Mevcut sayfanın screenshot'ını al
  node scripts/browser-cli.mjs get-elements          — Sayfadaki tıklanabilir/doldurulabilir elementleri listele
  node scripts/browser-cli.mjs click "<selector>"    — Elemente tıkla (otomatik screenshot alır)
  node scripts/browser-cli.mjs fill "<selector>" <değer> — Input'u doldur
  node scripts/browser-cli.mjs navigate <url>        — Başka sayfaya git
  node scripts/browser-cli.mjs get-text [<selector>] — Sayfa veya element metnini al
  node scripts/browser-cli.mjs get-page-info         — Sayfa başlığı ve URL'ini al
  node scripts/browser-cli.mjs evaluate "<js kodu>"  — Sayfada JavaScript çalıştır
  node scripts/browser-cli.mjs select-option "<selector>" "<value>" — Dropdown seç
  node scripts/browser-cli.mjs wait-for "<selector>" — Elementin yüklenmesini bekle
  node scripts/browser-cli.mjs close                 — Tarayıcıyı kapat

İpuçları:
- Sayfayı açtıktan sonra get-elements ile interaktif elementleri keşfet
- Selector'ler CSS selector formatında olmalı (ör: "#login-btn", "input[name='email']", ".submit-button")
- Her click ve fill sonrası otomatik screenshot alınır
- Oturum açıldığında session ID otomatik kaydedilir, her komutta tekrar belirtmeye gerek yok
- İşin bittiğinde close komutuyla tarayıcıyı kapat
`;

function buildPrompt(task: Task, project: Project): string {
  const parts: string[] = [];

  // Custom instructions — project-level rules (coding style, conventions, etc.)
  if (project.custom_instructions?.trim()) {
    parts.push(
      `--- Proje Talimatları ---\nBu projeye özel kurallar — tüm görevlerde bunlara uy:\n\n${project.custom_instructions}`
    );
  }

  // Pre-task command info
  if (project.pre_task_command?.trim()) {
    parts.push(
      `--- Ön Komut ---\nGöreve başlamadan ÖNCE aşağıdaki komutu çalıştır:\n\n${project.pre_task_command}\n\nBu komut projeyi güncel tutmak içindir (ör. bağımlılıkları yüklemek, son değişiklikleri çekmek).`
    );
  }

  parts.push(task.title);
  if (task.description) {
    parts.push(task.description);
  }

  // Extra paths context
  const extraPaths: string[] = JSON.parse(project.extra_paths || "[]");
  if (extraPaths.length > 0) {
    parts.push(
      `\n--- Ek Proje Dizinleri ---\nBu task ile ilgili ek dizinler (gerektiğinde bu dizinlerdeki dosyaları da oku/düzenle):\n${extraPaths.map((p) => `- ${p}`).join("\n")}`
    );
  }

  // URLs context
  const urls: string[] = JSON.parse(project.urls || "[]");
  if (urls.length > 0) {
    parts.push(
      `\n--- Referans URL'ler ---\nBu task ile ilgili referans web sayfaları (gerektiğinde WebFetch ile incele):\n${urls.map((u) => `- ${u}`).join("\n")}`
    );
  }

  // Document template — instruct agent on documentation behavior
  if (project.doc_template?.trim()) {
    parts.push(
      `\n--- Döküman Kuralları ---
Yaptığın işin sonucunda frontend tarafının yapması gereken bir değişiklik varsa, projenin docs/ klasörüne bir Markdown (.md) döküman dosyası oluştur.
Eğer yaptığın değişiklik tamamen backend'de kalıyorsa ve frontend'in yapacağı bir şey yoksa döküman OLUŞTURMA.

Döküman oluştururken AŞAĞIDAKİ şablonu kullan:

${project.doc_template}`
    );
  }

  // Build/verify + test commands — agent MUST run these after completing work
  const verifyCommands: string[] = [];
  if (project.build_command?.trim()) verifyCommands.push(project.build_command);
  if (project.test_command?.trim()) verifyCommands.push(project.test_command);

  if (verifyCommands.length > 0) {
    parts.push(
      `\n--- Doğrulama Komutları (ZORUNLU) ---
İşini bitirdikten sonra aşağıdaki komutları SIRASIYLA çalıştır:

${verifyCommands.map((cmd, i) => `${i + 1}. ${cmd}`).join("\n")}

Herhangi biri başarısız olursa (hata verirse), hataları düzelt ve tekrar çalıştır.
TÜM komutlar başarılı olana kadar görevi TAMAMLANMIŞ sayma.
Build/test hatası bırakarak görevi bitirme — bu kabul edilemez.`
    );
  }

  // Browser tool instructions — always included so agent knows it can use the browser
  parts.push(BROWSER_INSTRUCTIONS);

  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId } = body;

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as Project | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const prompt = buildPrompt(task, project);

  // Fire and forget — client will follow progress via SSE
  runAgent(taskId, prompt, project.path, {
    allowedTools: project.allowed_tools?.split(",").filter(Boolean) ?? [],
    maxTurns: project.max_turns ?? 30,
  });

  return NextResponse.json({ ok: true, taskId });
}
