"use client";

import { useState, useRef } from "react";
import type { WorkflowStep, WorkflowStepStatus } from "@/lib/types";
import { STEP_STATUS_LABELS } from "@/lib/types";

// ─── Layout constants ──────────────────────────────────────────────────────────
const LABEL_W = 200;      // px – left column width
const ROW_H   = 44;       // px – each step row height
const BAR_H   = 24;       // px – bar height inside row
const BAR_PAD = (ROW_H - BAR_H) / 2; // vertical centering
const AXIS_H  = 36;       // px – time-axis header height
const TL_W    = 720;      // px – timeline drawable width (min)
const TICK_N  = 6;        // number of time-axis ticks
const TOTAL_W = LABEL_W + TL_W; // total SVG width

// ─── Status visual styles ─────────────────────────────────────────────────────
const STATUS_STYLE: Record<WorkflowStepStatus, { fill: string; stroke: string; text: string }> = {
  pending: { fill: "#1f2937", stroke: "#6b7280", text: "#9ca3af" },
  running: { fill: "#1e3a8a", stroke: "#3b82f6", text: "#93c5fd" },
  done:    { fill: "#064e3b", stroke: "#10b981", text: "#6ee7b7" },
  error:   { fill: "#450a0a", stroke: "#ef4444", text: "#fca5a5" },
  skipped: { fill: "#111827", stroke: "#374151", text: "#4b5563" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDeps(raw: string): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try { return JSON.parse(s); } catch { /* fall through */ }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function computeWaveMap(steps: WorkflowStep[]): Map<string, number> {
  const cache = new Map<string, number>();
  function wave(step: WorkflowStep): number {
    if (cache.has(step.id)) return cache.get(step.id)!;
    const deps = parseDeps(step.depends_on);
    if (!deps.length) { cache.set(step.id, 0); return 0; }
    const maxDep = Math.max(
      ...deps.map((id) => {
        const dep = steps.find((s) => s.id === id);
        return dep ? wave(dep) : 0;
      }),
    );
    const w = maxDep + 1;
    cache.set(step.id, w);
    return w;
  }
  steps.forEach((s) => wave(s));
  return cache;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}dk ${s}s` : `${m}dk`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BarInfo {
  step: WorkflowStep;
  row: number;           // 0-based row index
  startMs: number;       // ms relative to chart origin
  endMs: number;         // ms relative to chart origin
  estimated: boolean;
}

interface TooltipState {
  step: WorkflowStep;
  duration: number | null;
  svgX: number;
  svgY: number;
}

// ─── Mock data (used when workflowStartedAt is null and steps have no timestamps)
const MOCK_STEPS: WorkflowStep[] = [
  {
    id: "m1", workflow_id: "demo", role: "backend", title: "Veritabanı Şeması",
    prompt: "", status: "done", depends_on: "", agent_summary: "Schema oluşturuldu",
    order_index: 0,
    started_at:  new Date(Date.now() - 18 * 60_000).toISOString(),
    finished_at: new Date(Date.now() - 14 * 60_000).toISOString(),
    completed_at: new Date(Date.now() - 14 * 60_000).toISOString(),
    created_at:  new Date(Date.now() - 20 * 60_000).toISOString(),
  },
  {
    id: "m2", workflow_id: "demo", role: "backend", title: "API Endpoint'leri",
    prompt: "", status: "done", depends_on: "m1", agent_summary: "Endpoint'ler eklendi",
    order_index: 1,
    started_at:  new Date(Date.now() - 13 * 60_000).toISOString(),
    finished_at: new Date(Date.now() -  8 * 60_000).toISOString(),
    completed_at: new Date(Date.now() -  8 * 60_000).toISOString(),
    created_at:  new Date(Date.now() - 20 * 60_000).toISOString(),
  },
  {
    id: "m3", workflow_id: "demo", role: "frontend", title: "UI Komponentleri",
    prompt: "", status: "running", depends_on: "m1", agent_summary: "",
    order_index: 2,
    started_at:  new Date(Date.now() - 12 * 60_000).toISOString(),
    finished_at: null,
    completed_at: null,
    created_at:  new Date(Date.now() - 20 * 60_000).toISOString(),
  },
  {
    id: "m4", workflow_id: "demo", role: "test", title: "Entegrasyon Testleri",
    prompt: "", status: "pending", depends_on: "m2,m3", agent_summary: "",
    order_index: 3,
    started_at: null, finished_at: null, completed_at: null,
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────
export interface GanttChartProps {
  steps: WorkflowStep[];
  workflowStartedAt: string | null;
  /** Pass true to show mock data when steps is empty (development helper) */
  showMockIfEmpty?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GanttChart({
  steps,
  workflowStartedAt,
  showMockIfEmpty = false,
}: GanttChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const activeSteps: WorkflowStep[] =
    steps.length > 0 ? steps : showMockIfEmpty ? MOCK_STEPS : [];

  if (!activeSteps.length) {
    return (
      <div className="flex items-center justify-center h-20 text-muted text-sm">
        Henüz adım yok
      </div>
    );
  }

  // Sort by order_index
  const sorted = [...activeSteps].sort((a, b) => a.order_index - b.order_index);
  const rowOf = new Map(sorted.map((s, i) => [s.id, i]));

  // ── Time range calculation ──────────────────────────────────────────────────
  const now = Date.now();
  const WAVE_MS = 5 * 60_000;  // estimated 5 min per wave
  const STEP_MS = 4 * 60_000;  // estimated 4 min per step

  let originMs: number;
  if (workflowStartedAt) {
    originMs = new Date(workflowStartedAt).getTime();
  } else {
    const realStarts = sorted.filter((s) => s.started_at).map((s) => new Date(s.started_at!).getTime());
    originMs = realStarts.length ? Math.min(...realStarts) : now - WAVE_MS;
  }

  const waveMap = computeWaveMap(sorted);

  const bars: BarInfo[] = sorted.map((step) => {
    const row = rowOf.get(step.id)!;
    if (step.started_at) {
      const startMs = new Date(step.started_at).getTime() - originMs;
      const endMs = step.finished_at
        ? new Date(step.finished_at).getTime() - originMs
        : step.status === "running"
        ? now - originMs
        : startMs + STEP_MS;
      return { step, row, startMs, endMs, estimated: !step.finished_at && step.status !== "done" };
    }
    // No timestamp → estimate from wave
    const w = waveMap.get(step.id) ?? step.order_index;
    const startMs = w * WAVE_MS;
    return { step, row, startMs, endMs: startMs + STEP_MS, estimated: true };
  });

  const maxMs = Math.max(...bars.map((b) => b.endMs), WAVE_MS);
  const totalMs = maxMs * 1.08; // 8% breathing room at right

  // Map ms → SVG x (within timeline area, 0..TL_W)
  const toX = (ms: number) => LABEL_W + (ms / totalMs) * TL_W;

  // ── SVG total height ────────────────────────────────────────────────────────
  const svgH = AXIS_H + sorted.length * ROW_H + 16;

  // ── Time axis ticks ─────────────────────────────────────────────────────────
  const ticks = Array.from({ length: TICK_N + 1 }, (_, i) => {
    const ms = (totalMs / TICK_N) * i;
    return { ms, x: toX(ms), label: i === 0 ? "0s" : fmtDuration(ms) };
  });

  // ── Dependency arrows ───────────────────────────────────────────────────────
  type Arrow = { sx: number; sy: number; ex: number; ey: number };
  const arrows: Arrow[] = [];
  for (const bar of bars) {
    const deps = parseDeps(bar.step.depends_on);
    for (const depId of deps) {
      const src = bars.find((b) => b.step.id === depId);
      if (!src) continue;
      arrows.push({
        sx: toX(src.endMs),
        sy: AXIS_H + src.row * ROW_H + ROW_H / 2,
        ex: toX(bar.startMs),
        ey: AXIS_H + bar.row * ROW_H + ROW_H / 2,
      });
    }
  }

  // ── Tooltip handler ─────────────────────────────────────────────────────────
  const handleEnter = (bar: BarInfo, e: React.MouseEvent<SVGRectElement>) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM()!.inverse());
    const duration =
      bar.step.started_at && bar.step.finished_at
        ? new Date(bar.step.finished_at).getTime() - new Date(bar.step.started_at).getTime()
        : null;
    setTooltip({ step: bar.step, duration, svgX: svgPt.x, svgY: svgPt.y });
  };

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!tooltip || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgRef.current.getScreenCTM()!.inverse());
    setTooltip((prev) => prev ? { ...prev, svgX: svgPt.x, svgY: svgPt.y } : null);
  };

  // ── Tooltip content dimensions ──────────────────────────────────────────────
  const TT_W = 230;
  const TT_H = 110;
  const TT_PAD = 8;
  const TT_LINE = 16;

  const renderTooltip = () => {
    if (!tooltip) return null;
    const { step, duration, svgX, svgY } = tooltip;
    const style = STATUS_STYLE[step.status as WorkflowStepStatus] ?? STATUS_STYLE.pending;

    // Clamp so tooltip stays inside SVG
    const ttX = Math.min(svgX + 14, TOTAL_W - TT_W - 4);
    const ttY = Math.min(svgY - 4, svgH - TT_H - 4);

    const lines: string[] = [
      `Durum: ${STEP_STATUS_LABELS[step.status as WorkflowStepStatus] ?? step.status}`,
      `Rol: ${step.role}`,
      ...(step.started_at ? [`Başlangıç: ${fmtTime(step.started_at)}`] : []),
      ...(step.finished_at ? [`Bitiş: ${fmtTime(step.finished_at)}`] : []),
      ...(duration !== null ? [`Süre: ${fmtDuration(duration)}`] : []),
      ...(tooltip.step.started_at === null ? [`* Tahmini konum`] : []),
    ];

    return (
      <g pointerEvents="none">
        <rect
          x={ttX}
          y={ttY}
          width={TT_W}
          height={TT_PAD * 2 + TT_LINE * (lines.length + 1) + 4}
          rx={6}
          fill="#1a1a1a"
          stroke="#3a3a3a"
          strokeWidth={1}
          filter="url(#shadow)"
        />
        {/* Title */}
        <text
          x={ttX + TT_PAD}
          y={ttY + TT_PAD + 11}
          fill="#ededed"
          fontSize={11}
          fontWeight="600"
        >
          {step.title.length > 28 ? step.title.slice(0, 28) + "…" : step.title}
        </text>
        {/* Status pill */}
        <rect
          x={ttX + TT_PAD}
          y={ttY + TT_PAD + 18}
          width={60}
          height={14}
          rx={3}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={0.5}
        />
        <text
          x={ttX + TT_PAD + 30}
          y={ttY + TT_PAD + 28}
          fill={style.text}
          fontSize={9}
          textAnchor="middle"
        >
          {STEP_STATUS_LABELS[step.status as WorkflowStepStatus]}
        </text>
        {/* Detail lines */}
        {lines.slice(1).map((line, i) => (
          <text
            key={i}
            x={ttX + TT_PAD}
            y={ttY + TT_PAD + 46 + i * TT_LINE}
            fill="#888888"
            fontSize={10}
          >
            {line}
          </text>
        ))}
      </g>
    );
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg
        ref={svgRef}
        width={TOTAL_W}
        height={svgH}
        viewBox={`0 0 ${TOTAL_W} ${svgH}`}
        className="block"
        style={{ minWidth: TOTAL_W }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          {/* Drop shadow for tooltip */}
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.5" />
          </filter>
          {/* Arrow marker for dependencies */}
          <marker id="dep-arrow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="#4b5563" opacity="0.8" />
          </marker>
          {/* Gradient for running bars */}
          <linearGradient id="running-glow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1e3a8a" />
            <stop offset="50%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
            <animate attributeName="x1" from="-100%" to="100%" dur="2s" repeatCount="indefinite" />
            <animate attributeName="x2" from="0%" to="200%" dur="2s" repeatCount="indefinite" />
          </linearGradient>
        </defs>

        {/* ── Background ─────────────────────────────────────────────────────── */}
        <rect x={0} y={0} width={TOTAL_W} height={svgH} fill="#0f0f0f" />

        {/* ── Alternating row backgrounds ─────────────────────────────────────── */}
        {sorted.map((_, i) => (
          <rect
            key={i}
            x={0}
            y={AXIS_H + i * ROW_H}
            width={TOTAL_W}
            height={ROW_H}
            fill={i % 2 === 0 ? "#111111" : "#0f0f0f"}
          />
        ))}

        {/* ── Axis area ───────────────────────────────────────────────────────── */}
        <rect x={0} y={0} width={TOTAL_W} height={AXIS_H} fill="#141414" />
        <line x1={0} y1={AXIS_H} x2={TOTAL_W} y2={AXIS_H} stroke="#2a2a2a" strokeWidth={1} />

        {/* ── Time-axis ticks + vertical grid ────────────────────────────────── */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x}
              y1={AXIS_H - 6}
              x2={tick.x}
              y2={svgH}
              stroke="#2a2a2a"
              strokeWidth={0.5}
              strokeDasharray={i === 0 ? "none" : "3 4"}
            />
            <text
              x={tick.x}
              y={AXIS_H - 10}
              fill="#666"
              fontSize={9}
              textAnchor="middle"
              fontFamily="monospace"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* ── Label column separator ───────────────────────────────────────────── */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#2a2a2a" strokeWidth={1} />

        {/* ── Row labels + bars ──────────────────────────────────────────────── */}
        {bars.map((bar) => {
          const style = STATUS_STYLE[bar.step.status as WorkflowStepStatus] ?? STATUS_STYLE.pending;
          const rowY = AXIS_H + bar.row * ROW_H;
          const barX = toX(bar.startMs);
          const barW = Math.max(toX(bar.endMs) - barX, 6);
          const barY = rowY + BAR_PAD;
          const isRunning = bar.step.status === "running";

          return (
            <g key={bar.step.id}>
              {/* Step label */}
              <text
                x={8}
                y={rowY + ROW_H / 2 + 4}
                fill="#aaa"
                fontSize={11}
                fontWeight={isRunning ? "600" : "400"}
              >
                {bar.step.title.length > 22
                  ? bar.step.title.slice(0, 22) + "…"
                  : bar.step.title}
              </text>

              {/* Role badge */}
              <rect
                x={LABEL_W - 54}
                y={rowY + ROW_H / 2 - 8}
                width={48}
                height={16}
                rx={4}
                fill={style.fill}
                opacity={0.7}
              />
              <text
                x={LABEL_W - 30}
                y={rowY + ROW_H / 2 + 4}
                fill={style.text}
                fontSize={9}
                textAnchor="middle"
              >
                {bar.step.role.slice(0, 7)}
              </text>

              {/* Bar background (estimated dashed) */}
              {bar.estimated && (
                <rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={BAR_H}
                  rx={4}
                  fill="transparent"
                  stroke={style.stroke}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.5}
                />
              )}

              {/* Bar fill */}
              {!bar.estimated && (
                <rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={BAR_H}
                  rx={4}
                  fill={isRunning ? "url(#running-glow)" : style.fill}
                  stroke={style.stroke}
                  strokeWidth={1}
                  opacity={0.85}
                />
              )}

              {/* Running pulse glow */}
              {isRunning && (
                <rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={BAR_H}
                  rx={4}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={2}
                  opacity={0.4}
                >
                  <animate
                    attributeName="opacity"
                    values="0.4;0.9;0.4"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                </rect>
              )}

              {/* Bar label (role text inside bar if wide enough) */}
              {barW > 40 && (
                <text
                  x={barX + barW / 2}
                  y={barY + BAR_H / 2 + 4}
                  fill={style.text}
                  fontSize={9}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {bar.step.role}
                  {bar.estimated ? " ~" : ""}
                </text>
              )}

              {/* Status dot on left of bar */}
              <circle
                cx={barX - 6}
                cy={barY + BAR_H / 2}
                r={3}
                fill={style.stroke}
                opacity={0.8}
              />

              {/* Invisible hit area for tooltip */}
              <rect
                x={barX}
                y={rowY}
                width={barW}
                height={ROW_H}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => handleEnter(bar, e)}
                onMouseMove={handleMove}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}

        {/* ── Dependency arrows ─────────────────────────────────────────────── */}
        {arrows.map((a, i) => {
          const cx = (a.sx + a.ex) / 2;
          return (
            <path
              key={i}
              d={`M ${a.sx} ${a.sy} C ${cx} ${a.sy} ${cx} ${a.ey} ${a.ex} ${a.ey}`}
              fill="none"
              stroke="#4b5563"
              strokeWidth={1}
              strokeDasharray="3 2"
              markerEnd="url(#dep-arrow)"
              opacity={0.6}
            />
          );
        })}

        {/* ── Tooltip ─────────────────────────────────────────────────────────── */}
        {renderTooltip()}

        {/* ── Legend ──────────────────────────────────────────────────────────── */}
        {(() => {
          const items: [WorkflowStepStatus, string][] = [
            ["pending", "Bekliyor"],
            ["running", "Çalışıyor"],
            ["done",    "Tamamlandı"],
            ["error",   "Hata"],
            ["skipped", "Atlandı"],
          ];
          return (
            <g>
              {items.map(([status, label], i) => {
                const st = STATUS_STYLE[status];
                const lx = LABEL_W + 8 + i * 110;
                const ly = svgH - 10;
                return (
                  <g key={status}>
                    <rect x={lx} y={ly - 8} width={10} height={10} rx={2} fill={st.fill} stroke={st.stroke} strokeWidth={0.5} />
                    <text x={lx + 14} y={ly} fill="#666" fontSize={9}>{label}</text>
                  </g>
                );
              })}
              {/* Estimated note */}
              <line
                x1={LABEL_W + 8}
                y1={svgH - 22}
                x2={LABEL_W + 28}
                y2={svgH - 22}
                stroke="#6b7280"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text x={LABEL_W + 32} y={svgH - 18} fill="#555" fontSize={9}>
                ~ tahmini
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
