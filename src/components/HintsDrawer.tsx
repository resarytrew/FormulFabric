import { Eye, Lightbulb, Lock, X } from 'lucide-react';
import type { LevelDefinition } from '../engine/types';

interface HintsDrawerProps {
  level: LevelDefinition;
  revealedCount: number;
  onRevealNext: () => void;
  onApplyDemoSolution: (variantIdx: number) => void;
  onClose: () => void;
}

const TIER_TITLES = [
  'Ступень 1 · Математическая идея',
  'Ступень 2 · Топология потоков',
  'Ступень 3 · Ключевой узел',
] as const;

export function HintsDrawer({
  level,
  revealedCount,
  onRevealNext,
  onApplyDemoSolution,
  onClose,
}: HintsDrawerProps) {
  const hints = level.hints ?? [];
  const totalHints = hints.length;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-label="Подсказки и эталон"
        className="hud-panel rounded-2xl max-w-lg w-full p-5 sm:p-6 flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/15 dark:border-slate-700/70 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#fef3c7] dark:bg-amber-400/15 border border-[#141e1a] dark:border-amber-400/40 flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4 text-[#b45309] dark:text-amber-300" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-extrabold text-[#141e1a] dark:text-slate-100 leading-tight truncate">
                Подсказки и эталон · {level.title}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono-tabular">
                Открыто ступеней: {Math.min(revealedCount, totalHints)}/{totalHints}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть подсказки"
            className="hud-btn p-1.5 rounded-xl bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Открывайте подсказки по шагам или загрузите готовую эталонную сборку ниже, чтобы изучить оптимальную схему.
        </p>

        {totalHints > 0 && (
          <div className="space-y-2.5 max-h-[45vh] overflow-y-auto cel-scroll pr-0.5">
            {hints.map((hintText, idx) => {
              const isRevealed = idx < revealedCount;
              const isNextToReveal = idx === revealedCount;
              return (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 transition-colors ${
                    isRevealed
                      ? 'border-[#141e1a] dark:border-slate-600 bg-[#f8fbf9] dark:bg-slate-900/75'
                      : 'border-[#141e1a]/25 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold text-[#141e1a] dark:text-slate-100">
                      {TIER_TITLES[idx] ?? `Ступень ${idx + 1}`}
                    </span>
                    {isRevealed ? (
                      <span className="text-[11px] font-mono-tabular font-bold text-[#1f8f45] dark:text-emerald-400">
                        Открыта
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Скрыта
                      </span>
                    )}
                  </div>

                  {isRevealed ? (
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                      {hintText}
                    </p>
                  ) : isNextToReveal ? (
                    <button
                      type="button"
                      onClick={onRevealNext}
                      className="mt-1 hud-btn px-3 py-1.5 rounded-lg bg-[#fef3c7] dark:bg-amber-400/20 text-xs font-bold text-[#141e1a] dark:text-amber-300 dark:border-amber-400/40 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Открыть подсказку {idx + 1}/{totalHints}</span>
                    </button>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Сначала откройте предыдущую ступень.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-2.5 border-t border-black/15 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-2">
          {level.demoSolution && (
            <div className="flex flex-wrap items-center gap-1.5">
              {level.altDemoSolutions && level.altDemoSolutions.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onApplyDemoSolution(0);
                    }}
                    title={level.demoLabel}
                    className="hud-btn px-3 py-2 rounded-xl bg-[#fef3c7] dark:bg-amber-400/20 text-xs font-bold text-[#141e1a] dark:text-amber-200 dark:border-amber-400/40 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                    <span>Эталон 1{level.demoLabel ? ` · ${level.demoLabel}` : ''}</span>
                  </button>
                  {level.altDemoSolutions.map((alt, idx) => (
                    <button
                      key={alt.label}
                      type="button"
                      onClick={() => {
                        onClose();
                        onApplyDemoSolution(idx + 1);
                      }}
                      title={alt.description ?? alt.label}
                      className="hud-btn px-3 py-2 rounded-xl bg-[#eef5f1] dark:bg-slate-800 text-xs font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                      <span>Эталон {idx + 2} · {alt.label}</span>
                    </button>
                  ))}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onApplyDemoSolution(0);
                  }}
                  className="hud-btn px-3.5 py-2 rounded-xl bg-[#fef3c7] dark:bg-amber-400/20 text-xs font-bold text-[#141e1a] dark:text-amber-200 dark:border-amber-400/40 flex items-center gap-1.5 cursor-pointer"
                >
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                  <span>Показать эталонную сборку</span>
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="hud-btn px-4 py-2 rounded-xl bg-[#141e1a] dark:bg-emerald-500 text-white dark:text-slate-950 text-xs font-bold cursor-pointer ml-auto"
          >
            Вернуться к схеме
          </button>
        </div>
      </div>
    </div>
  );
}
