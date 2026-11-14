import { Eye, Lightbulb, Lock, X } from 'lucide-react';
import type { LevelDefinition } from '../engine/types';

interface HintsDrawerProps {
  level: LevelDefinition;
  revealedCount: number;
  isCompleted: boolean;
  onRevealNext: () => void;
  onApplyDemoSolution: () => void;
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
  isCompleted,
  onRevealNext,
  onApplyDemoSolution,
  onClose,
}: HintsDrawerProps) {
  const hints = level.hints ?? [];
  const totalHints = hints.length;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-label="Пошаговые подсказки"
        className="cel-panel rounded-2xl max-w-lg w-full p-5 sm:p-6 flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/15 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#fef3c7] border-2 border-[#141e1a] flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4 text-[#b45309]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-extrabold text-[#141e1a] leading-tight truncate">
                Подсказки · {level.title}
              </h2>
              <p className="text-xs text-slate-600 font-mono-tabular">
                Открыто ступеней: {Math.min(revealedCount, totalHints)}/{totalHints}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть подсказки"
            className="cel-btn p-1.5 rounded-xl bg-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Открывайте ступени по одной, чтобы не лишать себя момента озарения.
          Готовое эталонное решение открывается только после самостоятельной победы.
        </p>

        <div className="space-y-2.5 max-h-[48vh] overflow-y-auto cel-scroll pr-0.5">
          {hints.map((hintText, idx) => {
            const isRevealed = idx < revealedCount;
            const isNextToReveal = idx === revealedCount;
            return (
              <div
                key={idx}
                className={`rounded-xl border-2 p-3 transition-colors ${
                  isRevealed
                    ? 'border-[#141e1a] bg-[#f8fbf9]'
                    : 'border-[#141e1a]/25 bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-[#141e1a]">
                    {TIER_TITLES[idx] ?? `Ступень ${idx + 1}`}
                  </span>
                  {isRevealed ? (
                    <span className="text-[11px] font-mono-tabular font-bold text-[#1f8f45]">
                      Открыта
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono-tabular text-slate-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Скрыта
                    </span>
                  )}
                </div>

                {isRevealed ? (
                  <p className="text-xs text-slate-800 leading-relaxed">{hintText}</p>
                ) : isNextToReveal ? (
                  <button
                    type="button"
                    onClick={onRevealNext}
                    className="mt-1 cel-btn px-3 py-1.5 rounded-lg bg-[#fef3c7] text-xs font-bold text-[#141e1a] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Открыть подсказку {idx + 1}/{totalHints}</span>
                  </button>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Сначала откройте предыдущую ступень.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-2 border-t border-black/15 flex flex-wrap items-center justify-between gap-2">
          {isCompleted && level.demoSolution ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onApplyDemoSolution();
              }}
              className="cel-btn px-3.5 py-2 rounded-xl bg-[#fef3c7] text-xs font-bold text-[#141e1a] flex items-center gap-1.5 cursor-pointer"
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Показать эталонную сборку</span>
            </button>
          ) : (
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Эталон разблокируется после победы
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="cel-btn px-4 py-2 rounded-xl bg-[#141e1a] text-white text-xs font-bold cursor-pointer ml-auto"
          >
            Вернуться к схеме
          </button>
        </div>
      </div>
    </div>
  );
}
