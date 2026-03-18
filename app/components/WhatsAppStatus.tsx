"use client";

import { useState, useEffect } from "react";

interface WAStatus {
  connected: boolean;
  qr: string | null;
  initializing: boolean;
  message?: string;
  needsAuth?: boolean;
}

export default function WhatsAppStatus({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<WAStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 3 seconds while not connected (waiting for QR scan)
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Stop polling once connected
  useEffect(() => {
    if (status?.connected) {
      // Connected — no need to keep polling aggressively
    }
  }, [status?.connected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span>&#128172;</span> WhatsApp Baglantisi
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-sm"
          >
            &times;
          </button>
        </div>

        {loading && (
          <div className="text-center py-8">
            <div className="text-muted text-xs">Durum kontrol ediliyor...</div>
          </div>
        )}

        {!loading && status?.connected && (
          <div className="text-center py-6 space-y-2">
            <div className="text-3xl">&#9989;</div>
            <div className="text-sm text-emerald-400 font-medium">Bagli</div>
            <p className="text-[10px] text-muted">
              WhatsApp baglantisi aktif. Gorev kartlarindan mesaj gonderebilirsiniz.
            </p>
          </div>
        )}

        {!loading && status?.initializing && !status.qr && (
          <div className="text-center py-8 space-y-2">
            <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="text-xs text-muted">WhatsApp baslatiliyor...</div>
          </div>
        )}

        {!loading && status?.qr && (
          <div className="space-y-3">
            <p className="text-xs text-muted text-center">
              Telefonunuzdan QR kodu tarayin:
            </p>
            <div className="flex justify-center">
              <img
                src={status.qr}
                alt="WhatsApp QR"
                className="w-56 h-56 rounded-lg"
              />
            </div>
            <p className="text-[10px] text-muted text-center">
              WhatsApp &gt; Ayarlar &gt; Bagli Cihazlar &gt; Cihaz Bagla
            </p>
          </div>
        )}

        {!loading && !status?.connected && !status?.initializing && !status?.qr && (
          <div className="text-center py-6 space-y-3">
            <div className="text-3xl">&#128274;</div>
            <div className="text-xs text-muted">WhatsApp bagli degil</div>
            <button
              onClick={() => {
                setLoading(true);
                fetchStatus();
              }}
              className="text-xs px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
            >
              Baglantiya Basla
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
