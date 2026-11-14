import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Target } from 'lucide-react';
import type { LevelDefinition, SimulationWorld, TargetPattern } from '../engine/types';

interface GoalCardProps {
  level: LevelDefinition;
  world: SimulationWorld;
}

function getSvgTokenFill(value?: number): string {
  if (value === undefined) return '#cbd5e1';
  if (value < 0) return '#e11d48';
  if (value === 0) return '#64748b';
  const palette = ['#26b557', '#0284c7', '#f0861a', '#7c3aed', '#0d9488'];
  return palette[Math.abs(value) % palette.length];
}

function TargetPatternDiagram({
  pattern,
  deliveredForSink,
}: {
  pattern: TargetPattern;
  deliveredForSink: number;
}) {
  const width = 176;
  const height = pattern.nodes.length > 1 ? 104 : 68;
  const sqrt3 = Math.sqrt(3);

  const rawPts = pattern.nodes.map((n, idx) => {
    const x = sqrt3 * (n.offset.q + n.offset.r * 0.5);
    const y = 1.5 * n.offset.r;
    const seqNodeVal =
      pattern.expectedNodeValues?.[deliveredForSink]?.[idx] ??
      pattern.expectedNodeValues?.[0]?.[idx];
    const seqScalarVal =
      pattern.nodes.length === 1
        ? (pattern.expectedValues?.[deliveredForSink] ?? pattern.expectedValues?.[0])
        : undefined;
    const displayVal = n.value ?? seqNodeVal ?? seqScalarVal;
    return { x, y, value: displayVal, idx };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rawPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = Math.max(maxX - minX, 0.01);
  const spanY = Math.max(maxY - minY, 0.01);
  const pad = 26;
  const scale =
    rawPts.length === 1
      ? 1
      : Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 34);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const pts = rawPts.map((p) => ({
    ...p,
    sx: width * 0.5 + (p.x - cx) * scale,
    sy: height * 0.5 + (p.y - cy) * scale,
  }));

  const nodeRadius = rawPts.length >= 4 ? 14 : 17;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto rounded-xl border border-[#141e1a]/20 bg-[#f0f6fa]"
      role="img"
      aria-label={`Целевая структура: ${pattern.label}`}
    >
      {/* Subtle hex backdrop ring */}
      <circle
        cx={width * 0.5}
        cy={height * 0.5}
        r={Math.min(width, height) * 0.4}
        fill="none"
        stroke="#16a3b8"
        strokeOpacity="0.22"
        strokeWidth="2"
        strokeDasharray="4 4"
      />

      {/* Polymer Bonds */}
      {pattern.edges.map((edge, idx) => {
        const a = pts[edge.fromIdx];
        const b = pts[edge.toIdx];
        if (!a || !b) return null;
        return (
          <g key={`edge-${idx}`}>
            <line
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke="#141e1a"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <line
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke="#8ce8d3"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* Token Spheres */}
      {pts.map((p) => {
        const fill = getSvgTokenFill(p.value);
        const text = p.value !== undefined ? String(p.value) : '?';
        const textColor = p.value !== undefined ? '#ffffff' : '#141e1a';
        const fontSize = text.length >= 3 ? 10 : 13;
        return (
          <g key={`node-${p.idx}`}>
            <circle
              cx={p.sx}
              cy={p.sy}
              r={nodeRadius}
              fill={fill}
              stroke="#141e1a"
              strokeWidth="2.5"
            />
            {/* Specular cel highlight */}
            <circle
              cx={p.sx - nodeRadius * 0.32}
              cy={p.sy - nodeRadius * 0.32}
              r={nodeRadius * 0.24}
              fill="#ffffff"
              fillOpacity="0.45"
            />
            <text
              x={p.sx}
              y={p.sy + 4.5}
              textAnchor="middle"
              fill={textColor}
              fontSize={fontSize}
              fontWeight="800"
              fontFamily="JetBrains Mono, monospace"
            >
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function GoalCard({ level, world }: GoalCardProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 640) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sinks = Array.from(world.machines.values()).filter(
    (m) => m.type === 'sink' && m.config.targetPattern,
  );

  const primarySink = sinks[0];
  const primaryPattern = primarySink?.config.targetPattern;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Показать цель уровня"
        aria-expanded={false}
        className="pointer-events-auto cel-panel rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-bold text-[#141e1a] cursor-pointer hover:bg-white"
      >
        <Target className="w-3.5 h-3.5 text-[#16a3b8] shrink-0" />
        <span className="truncate max-w-[120px]">
          {primaryPattern ? primaryPattern.label : 'Цель'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <section
      aria-label="Цель уровня"
      className="pointer-events-auto cel-panel rounded-2xl p-2.5 w-56 text-[#141e1a]"
    >
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Target className="w-3.5 h-3.5 text-[#16a3b8] shrink-0" />
          <span className="font-display font-extrabold text-[11px] tracking-wide uppercase truncate">
            Цель · Задача
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть цель уровня"
          aria-expanded={true}
          className="p-0.5 rounded hover:bg-black/10 cursor-pointer shrink-0"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      {sinks.length === 0 || level.id === 'sandbox' ? (
        <div className="rounded-xl border border-[#141e1a]/15 bg-[#f0f6fa] p-2 text-[11px] text-slate-700 leading-snug">
          <div className="font-bold text-[#141e1a] mb-0.5">Свободная сборка</div>
          Экспериментируйте с механизмами и доставляйте полимеры в приёмник.
        </div>
      ) : (
        <div className="space-y-2">
          {sinks.slice(0, 2).map((sink, sIdx) => {
            const pat = sink.config.targetPattern!;
            const sinkKey = sink.config.sinkId ?? 'main';
            const deliveredForSink = (world.sinkDeliveries[sinkKey] ?? []).length;
            const modeLabel =
              pat.mode === 'sum_shape'
                ? `Форма + сумма${pat.requiredSum !== undefined ? ` (Σ=${pat.requiredSum})` : ''}`
                : pat.rotationInvariant
                  ? 'Значение / форма'
                  : 'Форма + ориентация';

            return (
              <div key={`${sinkKey}-${sIdx}`} className="space-y-1.5">
                <TargetPatternDiagram
                  pattern={pat}
                  deliveredForSink={deliveredForSink}
                />

                <div className="flex items-center justify-between gap-1 text-[11px]">
                  <span className="font-mono-tabular font-extrabold text-[#141e1a] truncate">
                    {pat.label}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 shrink-0">
                    {pat.mode === 'sum_shape' ? 'Σ' : 'Точно'}
                  </span>
                </div>

                <div className="text-[10px] text-slate-600 leading-tight">
                  {modeLabel}
                </div>

                {pat.expectedValues && pat.expectedValues.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {pat.expectedValues.slice(0, 6).map((val, i) => {
                      const done = i < deliveredForSink;
                      const current = i === deliveredForSink;
                      return (
                        <span
                          key={`${i}-${val}`}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular font-bold border ${
                            done
                              ? 'bg-[#26b557] text-white border-[#141e1a]'
                              : current
                                ? 'bg-[#fef3c7] text-[#141e1a] border-[#141e1a]'
                                : 'bg-white text-slate-600 border-[#141e1a]/25'
                          }`}
                        >
                          {val}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="pt-1 border-t border-[#141e1a]/15 flex items-center justify-between text-[11px] font-mono-tabular">
            <span className="text-slate-600 font-semibold">Доставлено</span>
            <strong className="text-[#141e1a]">
              {world.deliveredCount}/{level.infiniteMode ? '∞' : world.requiredDeliveries}
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}
