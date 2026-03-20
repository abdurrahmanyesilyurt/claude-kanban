import { NextRequest, NextResponse } from "next/server";
import { getDeploymentHistory, getDeploymentById } from "@/lib/deploy-service";
import { DEPLOY_CONFIGS } from "@/lib/deploy-service";

/**
 * GET /api/deployments/:id/history
 *
 * :id → proje anahtarı (örn. "karbon", "nakliyekoop")
 * Query params:
 *   limit  — kaç kayıt dönsün (default: 20, max: 100)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectKey } = await params;
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10),
      100
    );

    // Proje var mı kontrol et
    if (!DEPLOY_CONFIGS[projectKey]) {
      return NextResponse.json(
        {
          error: `Bilinmeyen proje: ${projectKey}. Gecerli projeler: ${Object.keys(DEPLOY_CONFIGS).join(", ")}`,
        },
        { status: 404 }
      );
    }

    const history = getDeploymentHistory(projectKey, limit);

    return NextResponse.json({
      project_key: projectKey,
      project_name: DEPLOY_CONFIGS[projectKey].name,
      total: history.length,
      history: history.map((entry) => ({
        id: entry.id,
        status: entry.status,
        deploy_type: entry.deploy_type,
        commit_hash: entry.commit_hash,
        backup_path: entry.backup_path,
        triggered_by: entry.triggered_by,
        rollback_of: entry.rollback_of || null,
        started_at: entry.started_at,
        finished_at: entry.finished_at,
        duration_ms: entry.duration_ms,
        // logs alanı büyük olabilir, isteğe bağlı döndür
        logs: req.nextUrl.searchParams.get("include_logs") === "true"
          ? JSON.parse(entry.logs || "[]")
          : undefined,
        rollback_available: !!entry.backup_path,
      })),
    });
  } catch (e) {
    console.error("[deployments/history] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
