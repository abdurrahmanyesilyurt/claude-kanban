import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { spawn } from "child_process";
import type { Project } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { projectId } = await req.json();

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const prompt = `Bu projeyi analiz et ve kök dizine bir CLAUDE.md dosyası oluştur. CLAUDE.md dosyası şunları içermeli:

1. **Proje Özeti**: Projenin ne yaptığını kısa açıkla
2. **Tech Stack**: Kullanılan diller, framework'ler, kütüphaneler
3. **Proje Yapısı**: Önemli dizin ve dosyaların açıklaması
4. **Geliştirme Komutları**: dev server, build, test, lint komutları
5. **Kodlama Kuralları**: Projede kullanılan pattern'ler, naming convention'lar, stil kuralları
6. **Dikkat Edilmesi Gerekenler**: Önemli konfigürasyonlar, environment variable'lar, bilinen kısıtlamalar
7. **Veritabanı / API**: Varsa veritabanı şeması, API endpoint'leri

Dosyayı Türkçe yaz. Sadece CLAUDE.md dosyasını oluştur, başka bir şey yapma.`;

  try {
    const result = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(
        "npx",
        ["claude", "-p", prompt, "--output-format", "text"],
        {
          cwd: project.path,
          shell: true,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      });

      child.on("error", reject);
    });

    return NextResponse.json({ ok: true, output: result.slice(0, 2000) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
