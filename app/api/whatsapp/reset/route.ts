import { NextResponse } from "next/server";
import { destroy, initialize } from "@/lib/whatsapp-service";

// POST: Reset WhatsApp client and re-initialize
export async function POST() {
  try {
    await destroy();
    // Small delay before re-init
    await new Promise((r) => setTimeout(r, 1000));
    initialize().catch((e) => console.error("[WhatsApp] Re-init error:", e));
    return NextResponse.json({ ok: true, message: "Resetting..." });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
