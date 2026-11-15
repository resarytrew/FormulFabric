import { useEffect, useMemo, useState } from 'react';
import { Award, ChevronDown, ChevronUp, Target } from 'lucide-react';
import type { LevelDefinition, SimulationWorld, TargetPattern } from '../engine/types';

interface GoalCardProps {
  level: LevelDefinition;
  world: SimulationWorld;
  playerBlockCount: number;
  area: number;
}

function getSvgTokenFill(value?: number): string {
  if (value === undefined) return '#64748b';
  if (value < 0) return '#e11d48';
  if (value === 0) return '#64748b';
  const palette = ['#26b557', '#0284c7', '#f0861a', '#7c3aed', '#0d9488'];
  return palette[Math.abs(value) % palette.length];
}

function estimateRank(
  value: number,
  gold: number,
  curve: number[] | undefined,
): number {
  if (!curve || curve.length === 0) return value <= gold ? 1 : 20;
  const sorted = [...curve].sort((a, b) => a - b);
  if (value <= gold) return 1;
  let worseThan = 0;
  for (const b of sorted) {
    if (value > b) worseThan += 1;
  }
  return Math.min(99, 3 + worseThan * 6 + Math.max(0, value - gold));
}

function TargetPatternDiagram({
  pattern,
  deliveredForSink,
}: {
  pattern: TargetPattern;
  deliveredForSink: number;
}) {
  const width = 176;
  const height = pattern.nodes.length > 1 ? 94 : 62;
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
  const pad = 24;
  const scale =
    rawPts.length === 1
      ? 1
      : Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 32);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const pts = rawPts.map((p) => ({
    ...p,
    sx: width * 0.5 + (p.x - cx) * scale,
    sy: height * 0.5 + (p.y - cy) * scale,
  }));

  const nodeRadius = rawPts.length >= 4 ? 13 : 16;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto rounded-xl border border-[#141e1a]/20 dark:border-slate-700/70 bg-[#f0f6fa] dark:bg-[#09101a]"
      role="img"
      aria-label={`Целевая структура: ${pattern.label}`}
    >
      <circle
        cx={width * 0.5}
        cy={height * 0.5}
        r={Math.min(width, height) * 0.4}
        fill="none"
        stroke="#22d3ee"
        strokeOpacity="0.24"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />

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
              stroke="#0f172a"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <line
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke="#67e8f9"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {pts.map((p) => {
        const fill = getSvgTokenFill(p.value);
        const text = p.value !== undefined ? String(p.value) : '?';
        const fontSize = text.length >= 3 ? 10 : 12.5;
        return (
          <g key={`node-${p.idx}`}>
            <circle
              cx={p.sx}
              cy={p.sy}
              r={nodeRadius}
              fill={fill}
              stroke="#0f172a"
              strokeWidth="2.2"
            />
            <circle
              cx={p.sx - nodeRadius * 0.32}
              cy={p.sy - nodeRadius * 0.32}
              r={nodeRadius * 0.22}
              fill="#ffffff"
              fillOpacity="0.4"
            />
            <text
              x={p.sx}
              y={p.sy + 4}
              textAnchor="middle"
              fill="#ffffff"
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

/**
 * Deterministic flow sparkline driven purely by real simulation events across ticks.
 */
function FlowSparkline({ world }: { world: SimulationWorld }) {
  const buckets = useMemo(() => {
    const windowSize = 12;
    const endTick = Math.max(world.tick, windowSize - 1);
    const startTick = Math.max(0, endTick - (windowSize - 1));
    const vals = new Array<number>(windowSize).fill(0);

    for (const ev of world.events) {
      if (ev.tick < startTick || ev.tick > endTick) continue;
      const idx = ev.tick - startTick;
      const weight =
        ev.type === 'deliver'
          ? 3
          : ev.type === 'weld' || ev.type === 'transform'
            ? 2
            : ev.type === 'move' || ev.type === 'spawn'
              ? 1
              : 0;
      vals[idx] += weight;
    }
    return vals;
  }, [world.tick, world.events]);

  const maxVal = Math.max(...buckets, 3);
  const w = 180;
  const h = 28;
  const stepX = w / Math.max(1, buckets.length - 1);

  const points = buckets
    .map((v, i) => {
      const x = i * stepX;
      const y = h - 4 - (v / maxVal) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `0,${h} ${points} ${w},${h}`;

  const statusText =
    world.status === 'error'
      ? 'Сбой линии'
      : world.status === 'victory'
        ? 'Принята ✓'
        : world.deliveredCount > 0
          ? 'Стабильно ✓'
          : world.tick > 0
            ? 'В работе'
            : 'Ожидание';

  const statusColor =
    world.status === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : world.deliveredCount > 0 || world.status === 'victory'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-slate-600 dark:text-slate-400';

  const strokeColor =
    world.status === 'error'
      ? '#f43f5e'
      : world.deliveredCount > 0 || world.status === 'victory'
        ? '#10b981'
        : '#22d3ee';

  return (
    <div className="pt-1.5 border-t border-[#141e1a]/15 dark:border-slate-700/60">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Поток
        </span>
        <span className={`font-semibold ${statusColor}`}>{statusText}</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-7 rounded bg-slate-100/80 dark:bg-slate-900/75"
        aria-hidden="true"
      >
        <polygon points={areaPoints} fill={strokeColor} fillOpacity="0.16" />
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
    </div>
  );
}

export function GoalCard({ level, world, playerBlockCount, area }: GoalCardProps) {
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

  const targets = level.targets;
  const blocksGold = targets?.blocksGold ?? level.maxBlocksBonus;
  const areaGold = targets?.areaGold ?? level.maxAreaBonus;
  const ticksGold = targets?.ticksGold ?? level.maxTicksBonus;

  const blocksMet =
    blocksGold !== undefined && playerBlockCount > 0 ? playerBlockCount <= blocksGold : false;
  const areaMet = areaGold !== undefined && area > 0 ? area <= areaGold : false;
  const ticksMet = ticksGold !== undefined && world.tick > 0 ? world.tick <= ticksGold : false;
  const atBlockLimit =
    level.maxTotalBlocks !== undefined && playerBlockCount >= level.maxTotalBlocks;

  const areaScore = estimateRank(area, areaGold ?? area, targets?.areaCurve);
  const blocksScore = estimateRank(
    playerBlockCount,
    blocksGold ?? playerBlockCount,
    targets?.blocksCurve,
  );
  const ticksScore =
    world.tick > 0
      ? estimateRank(world.tick, ticksGold ?? world.tick, targets?.ticksCurve)
      : blocksScore;
  const combinedRank =
    playerBlockCount === 0
      ? null
      : Math.max(1, Math.round((blocksScore + areaScore + ticksScore) / 3));

  const deliveredLabel = `${world.deliveredCount}/${level.infiniteMode || level.id === 'sandbox' ? '∞' : world.requiredDeliveries}`;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Показать цель уровня"
        aria-expanded={false}
        className="pointer-events-auto hud-panel rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-xs font-bold text-[#141e1a] dark:text-slate-100 cursor-pointer"
      >
        <Target className="w-3.5 h-3.5 text-[#16a3b8] dark:text-cyan-400 shrink-0" />
        <span className="truncate max-w-[110px]">
          {primaryPattern ? primaryPattern.label : 'Цель'}
        </span>
        <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
          {deliveredLabel}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
      </button>
    );
  }

  return (
    <section
      aria-label="Цель уровня и телеметрия"
      className="pointer-events-auto hud-panel rounded-2xl p-2.5 w-60 text-[#141e1a] dark:text-slate-100 space-y-2"
    >
      {/* Header: ЦЕЛЬ + delivered count */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Target className="w-3.5 h-3.5 text-[#16a3b8] dark:text-cyan-400 shrink-0" />
          <span className="font-display font-extrabold text-[11px] tracking-wide uppercase truncate">
            Цель
          </span>
          <strong
            data-testid="hud-delivered"
            className="font-mono-tabular text-xs font-extrabold text-emerald-700 dark:text-emerald-400 ml-0.5"
          >
            {deliveredLabel}
          </strong>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть цель уровня"
          aria-expanded={true}
          className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer shrink-0"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Target SVG & Expected Values */}
      {sinks.length === 0 || level.id === 'sandbox' ? (
        <div className="rounded-xl border border-[#141e1a]/15 dark:border-slate-700/60 bg-[#f0f6fa] dark:bg-slate-900/75 p-2 text-[11px] text-slate-700 dark:text-slate-300 leading-snug">
          <div className="font-bold text-[#141e1a] dark:text-white mb-0.5">Свободная сборка</div>
          Экспериментируйте и доставляйте полимеры в приёмник.
        </div>
      ) : (
        <div className="space-y-1.5">
          {sinks.slice(0, 2).map((sink, sIdx) => {
            const pat = sink.config.targetPattern!;
            const sinkKey = sink.config.sinkId ?? 'main';
            const deliveredForSink = (world.sinkDeliveries[sinkKey] ?? []).length;
            const modeLabel =
              pat.mode === 'sum_shape'
                ? `Сумма${pat.requiredSum !== undefined ? ` Σ=${pat.requiredSum}` : ''}`
                : pat.mode === 'beam_balance'
                  ? 'Баланс L = R, центр L+R'
                  : pat.mode === 'growth_ladder'
                    ? pat.ladderStep
                      ? `Рост (${pat.ladderStep.op === 'add' ? `+${pat.ladderStep.value}` : `×${pat.ladderStep.value}`})`
                      : 'Рост'
                    : pat.rotationInvariant
                      ? 'Любой поворот'
                      : 'Фикс. ориентация';

            return (
              <div key={`${sinkKey}-${sIdx}`} className="space-y-1">
                <TargetPatternDiagram
                  pattern={pat}
                  deliveredForSink={deliveredForSink}
                />
                <div className="flex items-center justify-between gap-1 text-[10.5px]">
                  <span className="font-mono-tabular font-extrabold text-[#141e1a] dark:text-slate-100 truncate">
                    {pat.label}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">
                    {!pat.rotationInvariant ? '🔒 ' : ''}
                    {modeLabel}
                  </span>
                </div>

                {pat.expectedValues && pat.expectedValues.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {pat.expectedValues.slice(0, 6).map((val, i) => {
                      const done = i < deliveredForSink;
                      const current = i === deliveredForSink;
                      return (
                        <span
                          key={`${i}-${val}`}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular font-bold border ${
                            done
                              ? 'bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 border-[#141e1a] dark:border-emerald-400'
                              : current
                                ? 'bg-[#fef3c7] dark:bg-amber-400/20 text-[#141e1a] dark:text-amber-300 border-[#141e1a] dark:border-amber-400/50'
                                : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-[#141e1a]/25 dark:border-slate-700'
                          }`}
                        >
                          {val}
                        </span>
                      );
                    })}
                  </div>
                )}

                {!pat.expectedValues &&
                  pat.expectedNodeValues &&
                  pat.expectedNodeValues.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {pat.expectedNodeValues.slice(0, 4).map((row, i) => {
                        const done = i < deliveredForSink;
                        const current = i === deliveredForSink;
                        return (
                          <span
                            key={`${i}-${row.join('-')}`}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular font-bold border ${
                              done
                                ? 'bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 border-[#141e1a] dark:border-emerald-400'
                                : current
                                  ? 'bg-[#fef3c7] dark:bg-amber-400/20 text-[#141e1a] dark:text-amber-300 border-[#141e1a] dark:border-amber-400/50'
                                  : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-[#141e1a]/25 dark:border-slate-700'
                            }`}
                          >
                            [{row.join('·')}]
                          </span>
                        );
                      })}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unified Compact Skylines Telemetry Strip */}
      <div className="pt-1.5 border-t border-[#141e1a]/15 dark:border-slate-700/60 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-slate-100/85 dark:bg-slate-900/75 px-1.5 py-1">
          <div className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400">
            Блоки
          </div>
          <div
            data-testid="hud-blocks"
            className={`font-mono-tabular text-xs font-extrabold ${
              atBlockLimit
                ? 'text-amber-600 dark:text-amber-400'
                : blocksMet
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-[#141e1a] dark:text-slate-100'
            }`}
          >
            {playerBlockCount}
            {level.maxTotalBlocks !== undefined ? `/${level.maxTotalBlocks}` : ''}
          </div>
          {blocksGold !== undefined && (
            <div className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">
              ≤{blocksGold}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-slate-100/85 dark:bg-slate-900/75 px-1.5 py-1">
          <div className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400">
            Такты
          </div>
          <div
            data-testid="hud-tick"
            className={`font-mono-tabular text-xs font-extrabold ${
              ticksMet
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-[#141e1a] dark:text-slate-100'
            }`}
          >
            {world.tick}
          </div>
          {ticksGold !== undefined && (
            <div className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">
              ≤{ticksGold}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-slate-100/85 dark:bg-slate-900/75 px-1.5 py-1">
          <div className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400">
            Площадь
          </div>
          <div
            data-testid="hud-area"
            className={`font-mono-tabular text-xs font-extrabold ${
              areaMet
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-[#141e1a] dark:text-slate-100'
            }`}
          >
            {area}
          </div>
          {areaGold !== undefined && (
            <div className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">
              ≤{areaGold}
            </div>
          )}
        </div>
      </div>

      {/* Rank Row */}
      <div className="flex items-center justify-between text-[11px] px-0.5">
        <span className="text-slate-600 dark:text-slate-400 font-semibold flex items-center gap-1">
          <Award className="w-3.5 h-3.5 text-amber-500" />
          Рейтинг схемы
        </span>
        <span
          data-testid="opt-rank"
          className="font-mono-tabular font-extrabold text-xs text-teal-700 dark:text-cyan-300"
        >
          {combinedRank !== null ? `#${combinedRank}` : '—'}
        </span>
      </div>

      {/* Live Flow Sparkline */}
      <FlowSparkline world={world} />
    </section>
  );
}
