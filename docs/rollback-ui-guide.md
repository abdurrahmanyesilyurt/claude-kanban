# Rollback UI Geliştirme Kılavuzu

> **Proje:** Claude Kanban — Next.js Frontend
> **İlgili backend:** `lib/deploy-service.ts`, `lib/db.ts`
> **API Prefix:** `/api/deployments/:projectKey`
> **Tarih:** 2026-03-20

---

## İçindekiler

1. [Genel Bakış](#genel-bakış)
2. [Tip Tanımları](#tip-tanımları)
3. [RollbackButton Bileşeni](#1-rollbackbutton-bileşeni)
4. [RollbackConfirmDialog Bileşeni](#2-rollbackconfirmdialog-bileşeni)
5. [Deployment History Listesi](#3-deployment-history-listesi)
6. [Auto-Rollback Durumu](#4-auto-rollback-durumu)
7. [API Entegrasyon Referansı](#api-entegrasyon-referansı)
8. [Mevcut Kodla Entegrasyon Notları](#mevcut-kodla-entegrasyon-notları)

---

## Genel Bakış

Rollback UI sistemi dört temel bileşenden oluşmaktadır:

| Bileşen | Konum | Amaç |
|---------|-------|-------|
| `RollbackButton` | Deployment kartı / detay başlığı | Kullanıcının rollback başlatmasını sağlar |
| `RollbackConfirmDialog` | Modal overlay | İşlemi onaylatır, hedef versiyonu gösterir |
| `DeploymentHistoryList` | Deployment detay paneli | Geçmiş deploy kayıtlarını listeler |
| `AutoRollbackBadge` + Toast | Deployment kartı başlığı | Otomatik rollback bildirimini gösterir |

> **Not:** `RollbackDialog` ve `RollbackBadge` bileşenlerinin **temel versiyonları** `app/components/DeployPanel.tsx` içinde zaten mevcuttur (backup-tabanlı sistem). Bu kılavuz, yeni `deployment_history` veritabanı tablosuna dayanan **genişletilmiş versiyonu** belgelemektedir.

---

## Tip Tanımları

```typescript
// Deployment history API yanıtındaki tek kayıt
export interface DeploymentHistoryEntry {
  id: string;                        // UUID — rollback için kullanılır
  status: "running" | "success" | "failed" | "rolled_back";
  deploy_type: "deploy" | "rollback";
  commit_hash: string | null;        // Git commit SHA (kısa: 7 karakter göster)
  backup_path: string | null;        // Sunucudaki yedek dizini
  triggered_by: string | null;       // "manual" | "auto" | "api"
  rollback_of: string | null;        // Bu rollback hangi deployment'ı geri aldı?
  started_at: number;                // Unix timestamp (ms)
  finished_at: number | null;
  duration_ms: number | null;
  rollback_available: boolean;       // backup_path dolu ise true
  logs?: DeployLogEntry[];           // include_logs=true ile gelir
}

// GET /api/deployments/:id/history yanıtı
export interface DeploymentHistoryResponse {
  project_key: string;
  project_name: string;
  total: number;
  history: DeploymentHistoryEntry[];
}

// POST /api/deployments/:id/rollback istek gövdesi
export interface RollbackRequest {
  deploymentId?: string;  // Belirtilmezse son başarılı deployment kullanılır
}

// POST /api/deployments/:id/rollback başarı yanıtı
export interface RollbackResponse {
  ok: boolean;
  message: string;
  project_key: string;
  deploymentId: string;
  hint: string;
}

// Rollback işlemi UI durumu
export type RollbackStatus = "idle" | "rolling_back" | "rolled_back" | "failed";

// Mevcut Toast sistemi (app/components/Toast.tsx)
// useToast() → { toast: (message: string, type?: "success" | "error" | "info") => void }
```

---

## 1. RollbackButton Bileşeni

### Kullanım Amacı

Deployment kartındaki veya detay sayfasındaki rollback işlemini tetikleyen butondur. Yalnızca `status: "success"` olan ve `rollback_available: true` olan kayıtlarda aktif olur.

### Prop Tipleri

```typescript
interface RollbackButtonProps {
  /** Rollback yapılacak deployment'ın ID'si */
  deploymentId: string;

  /** Deployment'ın durumu — yalnızca "success" iken aktif */
  deploymentStatus: DeploymentHistoryEntry["status"];

  /** Sunucuda yedek mevcut mu? (backup_path dolu mu?) */
  rollbackAvailable: boolean;

  /** Deploy işlemi devam ediyor mu? Evet ise buton disabled */
  isDeploying?: boolean;

  /** Buton tıklandığında çağrılır (dialog açılmadan önce) */
  onClick: (deploymentId: string) => void;

  /** Görsel boyut varyantı */
  size?: "sm" | "xs";
}
```

### Durum Matrisi

| `deploymentStatus` | `rollbackAvailable` | `isDeploying` | Görünüm |
|---|---|---|---|
| `success` | `true` | `false` | **Aktif** — kırmızı tonda, tıklanabilir |
| `success` | `false` | `false` | **Disabled** — "Yedek yok" tooltip |
| `failed` / `running` | herhangi | herhangi | **Disabled** — soluk görünüm |
| herhangi | herhangi | `true` | **Disabled** — "Deploy devam ediyor" tooltip |

### Örnek Implementasyon

```tsx
// components/RollbackButton.tsx
"use client";

interface RollbackButtonProps {
  deploymentId: string;
  deploymentStatus: "running" | "success" | "failed" | "rolled_back";
  rollbackAvailable: boolean;
  isDeploying?: boolean;
  onClick: (deploymentId: string) => void;
  size?: "sm" | "xs";
}

export function RollbackButton({
  deploymentId,
  deploymentStatus,
  rollbackAvailable,
  isDeploying = false,
  onClick,
  size = "xs",
}: RollbackButtonProps) {
  const canRollback =
    deploymentStatus === "success" &&
    rollbackAvailable &&
    !isDeploying;

  const getTooltip = () => {
    if (isDeploying) return "Deploy devam ediyor";
    if (!rollbackAvailable) return "Yedek bulunamadı";
    if (deploymentStatus !== "success") return "Yalnızca başarılı deployment'lar geri alınabilir";
    return "Bu versiyona geri dön";
  };

  const sizeClass = size === "xs"
    ? "text-[10px] px-2 py-1"
    : "text-xs px-3 py-1.5";

  return (
    <button
      onClick={() => canRollback && onClick(deploymentId)}
      disabled={!canRollback}
      title={getTooltip()}
      aria-label={`Rollback: ${deploymentId}`}
      className={`
        ${sizeClass} rounded font-medium border transition-colors
        ${canRollback
          ? "bg-red-600/20 text-red-400 border-red-500/30 hover:bg-red-600/35 cursor-pointer"
          : "bg-red-600/10 text-red-400/40 border-red-500/10 cursor-not-allowed"
        }
      `}
    >
      ↩️ Rollback
    </button>
  );
}
```

### Loading State (Rollback Devam Ederken)

Rollback başlatıldıktan sonra buton yerinde `RollbackBadge` gösterilir, buton gizlenir:

```tsx
// RollbackStatus "rolling_back" iken buton yerine spinner badge
{rollbackStatus === "rolling_back" ? (
  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5
                   rounded-full border bg-orange-900/20 text-orange-400 border-orange-500/30">
    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
    Geri alınıyor...
  </span>
) : (
  <RollbackButton ... />
)}
```

---

## 2. RollbackConfirmDialog Bileşeni

### Kullanım Amacı

Kullanıcı rollback butonuna tıkladığında açılan onay modalıdır. Geri dönülecek versiyonun detaylarını gösterir ve `POST /api/deployments/:id/rollback` çağrısını yönetir.

### Prop Tipleri

```typescript
interface RollbackConfirmDialogProps {
  /** Modal açık mı? */
  open: boolean;

  /** Rollback yapılacak proje anahtarı (örn. "karbon") */
  projectKey: string;

  /** Projenin görünen adı */
  projectName: string;

  /** Rollback yapılacak deployment kaydı */
  targetDeployment: DeploymentHistoryEntry | null;

  /** Onaylandığında çağrılır — API çağrısını tetikler */
  onConfirm: () => Promise<void>;

  /** İptal edildiğinde çağrılır */
  onCancel: () => void;

  /** Rollback API çağrısı devam ediyor mu? */
  isLoading?: boolean;
}
```

### Gösterilen Bilgiler

Dialog içinde şu bilgiler gösterilmelidir:

| Alan | Kaynak | Format |
|------|--------|--------|
| Proje adı | `projectName` prop | Kalın metin |
| Commit hash | `targetDeployment.commit_hash` | Mono font, ilk 7 karakter |
| Deploy tarihi | `targetDeployment.started_at` | `"dd MMM yyyy HH:mm"` (tr-TR) |
| Süre | `targetDeployment.duration_ms` | `"Xs"` formatı |
| Deploy türü | `targetDeployment.deploy_type` | `"deploy"` → "Normal Deploy" |

### Örnek Implementasyon

```tsx
// components/RollbackConfirmDialog.tsx
"use client";

import { useState } from "react";
import { useToast } from "./Toast";

interface RollbackConfirmDialogProps {
  open: boolean;
  projectKey: string;
  projectName: string;
  targetDeployment: DeploymentHistoryEntry | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function RollbackConfirmDialog({
  open,
  projectKey,
  projectName,
  targetDeployment,
  onConfirm,
  onCancel,
  isLoading = false,
}: RollbackConfirmDialogProps) {
  if (!open) return null;

  const shortHash = targetDeployment?.commit_hash?.slice(0, 7) ?? "—";
  const deployDate = targetDeployment?.started_at
    ? new Date(targetDeployment.started_at).toLocaleString("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Bilinmiyor";
  const durationSec = targetDeployment?.duration_ms
    ? (targetDeployment.duration_ms / 1000).toFixed(1) + "s"
    : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface border border-red-500/40 rounded-xl p-5 shadow-xl">

        {/* Başlık */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">⚠️</span>
          <h3 className="text-sm font-semibold text-red-400">Rollback Onayı</h3>
        </div>

        {/* Uyarı mesajı */}
        <p className="text-xs text-muted mb-3">
          <span className="text-foreground font-medium">{projectName}</span> projesi{" "}
          bu versiyona geri alınacak. Mevcut sürüm yedeklenmiş versiyon ile değiştirilecektir.
        </p>

        {/* Hedef versiyon bilgisi */}
        {targetDeployment ? (
          <div className="bg-black/30 rounded-lg p-3 mb-4 text-xs space-y-1.5">
            <div className="text-muted text-[10px] uppercase tracking-wide mb-2">
              Geri dönülecek versiyon
            </div>

            <div className="flex justify-between">
              <span className="text-muted">Commit</span>
              <span className="font-mono text-emerald-400">{shortHash}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted">Deploy Tarihi</span>
              <span className="text-foreground">{deployDate}</span>
            </div>

            {durationSec && (
              <div className="flex justify-between">
                <span className="text-muted">Süre</span>
                <span className="text-muted">{durationSec}</span>
              </div>
            )}

            {targetDeployment.triggered_by && (
              <div className="flex justify-between">
                <span className="text-muted">Tetikleyen</span>
                <span className="text-muted">{targetDeployment.triggered_by}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-red-900/20 rounded-lg p-2.5 mb-4 text-xs text-red-400">
            ⚠️ Versiyon bilgisi yüklenemedi. En son başarılı deployment kullanılacak.
          </div>
        )}

        {/* Aksiyon butonları */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted
                       hover:text-foreground hover:border-border/80 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Hayır, İptal
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded bg-red-600/30 text-red-400
                       border border-red-500/40 hover:bg-red-600/50 transition-colors
                       font-medium flex items-center gap-1.5
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading && (
              <span className="w-3 h-3 border border-red-400/50 border-t-red-400
                               rounded-full animate-spin" />
            )}
            {isLoading ? "Başlatılıyor..." : "Evet, Rollback Yap"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### API Entegrasyonu — Onay İşlemi

`onConfirm` callback'i içinde yapılacak API çağrısı:

```typescript
// useRollback hook örneği
export function useRollback(projectKey: string) {
  const { toast } = useToast();
  const [status, setStatus] = useState<RollbackStatus>("idle");

  const triggerRollback = async (deploymentId?: string) => {
    setStatus("rolling_back");
    try {
      const res = await fetch(`/api/deployments/${projectKey}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // deploymentId verilmezse backend son başarılı deployment'ı seçer
        body: JSON.stringify(deploymentId ? { deploymentId } : {}),
      });

      const data: RollbackResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Rollback başarısız");
      }

      setStatus("rolled_back");
      toast(`Rollback başlatıldı: ${data.message}`, "success");
      return data;
    } catch (err) {
      setStatus("failed");
      toast(
        err instanceof Error ? err.message : "Rollback başlatılamadı",
        "error"
      );
      throw err;
    }
  };

  return { status, triggerRollback };
}
```

**API Çağrısı Detayları:**

```
POST /api/deployments/:projectKey/rollback

Headers:
  Content-Type: application/json
  Authorization: Bearer <DEPLOY_API_KEY>   ← ortam değişkeni tanımlıysa zorunlu

Body (opsiyonel):
  { "deploymentId": "uuid-of-target-deployment" }

  deploymentId verilmezse → son başarılı deployment otomatik seçilir

Başarı Yanıtı (200):
  {
    "ok": true,
    "message": "Karbon rollback baslatildi",
    "project_key": "karbon",
    "deploymentId": "abc123-...",
    "hint": "GET /api/deployments/karbon/history ile durumu takip edebilirsiniz"
  }

Hata Yanıtları:
  401 — DEPLOY_API_KEY ile kimlik doğrulama başarısız
  404 — Bilinmeyen proje veya rollback yapılacak başarılı deployment yok
  400 — Proje deploy için aktif değil
```

> **Önemli:** Rollback işlemi **fire-and-forget** olarak başlatılır. API hemen `200` döner; gerçek sonucu `GET /api/deployments/:id/history` ile takip edilmelidir.

---

## 3. Deployment History Listesi

### Kullanım Amacı

Seçili projenin deploy geçmişini listeleyen bileşen. Her satırda versiyon, tarih, durum ve rollback butonu bulunur.

### Prop Tipleri

```typescript
interface DeploymentHistoryListProps {
  /** Proje anahtarı — API çağrısı için */
  projectKey: string;

  /** Proje adı — başlık için */
  projectName: string;

  /** Kaç kayıt gösterilsin (default: 10) */
  limit?: number;

  /** Deploy işlemi devam ediyor mu? RollbackButton'ları disable eder */
  isDeploying?: boolean;

  /** Rollback butonu tıklandığında (deploymentId ile) */
  onRollbackClick?: (entry: DeploymentHistoryEntry) => void;
}
```

### API Entegrasyonu — Veri Çekme

```typescript
// GET /api/deployments/:projectKey/history
// Query params: limit (default:20, max:100), include_logs (default:false)

async function fetchDeploymentHistory(
  projectKey: string,
  limit = 10
): Promise<DeploymentHistoryResponse> {
  const res = await fetch(
    `/api/deployments/${projectKey}/history?limit=${limit}`,
    { cache: "no-store" } // Her seferinde taze veri
  );

  if (!res.ok) {
    throw new Error(`History yüklenemedi: ${res.status}`);
  }

  return res.json();
}
```

### Örnek Implementasyon

```tsx
// components/DeploymentHistoryList.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { RollbackButton } from "./RollbackButton";

// Durum renk ve ikon haritası
const STATUS_CONFIG = {
  success:     { color: "text-emerald-400", icon: "✅", label: "Başarılı" },
  failed:      { color: "text-red-400",     icon: "❌", label: "Başarısız" },
  running:     { color: "text-yellow-400",  icon: "⏳", label: "Devam ediyor" },
  rolled_back: { color: "text-purple-400",  icon: "↩️", label: "Geri alındı" },
} as const;

export function DeploymentHistoryList({
  projectKey,
  projectName,
  limit = 10,
  isDeploying = false,
  onRollbackClick,
}: DeploymentHistoryListProps) {
  const [history, setHistory] = useState<DeploymentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeploymentHistory(projectKey, limit);
      setHistory(data.history);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [projectKey, limit]);

  // Proje değişince yenile
  useEffect(() => { load(); }, [load]);

  // Deploy tamamlandığında otomatik yenile
  useEffect(() => {
    if (!isDeploying) { load(); }
  }, [isDeploying, load]);

  if (loading) {
    return (
      <div className="text-[10px] text-muted p-3 text-center">
        Geçmiş yükleniyor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-[10px] text-red-400 p-3">
        ❌ {error}
        <button onClick={load} className="ml-2 underline hover:no-underline">
          Tekrar dene
        </button>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-[10px] text-muted p-3 text-center">
        Henüz deployment kaydı yok.
      </div>
    );
  }

  return (
    <div className="bg-black/30 rounded-lg border border-border/30 overflow-hidden">
      {/* Tablo başlığı */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2
                      border-b border-border/20 text-[9px] text-muted uppercase tracking-wide">
        <span>Versiyon / Tarih</span>
        <span>Süre</span>
        <span>Durum</span>
        <span>İşlem</span>
      </div>

      {/* Kayıtlar */}
      <div className="divide-y divide-border/10 max-h-64 overflow-auto">
        {history.map((entry, index) => {
          const statusCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.failed;
          const shortHash = entry.commit_hash?.slice(0, 7);
          const date = new Date(entry.started_at).toLocaleString("tr-TR", {
            dateStyle: "short",
            timeStyle: "short",
          });
          const duration = entry.duration_ms
            ? `${(entry.duration_ms / 1000).toFixed(1)}s`
            : "—";

          return (
            <div
              key={entry.id}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center
                         px-3 py-2 text-[10px] hover:bg-white/[0.02]"
            >
              {/* Versiyon + Tarih */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {index === 0 && (
                    <span className="bg-emerald-600/20 text-emerald-400
                                     px-1 py-0.5 rounded text-[9px] shrink-0">
                      son
                    </span>
                  )}
                  {entry.deploy_type === "rollback" && (
                    <span className="bg-purple-600/20 text-purple-400
                                     px-1 py-0.5 rounded text-[9px] shrink-0">
                      rollback
                    </span>
                  )}
                  {shortHash && (
                    <span className="font-mono text-foreground">{shortHash}</span>
                  )}
                </div>
                <div className="text-muted mt-0.5">{date}</div>
              </div>

              {/* Süre */}
              <span className="text-muted">{duration}</span>

              {/* Durum */}
              <span className={statusCfg.color}>
                {statusCfg.icon} {statusCfg.label}
              </span>

              {/* Rollback Butonu */}
              <div>
                {onRollbackClick && (
                  <RollbackButton
                    deploymentId={entry.id}
                    deploymentStatus={entry.status}
                    rollbackAvailable={entry.rollback_available}
                    isDeploying={isDeploying}
                    onClick={() => onRollbackClick(entry)}
                    size="xs"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — yenile butonu */}
      <div className="flex justify-end px-3 py-1.5 border-t border-border/20">
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] text-muted hover:text-foreground disabled:opacity-50"
        >
          ↻ Yenile
        </button>
      </div>
    </div>
  );
}
```

---

## 4. Auto-Rollback Durumu

### Kullanım Amacı

Backend tarafından otomatik rollback gerçekleştirildiyse (deploy başarısız olduğunda `deploy-service.ts` tarafından tetiklenen), kullanıcıyı hem görsel badge hem de toast notification ile bilgilendirmek gerekir.

### Auto-Rollback Tespiti

History listesindeki kayıtlar incelenerek tespit edilir:

```typescript
function detectAutoRollback(
  history: DeploymentHistoryEntry[]
): DeploymentHistoryEntry | null {
  // Son 2 kayda bak:
  // Eğer [0] = rollback (triggered_by: "auto") ve [1] = failed ise
  // otomatik rollback gerçekleşmiş demektir
  if (history.length >= 2) {
    const latest = history[0];
    const previous = history[1];

    if (
      latest.deploy_type === "rollback" &&
      latest.triggered_by === "auto" &&
      previous.status === "failed"
    ) {
      return latest;
    }
  }
  return null;
}
```

### AutoRollbackBadge Bileşeni

```typescript
interface AutoRollbackBadgeProps {
  /** Otomatik rollback kaydı — null ise badge gösterilmez */
  autoRollbackEntry: DeploymentHistoryEntry | null;
}
```

```tsx
// components/AutoRollbackBadge.tsx
"use client";

export function AutoRollbackBadge({ autoRollbackEntry }: AutoRollbackBadgeProps) {
  if (!autoRollbackEntry) return null;

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
                 border bg-orange-900/20 text-orange-400 border-orange-500/30
                 animate-pulse"
      title={`Otomatik rollback: ${new Date(autoRollbackEntry.started_at)
        .toLocaleString("tr-TR", { timeStyle: "short" })}`}
    >
      ⚠️ Otomatik Rollback
    </span>
  );
}
```

### Toast Notification — Auto-Rollback Bildirimi

History yüklendiğinde kontrol yapılır ve kullanıcı bilgilendirilir:

```typescript
// useEffect içinde — history her yüklendiğinde çalışır
useEffect(() => {
  const autoRollback = detectAutoRollback(history);

  if (autoRollback && !notifiedRef.current) {
    // Bir kere göster (ref ile duplicate önlenir)
    notifiedRef.current = true;
    toast(
      `⚠️ ${projectName}: Deploy başarısız oldu — otomatik rollback uygulandı`,
      "error"
    );
  }
}, [history, projectName, toast]);
```

### DeployPanel Entegrasyonu (Mevcut Kod)

`DeployPanel.tsx` içindeki `RollbackBadge` bileşeni zaten `rollbackStatus` state'ini göstermektedir. Auto-rollback durumunu da kapsayacak şekilde genişletmek için:

```tsx
// DeployPanel.tsx içinde — proje başlığı satırına ekle
<div className="flex items-center gap-2">
  <h3 className="text-sm font-semibold">
    {projects.find((p) => p.key === selected)?.name}
  </h3>

  {/* Mevcut rollback badge (manuel rollback için) */}
  <RollbackBadge status={rollbackStatus} />

  {/* Yeni: Otomatik rollback badge */}
  <AutoRollbackBadge autoRollbackEntry={autoRollbackEntry} />
</div>
```

---

## API Entegrasyon Referansı

### GET /api/deployments/:projectKey/history

```
GET /api/deployments/karbon/history?limit=10

Yanıt:
{
  "project_key": "karbon",
  "project_name": "Ekonaz Backend",
  "total": 5,
  "history": [
    {
      "id": "uuid-1234",
      "status": "success",
      "deploy_type": "deploy",
      "commit_hash": "a1b2c3d4e5f6",
      "backup_path": "/var/backups/karbon/1742400000000",
      "triggered_by": "manual",
      "rollback_of": null,
      "started_at": 1742400000000,
      "finished_at": 1742400045000,
      "duration_ms": 45000,
      "rollback_available": true
    },
    ...
  ]
}
```

### POST /api/deployments/:projectKey/rollback

```
POST /api/deployments/karbon/rollback
Content-Type: application/json

Body (opsiyonel):
{ "deploymentId": "uuid-1234" }

Başarı:
{
  "ok": true,
  "message": "Ekonaz Backend rollback baslatildi",
  "project_key": "karbon",
  "deploymentId": "uuid-1234",
  "hint": "GET /api/deployments/karbon/history ile durumu takip edebilirsiniz"
}
```

### Geçerli `projectKey` Değerleri

`DEPLOY_CONFIGS` içindeki anahtarlar (`lib/deploy-service.ts`):

| projectKey | Proje |
|-----------|-------|
| `karbon` | Ekonaz Backend (.NET) |
| `nakliyekoop` | NakliyeKoop (NestJS) |

---

## Mevcut Kodla Entegrasyon Notları

### DeployPanel.tsx — Mevcut Bileşenler

`app/components/DeployPanel.tsx` içinde aşağıdaki bileşenler **zaten mevcut** (backup-tabanlı sistem):

| Mevcut Bileşen | Yeni Bileşen | Fark |
|----------------|--------------|------|
| `RollbackDialog` | `RollbackConfirmDialog` | Yeni: `targetDeployment` prop ile DB kayıtlı versiyonu gösterir |
| `RollbackBadge` | `RollbackBadge` + `AutoRollbackBadge` | Yeni: `triggered_by === "auto"` durumunu ayırt eder |
| Yedekler listesi (backup dizini tabanlı) | `DeploymentHistoryList` | Yeni: DB'den `deployment_history` tablosunu okur |
| Rollback (`/api/deploy/rollback`) | Rollback (`/api/deployments/:id/rollback`) | Yeni endpoint, deploymentId desteği |

### Önerilen Geçiş Stratejisi

1. **Yeni endpoint'leri ekle** — `/api/deployments/` altındaki route'lar zaten yazıldı (backend adımı tamamlandı)
2. **`DeploymentHistoryList`** bileşenini `DeployPanel` içine ekle — `showBackups` state'ini `showHistory` olarak genişlet
3. **`RollbackConfirmDialog`** içinde hem backup bilgisini hem commit hash'ini göster
4. **Auto-rollback detection** — history poll edilirken `detectAutoRollback()` çalıştır

### Tailwind CSS Renk Referansı

Mevcut design system ile uyumlu renkler:

```
Başarı:   text-emerald-400 / bg-emerald-900/20 / border-emerald-500/30
Hata:     text-red-400     / bg-red-900/20     / border-red-500/30
Uyarı:    text-orange-400  / bg-orange-900/20  / border-orange-500/30
Rollback: text-purple-400  / bg-purple-900/20  / border-purple-500/30
Devam:    text-yellow-400  / bg-yellow-900/20  / border-yellow-500/30
Muted:    text-muted (CSS var)
Zemin:    bg-surface (CSS var)
Kenarlık: border-border (CSS var)
```

---

*Bu döküman `docs/rollback-ui-guide.md` olarak kaydedilmiştir.*
*Backend implementasyonu: `lib/deploy-service.ts`, `lib/db.ts`*
*API rotaları: `app/api/deployments/[id]/history/route.ts`, `app/api/deployments/[id]/rollback/route.ts`*
