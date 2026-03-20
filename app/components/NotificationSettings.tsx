"use client";

import { useState, useRef, useEffect } from "react";
import { useNotifications } from "../hooks/useNotifications";
import { useSound } from "../hooks/useSound";

/**
 * NotificationSettings — Compact toolbar component.
 *
 * Designed to be dropped inline in any navbar / toolbar.
 * Clicking the bell icon opens a small popover with:
 *   - Notification permission status + request button
 *   - Sound mute / unmute toggle
 *
 * Usage:
 *   import NotificationSettings from "@/app/components/NotificationSettings";
 *   <NotificationSettings />
 */
export default function NotificationSettings() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { permission, isSupported: notifSupported, requestPermission } = useNotifications();
  const { isMuted, toggleMute, playSuccess, playError } = useSound();

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  /* ── Permission badge ─────────────────────────────────── */
  const permissionBadge = (): { label: string; className: string } => {
    if (!notifSupported) return { label: "Desteklenmiyor", className: "text-muted" };
    switch (permission) {
      case "granted":
        return { label: "Açık", className: "text-emerald-400" };
      case "denied":
        return { label: "Engellendi", className: "text-red-400" };
      default:
        return { label: "İzin Verilmedi", className: "text-amber-400" };
    }
  };

  /* ── Bell icon — shows a dot when notifications are denied / default ── */
  const bellIcon = () => {
    const hasDot = notifSupported && permission !== "granted";
    return (
      <span className="relative inline-flex">
        🔔
        {hasDot && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-background" />
        )}
      </span>
    );
  };

  const { label: permLabel, className: permClass } = permissionBadge();

  return (
    <div className="relative">
      {/* Trigger button — matches existing toolbar button style */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1.5 text-sm border border-border hover:border-border-hover rounded-md transition-colors text-muted hover:text-foreground"
        title="Bildirim &amp; Ses Ayarları"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {bellIcon()}
      </button>

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Bildirim ve ses ayarları"
          className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-border bg-surface shadow-xl"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Bildirim &amp; Ses</p>
          </div>

          <div className="px-4 py-3 space-y-4">
            {/* ── Notification permission ──────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted">Masaüstü Bildirimleri</span>
                <span className={`text-xs font-semibold ${permClass}`}>{permLabel}</span>
              </div>

              {notifSupported ? (
                permission === "denied" ? (
                  <p className="text-xs text-muted/70 leading-relaxed">
                    Tarayıcı ayarlarından bu site için bildirimlere izin ver.
                  </p>
                ) : permission === "granted" ? (
                  <p className="text-xs text-emerald-400/80">
                    Bildirimler aktif. Workflow tamamlandığında haberdar olacaksın.
                  </p>
                ) : (
                  <button
                    onClick={async () => {
                      await requestPermission();
                    }}
                    className="w-full mt-1 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors text-white font-medium"
                  >
                    İzin İste
                  </button>
                )
              ) : (
                <p className="text-xs text-muted/70">
                  Bu tarayıcı bildirim API&apos;sini desteklemiyor.
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border" />

            {/* ── Sound toggle ─────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted">Ses Efektleri</p>
                  <p className="text-xs text-muted/60 mt-0.5">
                    {isMuted ? "Ses kapalı" : "Ses açık"}
                  </p>
                </div>

                {/* Toggle switch */}
                <button
                  onClick={toggleMute}
                  role="switch"
                  aria-checked={!isMuted}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none ${
                    isMuted
                      ? "bg-surface border-border"
                      : "bg-indigo-600 border-indigo-600"
                  }`}
                  title={isMuted ? "Sesi Aç" : "Sesi Kapat"}
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform duration-200 mt-px ${
                      isMuted ? "translate-x-0.5" : "translate-x-3.5"
                    }`}
                  />
                </button>
              </div>

              {/* Preview buttons */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    if (isMuted) return;
                    playSuccess();
                  }}
                  disabled={isMuted}
                  className="flex-1 px-2 py-1 text-xs border border-emerald-600/30 hover:border-emerald-500/50 rounded-md transition-colors text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Başarı sesi önizleme"
                >
                  ✓ Başarı
                </button>
                <button
                  onClick={() => {
                    if (isMuted) return;
                    playError();
                  }}
                  disabled={isMuted}
                  className="flex-1 px-2 py-1 text-xs border border-red-600/30 hover:border-red-500/50 rounded-md transition-colors text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Hata sesi önizleme"
                >
                  ✕ Hata
                </button>
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-border rounded-b-lg">
            <p className="text-[10px] text-muted/50 text-center">
              Ayarlar tarayıcıda saklanır
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
