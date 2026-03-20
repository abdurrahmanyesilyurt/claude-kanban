import { NextRequest, NextResponse } from "next/server";
import { rollbackDeploy, DEPLOY_CONFIGS } from "@/lib/deploy-service";

// POST: Belirtilen proje için en son yedeğe rollback yap
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectKey } = body;

    if (!projectKey) {
      return NextResponse.json(
        { ok: false, message: "projectKey gerekli" },
        { status: 400 }
      );
    }

    if (!DEPLOY_CONFIGS[projectKey]) {
      return NextResponse.json(
        {
          ok: false,
          message: `Bilinmeyen proje: ${projectKey}. Gecerli projeler: ${Object.keys(DEPLOY_CONFIGS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!DEPLOY_CONFIGS[projectKey].enabled) {
      return NextResponse.json(
        {
          ok: false,
          message: `${DEPLOY_CONFIGS[projectKey].name} deploy icin yapilandirilmamis`,
        },
        { status: 400 }
      );
    }

    const result = await rollbackDeploy(projectKey);

    // backup bulunamadıysa 404
    if (!result.success && result.message.toLowerCase().includes("bulunamadi")) {
      return NextResponse.json(
        { ok: false, message: result.message, details: result.backup_path },
        { status: 404 }
      );
    }

    // rollback başarısızsa 500
    if (!result.success) {
      return NextResponse.json(
        { ok: false, message: result.message, details: result.backup_path },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      details: result.backup_path,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: "Sunucu hatasi", details: String(e) },
      { status: 500 }
    );
  }
}
