import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Crosshair,
  Lightbulb,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import type {
  LevelDefinition,
  MathRevealSpec,
  SimulationWorld,
  VerificationReport,
} from '../engine/types';

interface OutcomeModalProps {
  mode: 'victory' | 'paused' | 'error';
  level: LevelDefinition;
  world: SimulationWorld;
  playerBlockCount: number;
  area: number;
  hintsUsed?: number;
  verificationReport?: VerificationReport | null;
  hasNextLevel: boolean;
  onNextLevel: () => void;
  onReplay: () => void;
  onApplyDemo?: () => void;
  onResume: () => void;
  onBackToTitle: () => void;
  onFixAndReset: () => void;
  onFocusError?: () => void;
}

interface MetricHistogramProps {
  label: string;
  value: number;
  goldThreshold: number;
  curve: number[];
  unit: string;
}

function MetricHistogram({
  label,
  value,
  goldThreshold,
  curve,
  unit,
}: MetricHistogramProps) {
  const buckets = [...new Set([...curve, value])].sort((a, b) => a - b).slice(0, 6);
  const maxVal = Math.max(...buckets, 1);
  const metMedal = value <= goldThreshold;

  return (
    <div className="rounded-xl border border-[#141e1a]/25 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <span className="font-bold text-[#141e1a]">{label}</span>
        <span className="font-mono-tabular flex items-center gap-1.5">
          <span className="font-extrabold text-[#141e1a]">
            {value} {unit}
          </span>
          <span className="text-slate-400">·</span>
          {metMedal ? (
            <span className="text-[#1f8f45] font-bold flex items-center gap-0.5">
              <Award className="w-3.5 h-3.5" />
              Медаль (≤ {goldThreshold})
            </span>
          ) : (
            <span className="text-slate-600 flex items-center gap-0.5">
              <Target className="w-3 h-3" />
              Цель ≤ {goldThreshold}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-end gap-1.5 h-10 pt-1">
        {buckets.map((bucketVal, i) => {
          const isPlayer = bucketVal === value;
          const isGoldBucket = bucketVal <= goldThreshold;
          const heightPct = Math.max(22, Math.round((bucketVal / maxVal) * 100));
          return (
            <div key={`${bucketVal}-${i}`} className="flex-1 flex flex-col items-center gap-0.5">
              <div className="w-full h-7 flex items-end">
                <div
                  className={`w-full rounded-t border border-[#141e1a] transition-all ${
                    isPlayer
                      ? metMedal
                        ? 'bg-[#26b557]'
                        : 'bg-[#f0861a]'
                      : isGoldBucket
                        ? 'bg-[#cdebd8]'
                        : 'bg-slate-200'
                  }`}
                  style={{ height: `${heightPct}%` }}
                  title={
                    isPlayer
                      ? `Ваш результат: ${bucketVal} ${unit}`
                      : `Ориентир: ${bucketVal} ${unit}`
                  }
                />
              </div>
              <span
                className={`text-[10px] font-mono-tabular leading-none ${
                  isPlayer ? 'font-extrabold text-[#141e1a]' : 'text-slate-500'
                }`}
              >
                {isPlayer ? `Вы:${bucketVal}` : bucketVal}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MathRevealCard({ reveal }: { reveal: MathRevealSpec }) {
  const [visibleSteps, setVisibleSteps] = useState<number>(1);
  const [animKey, setAnimKey] = useState<number>(0);

  useEffect(() => {
    setVisibleSteps(1);
    const total = reveal.steps.length;
    if (total <= 1) return;

    const timer = window.setInterval(() => {
      setVisibleSteps((curr) => {
        if (curr >= total) {
          window.clearInterval(timer);
          return curr;
        }
        return curr + 1;
      });
    }, 850);

    return () => window.clearInterval(timer);
  }, [reveal, animKey]);

  return (
    <div
      data-testid="victory-math-reveal"
      className="mb-3 rounded-xl border-2 border-[#141e1a] bg-[#f5f3ff] p-3"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-4 h-4 text-[#7c3aed] shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#5b21b6]">
              Математическая разгадка
            </div>
            <div className="font-display font-extrabold text-sm text-[#141e1a] leading-tight">
              {reveal.headline}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAnimKey((k) => k + 1)}
          aria-label="Повторить анимацию объяснения"
          className="cel-btn px-2 py-1 rounded-lg bg-white text-[11px] font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3 text-[#7c3aed]" />
          <span>Повторить</span>
        </button>
      </div>

      <div key={animKey} className="space-y-1.5">
        {reveal.steps.slice(0, visibleSteps).map((step, idx) => {
          const isCurrent = idx === visibleSteps - 1 && visibleSteps <= reveal.steps.length;
          return (
            <div
              key={`${animKey}-${idx}`}
              className={`math-step-enter rounded-lg border p-2 transition-colors ${
                isCurrent
                  ? 'border-[#7c3aed] bg-white'
                  : 'border-[#141e1a]/20 bg-white/85'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#6d28d9]">
                  {step.label}
                </span>
                <span className="font-mono-tabular font-extrabold text-xs px-2 py-0.5 rounded bg-[#ede9fe] text-[#141e1a] border border-[#7c3aed]/30">
                  {step.expression}
                </span>
              </div>
              <p className="text-[11px] text-slate-700 leading-snug">{step.caption}</p>
            </div>
          );
        })}
      </div>

      {visibleSteps >= reveal.steps.length && (
        <p className="math-step-enter mt-2 pt-1.5 border-t border-[#7c3aed]/20 text-[11px] font-medium text-[#3b0764] leading-snug">
          {reveal.summary}
        </p>
      )}
    </div>
  );
}

export function OutcomeModal({
  mode,
  level,
  world,
  playerBlockCount,
  area,
  hintsUsed = 0,
  verificationReport,
  hasNextLevel,
  onNextLevel,
  onReplay,
  onApplyDemo,
  onResume,
  onBackToTitle,
  onFixAndReset,
  onFocusError,
}: OutcomeModalProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);

  if (mode === 'error') {
    return (
      <div className="fixed top-56 left-3 right-3 sm:top-20 sm:left-auto sm:right-3 sm:max-w-sm z-20 cel-panel rounded-2xl p-4 border-red-900 bg-[#fff5f5]">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display font-bold text-sm text-red-950">
              Диагностика остановки (такт {world.tick})
            </h3>
            <p className="text-xs text-red-900 mt-1 leading-relaxed">
              {world.errorReason ?? 'Обнаружена ошибка в конструкции линии.'}
            </p>

            {verificationReport && verificationReport.passed < verificationReport.total && (
              <div className="mt-2.5 rounded-lg border border-red-900/25 bg-white p-2 space-y-1">
                <div className="text-[11px] font-bold text-red-950">
                  Проверка на всех входных наборах ({verificationReport.passed}/{verificationReport.total}):
                </div>
                {verificationReport.results.map((r, i) => (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-start justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1 min-w-0">
                        {r.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#26b557] shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        )}
                        <span className="truncate font-medium text-[#141e1a]">{r.name}</span>
                      </span>
                      <span className="font-mono-tabular text-slate-600 shrink-0">
                        {r.passed ? `${r.ticks} т.` : 'сбой'}
                      </span>
                    </div>
                    {!r.passed && r.reason && (
                      <div className="text-[10px] text-red-800 pl-4 leading-snug">
                        {r.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {world.errorHighlightHexes.length > 0 && onFocusError && (
                <button
                  type="button"
                  onClick={onFocusError}
                  className="cel-btn px-3 py-1.5 rounded-lg bg-white text-[#141e1a] text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5 text-red-600" />
                  <span>Показать узел</span>
                </button>
              )}
              <button
                type="button"
                onClick={onFixAndReset}
                className="cel-btn px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить и исправить</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
        <div className="cel-panel rounded-2xl max-w-sm w-full p-6 text-center">
          <h2 className="font-display text-2xl font-extrabold text-[#141e1a] mb-1">
            Пауза
          </h2>
          <p className="text-xs text-slate-600 mb-5">
            {level.title} · Такт {world.tick}
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="cel-btn w-full py-2.5 rounded-xl bg-[#26b557] text-white font-bold text-sm cursor-pointer"
            >
              Продолжить
            </button>
            <button
              type="button"
              onClick={onFixAndReset}
              className="cel-btn w-full py-2.5 rounded-xl bg-white text-[#141e1a] font-bold text-sm cursor-pointer"
            >
              Сбросить такты
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="cel-btn w-full py-2.5 rounded-xl bg-[#eef2ef] text-[#141e1a] font-semibold text-sm cursor-pointer"
            >
              В главное меню
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Victory Modal with 3-axis optimization medals & benchmark histograms
  const blocksGold = level.targets?.blocksGold ?? level.maxBlocksBonus ?? playerBlockCount;
  const ticksGold = level.targets?.ticksGold ?? level.maxTicksBonus ?? world.tick;
  const areaGold = level.targets?.areaGold ?? level.maxAreaBonus ?? area;

  const blocksMedal = playerBlockCount <= blocksGold;
  const ticksMedal = world.tick <= ticksGold;
  const areaMedal = area <= areaGold;
  const earnedMedalsCount = Number(blocksMedal) + Number(ticksMedal) + Number(areaMedal);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="cel-panel rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto cel-scroll p-5 sm:p-6 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-7 h-7 text-[#26b557] shrink-0" />
            <div>
              <h2 className="font-display text-2xl font-extrabold text-[#141e1a] leading-tight">
                Фабрика принята!
              </h2>
              <p className="text-xs text-slate-600">
                {level.title} · Медали: {earnedMedalsCount}/3 ·{' '}
                {hintsUsed > 0 ? `Подсказок: ${hintsUsed}` : 'Самостоятельно'}
              </p>
            </div>
          </div>
          {verificationReport && verificationReport.total > 0 && (
            <div
              data-testid="victory-verification-score"
              className="text-xs font-mono-tabular font-bold text-[#1f8f45] flex items-center gap-1 shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                Тесты алг.: {verificationReport.passed}/{verificationReport.total}
              </span>
            </div>
          )}
        </div>

        {/* 3 KPI Summary Cards */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-xl border-2 border-[#141e1a] bg-[#f4f8f5] p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500">Блоки</div>
            <div className="font-mono-tabular font-extrabold text-xl text-[#141e1a]">
              {playerBlockCount}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 mt-0.5 flex items-center justify-center gap-1">
              {blocksMedal ? (
                <span className="text-[#1f8f45] flex items-center gap-0.5">
                  <Award className="w-3 h-3" /> Медаль
                </span>
              ) : (
                <span>Норма ≤ {blocksGold}</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border-2 border-[#141e1a] bg-[#f4f8f5] p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500">Такты</div>
            <div className="font-mono-tabular font-extrabold text-xl text-[#141e1a]">
              {world.tick}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 mt-0.5 flex items-center justify-center gap-1">
              {ticksMedal ? (
                <span className="text-[#1f8f45] flex items-center gap-0.5">
                  <Award className="w-3 h-3" /> Медаль
                </span>
              ) : (
                <span>Норма ≤ {ticksGold}</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border-2 border-[#141e1a] bg-[#f4f8f5] p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500">Площадь</div>
            <div
              data-testid="victory-area-metric"
              className="font-mono-tabular font-extrabold text-xl text-[#141e1a]"
            >
              {area}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 mt-0.5 flex items-center justify-center gap-1">
              {areaMedal ? (
                <span className="text-[#1f8f45] flex items-center gap-0.5">
                  <Award className="w-3 h-3" /> Медаль
                </span>
              ) : (
                <span>Норма ≤ {areaGold}</span>
              )}
            </div>
          </div>
        </div>

        {level.mathReveal && <MathRevealCard reveal={level.mathReveal} />}

        {/* Benchmark Comparison Histograms */}
        {level.targets && (
          <div className="space-y-2 mb-3">
            <MetricHistogram
              label="Компактность (блоки)"
              value={playerBlockCount}
              goldThreshold={blocksGold}
              curve={level.targets.blocksCurve}
              unit="бл."
            />
            <MetricHistogram
              label="Скорость (такты)"
              value={world.tick}
              goldThreshold={ticksGold}
              curve={level.targets.ticksCurve}
              unit="т."
            />
            <MetricHistogram
              label="Площадь схемы (гексы)"
              value={area}
              goldThreshold={areaGold}
              curve={level.targets.areaCurve}
              unit="г."
            />
          </div>
        )}

        {verificationReport && verificationReport.results.length > 0 && (
          <div className="rounded-xl border border-[#141e1a]/20 bg-white px-3 py-2 text-xs mb-3 space-y-1">
            <div className="font-bold text-[#141e1a]">
              Проверенные наборы входных данных:
            </div>
            {verificationReport.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  {r.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#26b557] shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  )}
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="font-mono-tabular text-slate-600 shrink-0">
                  {r.passed ? `${r.ticks} т.` : 'ошибка'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Optional explanation reflection question */}
        {level.explainQuestion && (
          <div className="mb-3 rounded-xl border border-[#141e1a]/25 bg-white p-3">
            <div className="text-xs font-bold text-[#141e1a] mb-2">
              Вопрос «Почему это работает?»: {level.explainQuestion.prompt}
            </div>
            <div className="space-y-1.5">
              {level.explainQuestion.options.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedAnswer(idx)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedAnswer === idx
                      ? idx === level.explainQuestion!.correctIdx
                        ? 'bg-emerald-100 border-emerald-700 font-semibold text-emerald-950'
                        : 'bg-red-100 border-red-700 text-red-950'
                      : 'bg-slate-50 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {selectedAnswer !== null && (
              <div className="mt-2 text-[11px] text-slate-700">
                {level.explainQuestion.explanation}
              </div>
            )}
          </div>
        )}

        <div className="sticky -bottom-4 bg-[#f7faf8] pt-2.5 pb-1 mt-1 border-t border-[#141e1a]/15 flex flex-wrap items-center gap-2">
          {hasNextLevel && (
            <button
              type="button"
              data-start="true"
              onClick={onNextLevel}
              className="cel-btn flex-1 py-2.5 px-4 rounded-xl bg-[#26b557] text-white font-bold text-sm cursor-pointer whitespace-nowrap"
            >
              Следующий уровень
            </button>
          )}
          <button
            type="button"
            onClick={onReplay}
            className="cel-btn px-3.5 py-2.5 rounded-xl bg-white text-[#141e1a] font-bold text-sm cursor-pointer whitespace-nowrap"
          >
            Улучшить схему
          </button>
          {level.demoSolution && onApplyDemo && (
            <button
              type="button"
              onClick={onApplyDemo}
              className="cel-btn px-3.5 py-2.5 rounded-xl bg-[#fef3c7] text-[#141e1a] font-bold text-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Lightbulb className="w-4 h-4" />
              <span>Эталон</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
