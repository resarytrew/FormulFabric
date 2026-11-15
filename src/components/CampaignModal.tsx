import { useState } from 'react';
import { Award, CheckCircle2, X } from 'lucide-react';
import {
  ALL_PUZZLE_LEVELS,
  ALL_TOOLS,
  CAMPAIGN_LEVELS,
  EUREKA_LEVELS,
  GRADE5_LEVELS,
  IMPOSSIBLE_LEVELS,
} from '../engine/levels';
import type { LevelDefinition, PuzzleChapter } from '../engine/types';

export interface LevelProgressRecord {
  completed: boolean;
  bestTicks?: number;
  bestBlocks?: number;
  bestArea?: number;
  medals?: {
    blocks: boolean;
    ticks: boolean;
    area: boolean;
  };
  hintsUsed?: number;
}

interface CampaignModalProps {
  currentLevelId: string;
  progress: Record<string, LevelProgressRecord>;
  onSelectLevel: (levelId: string) => void;
  onSelectSandbox: () => void;
  onClose: () => void;
}

export function CampaignModal({
  currentLevelId,
  progress,
  onSelectLevel,
  onSelectSandbox,
  onClose,
}: CampaignModalProps) {
  const initialChapter: PuzzleChapter = GRADE5_LEVELS.some((l) => l.id === currentLevelId)
    ? 'grade5'
    : IMPOSSIBLE_LEVELS.some((l) => l.id === currentLevelId)
      ? 'impossible'
      : EUREKA_LEVELS.some((l) => l.id === currentLevelId)
        ? 'eureka'
        : 'campaign';
  const [chapter, setChapter] = useState<PuzzleChapter>(initialChapter);

  const visibleLevels: LevelDefinition[] =
    chapter === 'grade5'
      ? GRADE5_LEVELS
      : chapter === 'impossible'
        ? IMPOSSIBLE_LEVELS
        : chapter === 'eureka'
          ? EUREKA_LEVELS
          : CAMPAIGN_LEVELS;

  const campaignDone = CAMPAIGN_LEVELS.filter((l) => progress[l.id]?.completed).length;
  const eurekaDone = EUREKA_LEVELS.filter((l) => progress[l.id]?.completed).length;
  const impossibleDone = IMPOSSIBLE_LEVELS.filter((l) => progress[l.id]?.completed).length;
  const grade5Done = GRADE5_LEVELS.filter((l) => progress[l.id]?.completed).length;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="cel-panel rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold text-[#141e1a]">
              Кампания и Песочница
            </h2>
            <p className="text-xs text-slate-600">
              {ALL_PUZZLE_LEVELS.length} инженерно-математических головоломок · Все уровни открыты для решения и оптимизации
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть выбор уровней"
            className="cel-btn p-2 rounded-xl bg-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Chapter Tabs */}
        <div
          role="tablist"
          aria-label="Главы головоломок"
          className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-black/15"
        >
          <button
            type="button"
            role="tab"
            aria-selected={chapter === 'campaign'}
            onClick={() => setChapter('campaign')}
            className={`cel-btn px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${
              chapter === 'campaign'
                ? 'bg-[#141e1a] text-white'
                : 'bg-white text-[#141e1a] hover:bg-[#f2f7f4]'
            }`}
          >
            <span>Глава I · Кампания ({CAMPAIGN_LEVELS.length})</span>
            <span className="font-mono-tabular opacity-80">
              {campaignDone}/{CAMPAIGN_LEVELS.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={chapter === 'eureka'}
            onClick={() => setChapter('eureka')}
            className={`cel-btn px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${
              chapter === 'eureka'
                ? 'bg-[#26b557] text-white'
                : 'bg-white text-[#141e1a] hover:bg-[#f2f7f4]'
            }`}
          >
            <span>Глава II · Эврика ({EUREKA_LEVELS.length})</span>
            <span className="font-mono-tabular opacity-90">
              {eurekaDone}/{EUREKA_LEVELS.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={chapter === 'impossible'}
            onClick={() => setChapter('impossible')}
            className={`cel-btn px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${
              chapter === 'impossible'
                ? 'bg-[#7c3aed] text-white'
                : 'bg-white text-[#141e1a] hover:bg-[#f2f7f4]'
            }`}
          >
            <span>Глава III · Невозможные ({IMPOSSIBLE_LEVELS.length})</span>
            <span className="font-mono-tabular opacity-90">
              {impossibleDone}/{IMPOSSIBLE_LEVELS.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={chapter === 'grade5'}
            onClick={() => setChapter('grade5')}
            className={`cel-btn px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${
              chapter === 'grade5'
                ? 'bg-[#0284c7] text-white'
                : 'bg-white text-[#141e1a] hover:bg-[#f2f7f4]'
            }`}
          >
            <span>Глава IV · 5 класс ({GRADE5_LEVELS.length})</span>
            <span className="font-mono-tabular opacity-90">
              {grade5Done}/{GRADE5_LEVELS.length}
            </span>
          </button>
        </div>

        <div className="overflow-y-auto cel-scroll pr-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleLevels.map((lvl) => {
            const rec = progress[lvl.id];
            const isCurrent = lvl.id === currentLevelId;
            const prefix =
              lvl.chapter === 'grade5'
                ? `5 кл. G${lvl.index}`
                : lvl.chapter === 'impossible'
                  ? `Невозможная №${lvl.index}`
                  : lvl.chapter === 'eureka'
                    ? `Эврика E${lvl.index}`
                    : `Уровень ${lvl.index}`;
            const hasHiddenTests = Boolean(lvl.verificationRuns?.some((r) => r.hidden));
            const medals = rec?.medals;
            const medalCount = medals
              ? Number(medals.blocks) + Number(medals.ticks) + Number(medals.area)
              : 0;
            const solveNote = rec?.completed
              ? rec.hintsUsed && rec.hintsUsed > 0
                ? `Подск.: ${rec.hintsUsed}`
                : 'Без подск.'
              : null;

            return (
              <button
                key={lvl.id}
                type="button"
                onClick={() => onSelectLevel(lvl.id)}
                className={`cel-btn text-left rounded-xl p-3.5 cursor-pointer flex flex-col justify-between gap-2 ${
                  isCurrent ? 'bg-[#e5f6ec]' : 'bg-white hover:bg-[#f6faf7]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 font-mono-tabular">
                      {prefix} · {lvl.tier}
                      {lvl.maxTotalBlocks !== undefined ? ` · Лимит ${lvl.maxTotalBlocks} бл.` : ''}
                      {lvl.fixedDivisor !== undefined ? ` · ÷${lvl.fixedDivisor} фикс.` : ''}
                      {hasHiddenTests ? ' · Скрытые тесты' : ''}
                    </div>
                    <div className="font-display font-bold text-base text-[#141e1a]">
                      {lvl.title}
                    </div>
                  </div>
                  {rec?.completed && (
                    <CheckCircle2
                      className="w-5 h-5 text-[#26b557] shrink-0"
                      aria-label="Уровень пройден"
                    />
                  )}
                </div>

                <p className="text-xs text-slate-600 line-clamp-2">{lvl.subtitle}</p>

                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-mono-tabular text-slate-600 pt-1.5 border-t border-black/10">
                  <span className="truncate">{lvl.bonusGoalText}</span>
                  {rec?.bestTicks !== undefined && (
                    <span className="font-bold text-[#141e1a] shrink-0 flex items-center gap-1.5">
                      <span>
                        {rec.bestTicks}т · {rec.bestBlocks}б
                        {rec.bestArea !== undefined ? ` · ${rec.bestArea}п` : ''}
                      </span>
                      {medals && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[#b45309]"
                          title={`Медали: ${medalCount}/3`}
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>{medalCount}/3</span>
                        </span>
                      )}
                      {solveNote && (
                        <span className="text-slate-500 font-medium">· {solveNote}</span>
                      )}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-black/15 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-600">
            Хотите поэкспериментировать со всеми {ALL_TOOLS.length} модулями (включая ½, ⚖, ↷ и ⇄) без ограничений?
          </span>
          <button
            type="button"
            onClick={onSelectSandbox}
            className="cel-btn px-4 py-2 rounded-xl bg-[#141e1a] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            Открыть Песочницу
          </button>
        </div>
      </div>
    </div>
  );
}
