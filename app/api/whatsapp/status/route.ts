import { NextResponse } from "next/server";
import { getStatus, initialize } from "@/lib/whatsapp-service";

// GET: Get WhatsApp connection status (connected, QR, initializing)
export async function GET() {
  const status = getStatus();

  // Auto-initialize if not connected and not initializing
  if (!status.connected && !status.initializing) {
    initialize().catch((e) =>
      console.error("[WhatsApp] Init error:", e)
    );
    return NextResponse.json({ ...getStatus(), message: "Initializing..." });
  }

  return NextResponse.json(status);
}
