"use client";

import { useState, useRef } from "react";

interface BrowserSession {
  id: string;
  url: string;
  title: string;
}

export default function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [elements, setElements] = useState<Array<{ tag: string; text?: string; selector: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const log = (msg: string) => {
    setActionLog((prev) => [...prev, `[${new Date().toLocaleTimeString("tr-TR")}] ${msg}`]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  };

  const api = async (body: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    if (!urlInput.trim()) return;
    try {
      const { sessionId } = await api({ action: "create", url: urlInput.trim() });
      const info = await api({ action: "getPageInfo", sessionId });
      const session: BrowserSession = { id: sessionId, url: info.url, title: info.title };
      setSessions((prev) => [...prev, session]);
      setActiveSession(sessionId);
      log(`Sayfa açıldı: ${info.title}`);
      await handleScreenshot(sessionId);
    } catch (err) {
      log(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleScreenshot = async (sid?: string) => {
    const sessionId = sid || activeSession;
    if (!sessionId) return;
    try {
      const { url } = await api({ action: "screenshot", sessionId });
      setScreenshotUrl(url + "?t=" + Date.now());
      log("Screenshot alındı");
    } catch (err) {
      log(`Screenshot hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleGetElements = async () => {
    if (!activeSession) return;
    try {
      const { elements: els } = await api({ action: "getElements", sessionId: activeSession });
      setElements(els);
      log(`${els.length} interaktif element bulundu`);
    } catch (err) {
      log(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClick = async (selector: string) => {
    if (!activeSession) return;
    try {
      await api({ action: "click", sessionId: activeSession, selector });
      log(`Tıklandı: ${selector}`);
      await new Promise((r) => setTimeout(r, 500));
      await handleScreenshot();
      const info = await api({ action: "getPageInfo", sessionId: activeSession });
      setSessions((prev) => prev.map((s) => s.id === activeSession ? { ...s, url: info.url, title: info.title } : s));
    } catch (err) {
      log(`Tıklama hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleNavigate = async (url: string) => {
    if (!activeSession) return;
    try {
      const info = await api({ action: "navigate", sessionId: activeSession, url });
      setSessions((prev) => prev.map((s) => s.id === activeSession ? { ...s, url: info.url, title: info.title } : s));
      log(`Navigasyon: ${info.title}`);
      await handleScreenshot();
    } catch (err) {
      log(`Navigasyon hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClose = async (sessionId: string) => {
    try {
      await api({ action: "close", sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession === sessionId) {
        setActiveSession(sessions.length > 1 ? sessions.find((s) => s.id !== sessionId)?.id || null : null);
        setScreenshotUrl(null);
        setElements([]);
      }
      log("Oturum kapatıldı");
    } catch (err) {
      log(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const currentSession = sessions.find((s) => s.id === activeSession);

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl mx-auto my-4 bg-surface border border-border rounded-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Browser</span>
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveSession(s.id); handleScreenshot(s.id); }}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  activeSession === s.id
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {s.title?.slice(0, 20) || s.url.slice(0, 20)}
                <span
                  onClick={(e) => { e.stopPropagation(); handleClose(s.id); }}
                  className="ml-1.5 text-muted hover:text-red-400"
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg">&times;</button>
        </div>

        {/* URL bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <input
            value={currentSession ? currentSession.url : urlInput}
            onChange={(e) => {
              if (currentSession) {
                setSessions((prev) => prev.map((s) => s.id === activeSession ? { ...s, url: e.target.value } : s));
              } else {
                setUrlInput(e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (currentSession) handleNavigate(currentSession.url);
                else handleOpen();
              }
            }}
            placeholder="https://example.com"
            className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono outline-none focus:border-border-hover"
          />
          <button
            onClick={currentSession ? () => handleNavigate(currentSession.url) : handleOpen}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
          >
            {currentSession ? "Git" : "Aç"}
          </button>
          {activeSession && (
            <>
              <button
                onClick={() => handleScreenshot()}
                disabled={loading}
                className="px-2.5 py-1.5 text-xs border border-border hover:border-border-hover rounded-md text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                📸
              </button>
              <button
                onClick={handleGetElements}
                disabled={loading}
                className="px-2.5 py-1.5 text-xs border border-border hover:border-border-hover rounded-md text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                🔍 Elementler
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Screenshot view */}
          <div className="flex-1 overflow-auto p-2 bg-black/20">
            {screenshotUrl ? (
              <img
                src={screenshotUrl}
                alt="Browser screenshot"
                className="w-full rounded border border-border"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted text-sm">
                URL girin ve &quot;Aç&quot; butonuna tıklayın
              </div>
            )}
          </div>

          {/* Side panel: elements + log */}
          <div className="w-80 border-l border-border flex flex-col">
            {/* Elements */}
            {elements.length > 0 && (
              <div className="flex-1 overflow-auto border-b border-border">
                <div className="px-3 py-2 text-[10px] text-muted font-medium uppercase tracking-wider border-b border-border sticky top-0 bg-surface">
                  Interaktif Elementler ({elements.length})
                </div>
                <div className="p-1">
                  {elements.map((el, i) => (
                    <button
                      key={i}
                      onClick={() => handleClick(el.selector)}
                      className="w-full text-left px-2 py-1 text-[11px] rounded hover:bg-white/5 transition-colors flex items-center gap-2"
                    >
                      <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-muted font-mono shrink-0">
                        {el.tag}
                      </span>
                      <span className="truncate text-foreground">
                        {el.text || el.selector}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action log */}
            <div className={`${elements.length > 0 ? "h-40" : "flex-1"} overflow-auto`} ref={logRef}>
              <div className="px-3 py-2 text-[10px] text-muted font-medium uppercase tracking-wider border-b border-border sticky top-0 bg-surface">
                Log
              </div>
              <div className="p-2 space-y-0.5">
                {actionLog.map((line, i) => (
                  <div key={i} className="text-[10px] text-muted font-mono">{line}</div>
                ))}
                {actionLog.length === 0 && (
                  <div className="text-[10px] text-muted/40">Henüz işlem yok</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
