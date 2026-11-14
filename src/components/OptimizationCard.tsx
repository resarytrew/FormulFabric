import { useEffect, useState } from 'react';
import { Award, ChevronDown, ChevronUp, Trophy } from 'lucide-react';
import type { LevelDefinition, SimulationWorld } from '../engine/types';

interface OptimizationCardProps {
  level: LevelDefinition;
  world: SimulationWorld;
  playerBlockCount: number;
  area: number;
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

export function OptimizationCard({
  level,
  world,
  playerBlockCount,
  area,
}: OptimizationCardProps) {
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

  const targets = level.targets;
  const blocksGold = targets?.blocksGold ?? level.maxBlocksBonus;
  const areaGold = targets?.areaGold ?? level.maxAreaBonus;
  const ticksGold = targets?.ticksGold ?? level.maxTicksBonus;

  const blocksMet = blocksGold !== undefined ? playerBlockCount <= blocksGold : false;
  const areaMet = areaGold !== undefined ? area <= areaGold : false;
  const ticksMet = ticksGold !== undefined && world.tick > 0 ? world.tick <= ticksGold : false;

  const seconds = world.tick * 0.54;
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

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Показать оптимизацию"
        aria-expanded={false}
        className="pointer-events-auto cel-panel rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-bold text-[#141e1a] cursor-pointer hover:bg-white"
      >
        <Trophy className="w-3.5 h-3.5 text-[#f0861a] shrink-0" />
        <span className="font-mono-tabular">
          {combinedRank !== null ? `#${combinedRank}` : 'Оптим.'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <section
      aria-label="Оптимизация решения"
      className="pointer-events-auto cel-panel rounded-2xl p-2.5 w-56 text-[#141e1a]"
    >
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Trophy className="w-3.5 h-3.5 text-[#f0861a] shrink-0" />
          <span className="font-display font-extrabold text-[11px] tracking-wide uppercase truncate">
            Оптимизация
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть оптимизацию"
          aria-expanded={true}
          className="p-0.5 rounded hover:bg-black/10 cursor-pointer shrink-0"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600 font-medium">Блоки</span>
          <span className="font-mono-tabular font-extrabold flex items-center gap-1">
            <span className={blocksMet && playerBlockCount > 0 ? 'text-[#1f8f45]' : ''}>
              {playerBlockCount}
              {level.maxTotalBlocks !== undefined ? `/${level.maxTotalBlocks}` : ''}
            </span>
            {blocksGold !== undefined && (
              <span className="text-[10px] font-semibold text-slate-500">
                (≤{blocksGold})
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600 font-medium">Площадь</span>
          <span className="font-mono-tabular font-extrabold flex items-center gap-1">
            <span className={areaMet ? 'text-[#1f8f45]' : ''}>{area}</span>
            {areaGold !== undefined && (
              <span className="text-[10px] font-semibold text-slate-500">
                (≤{areaGold})
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600 font-medium">Скорость</span>
          <span className="font-mono-tabular font-extrabold flex items-center gap-1">
            <span className={ticksMet ? 'text-[#1f8f45]' : ''}>
              {world.tick > 0 ? `${seconds.toFixed(1)} сек` : '—'}
            </span>
            {ticksGold !== undefined && (
              <span className="text-[10px] font-semibold text-slate-500">
                (≤{ticksGold}т)
              </span>
            )}
          </span>
        </div>

        <div className="pt-1.5 border-t border-[#141e1a]/15 flex items-center justify-between gap-2">
          <span className="text-slate-600 font-semibold flex items-center gap-1 text-[11px]">
            <Award className="w-3.5 h-3.5 text-[#f0861a]" />
            Рейтинг
          </span>
          <span
            data-testid="opt-rank"
            className="font-mono-tabular font-extrabold text-sm text-[#0d9488]"
          >
            {combinedRank !== null ? `#${combinedRank}` : '—'}
          </span>
        </div>
      </div>
    </section>
  );
}
