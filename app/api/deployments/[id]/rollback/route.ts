import { NextRequest, NextResponse } from "next/server";
import {
  rollbackDeployment,
  getDeploymentHistory,
  DEPLOY_CONFIGS,
} from "@/lib/deploy-service";

/**
 * POST /api/deployments/:id/rollback
 *
 * :id → proje anahtarı (örn. "karbon", "nakliyekoop")
 *
 * Body (JSON):
 *   deploymentId? — rollback yapılacak spesifik deployment ID'si.
 *                   Belirtilmezse son başarılı deployment kullanılır.
 *
 * Auth:
 *   DEPLOY_API_KEY ortam değişkeni tanımlıysa,
 *   Authorization: Bearer <key> header'ı zorunludur.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ─── Auth Guard ─────────────────────────────────────────────────────
  const apiKey = process.env.DEPLOY_API_KEY;
  if (apiKey) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
      return NextResponse.json(
        { error: "Yetkisiz istek. Authorization: Bearer <DEPLOY_API_KEY> gerekli." },
        { status: 401 }
      );
    }
  }

  try {
    const { id: projectKey } = await params;

    // Proje var mı kontrol et
    if (!DEPLOY_CONFIGS[projectKey]) {
      return NextResponse.json(
        {
          error: `Bilinmeyen proje: ${projectKey}. Gecerli projeler: ${Object.keys(DEPLOY_CONFIGS).join(", ")}`,
        },
        { status: 404 }
      );
    }

    if (!DEPLOY_CONFIGS[projectKey].enabled) {
      return NextResponse.json(
        { error: `${DEPLOY_CONFIGS[projectKey].name} projesi deploy icin aktif degil` },
        { status: 400 }
      );
    }

    // Body'den deploymentId al (opsiyonel)
    let body: { deploymentId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // body yoksa sorun değil
    }

    let deploymentId = body.deploymentId;

    // deploymentId verilmemişse → projenin son başarılı deployment'ını bul
    if (!deploymentId) {
      const history = getDeploymentHistory(projectKey, 20);
      const lastSuccess = history.find((h) => h.status === "success");
      if (!lastSuccess) {
        return NextResponse.json(
          {
            error: `${projectKey} projesi icin rollback yapilabilecek basarili deployment yok`,
            hint: `GET /api/deployments/${projectKey}/history ile deployment gecmisini goruntuleyin`,
          },
          { status: 404 }
        );
      }
      deploymentId = lastSuccess.id;
    }

    // Rollback'i arka planda başlat (fire-and-forget)
    rollbackDeployment(deploymentId).catch((e) =>
      console.error(`[rollback:${projectKey}] Error:`, e)
    );

    return NextResponse.json({
      ok: true,
      message: `${DEPLOY_CONFIGS[projectKey].name} rollback baslatildi`,
      project_key: projectKey,
      deploymentId,
      hint: `GET /api/deployments/${projectKey}/history ile durumu takip edebilirsiniz`,
    });
  } catch (e) {
    console.error("[deployments/rollback] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
