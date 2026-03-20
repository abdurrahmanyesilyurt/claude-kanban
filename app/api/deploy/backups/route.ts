import { NextRequest, NextResponse } from "next/server";
import { listBackups, DEPLOY_CONFIGS } from "@/lib/deploy-service";

// GET: ?projectKey=X — Sunucudaki backup listesini döndür
export async function GET(req: NextRequest) {
  try {
    const projectKey = req.nextUrl.searchParams.get("projectKey");

    if (!projectKey) {
      return NextResponse.json(
        { error: "projectKey query parametresi gerekli" },
        { status: 400 }
      );
    }

    if (!DEPLOY_CONFIGS[projectKey]) {
      return NextResponse.json(
        {
          error: `Bilinmeyen proje: ${projectKey}. Gecerli projeler: ${Object.keys(DEPLOY_CONFIGS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const result = await listBackups(projectKey);

    // backup_dir tanımsız ya da başka bir yapısal hata
    if (!result.success) {
      // Hiç backup yoksa 404
      if (result.error?.includes("tanimlanmamis") || result.error?.includes("bulunamadi")) {
        return NextResponse.json(
          { error: result.error || "Backup bulunamadi" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: result.error || "Backup listesi alinamadi" },
        { status: 500 }
      );
    }

    // Backup yoksa 404
    if (result.backups.length === 0) {
      return NextResponse.json(
        { error: `${DEPLOY_CONFIGS[projectKey].name} icin backup bulunamadi` },
        { status: 404 }
      );
    }

    // Dizin adından timestamp'i çıkar: /var/backups/karbon/2024-01-15T12-30-00 → unix ms
    const backups = result.backups.map((fullPath) => {
      const dirName = fullPath.split("/").pop() ?? "";
      // Format: 2024-01-15T12-30-00 → 2024-01-15T12:30:00
      const isoLike = dirName.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
      const ts = Date.parse(isoLike);
      return {
        timestamp: isNaN(ts) ? 0 : ts,
        path: fullPath,
        size: 0, // Dizin boyutu SSH ile ayrıca sorgulanabilir; şimdilik 0
      };
    });

    // En yeniden eskiye sırala
    backups.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json(backups);
  } catch (e) {
    return NextResponse.json(
      { error: `Sunucu hatasi: ${String(e)}` },
      { status: 500 }
    );
  }
}
