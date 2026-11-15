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
  onApplyDemo?: (variantIdx: number) => void;
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
    <div className="rounded-xl border border-[#141e1a]/25 dark:border-slate-700/70 bg-white dark:bg-slate-900/70 p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <span className="font-bold text-[#141e1a] dark:text-slate-100">{label}</span>
        <span className="font-mono-tabular flex items-center gap-1.5">
          <span className="font-extrabold text-[#141e1a] dark:text-slate-100">
            {value} {unit}
          </span>
          <span className="text-slate-400">·</span>
          {metMedal ? (
            <span className="text-[#1f8f45] dark:text-emerald-400 font-bold flex items-center gap-0.5">
              <Award className="w-3.5 h-3.5" />
              Медаль (≤ {goldThreshold})
            </span>
          ) : (
            <span className="text-slate-600 dark:text-slate-400 flex items-center gap-0.5">
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
                  className={`w-full rounded-t border border-[#141e1a] dark:border-slate-700 transition-all ${
                    isPlayer
                      ? metMedal
                        ? 'bg-[#26b557] dark:bg-emerald-500'
                        : 'bg-[#f0861a] dark:bg-amber-500'
                      : isGoldBucket
                        ? 'bg-[#cdebd8] dark:bg-emerald-950/70'
                        : 'bg-slate-200 dark:bg-slate-800'
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
                  isPlayer
                    ? 'font-extrabold text-[#141e1a] dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400'
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
      className="mb-3 rounded-xl border border-[#141e1a] dark:border-violet-500/45 bg-[#f5f3ff] dark:bg-violet-950/35 p-3"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-4 h-4 text-[#7c3aed] dark:text-violet-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#5b21b6] dark:text-violet-300">
              Математическая разгадка
            </div>
            <div className="font-display font-extrabold text-sm text-[#141e1a] dark:text-slate-100 leading-tight">
              {reveal.headline}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAnimKey((k) => k + 1)}
          aria-label="Повторить анимацию объяснения"
          className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3 text-[#7c3aed] dark:text-violet-400" />
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
                  ? 'border-[#7c3aed] dark:border-violet-400 bg-white dark:bg-slate-900/90'
                  : 'border-[#141e1a]/20 dark:border-slate-700/70 bg-white/85 dark:bg-slate-900/60'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#6d28d9] dark:text-violet-300">
                  {step.label}
                </span>
                <span className="font-mono-tabular font-extrabold text-xs px-2 py-0.5 rounded bg-[#ede9fe] dark:bg-violet-900/50 text-[#141e1a] dark:text-violet-100 border border-[#7c3aed]/30 dark:border-violet-500/40">
                  {step.expression}
                </span>
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug">{step.caption}</p>
            </div>
          );
        })}
      </div>

      {visibleSteps >= reveal.steps.length && (
        <p className="math-step-enter mt-2 pt-1.5 border-t border-[#7c3aed]/20 dark:border-violet-500/30 text-[11px] font-medium text-[#3b0764] dark:text-violet-200 leading-snug">
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
      <div className="fixed top-40 left-3 right-3 sm:top-16 sm:left-auto sm:right-3 sm:max-w-sm z-20 hud-panel rounded-2xl p-4 border-red-900 dark:border-rose-500/50 bg-[#fff5f5] dark:bg-[#1e1015]">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="font-display font-bold text-sm text-red-950 dark:text-rose-100">
              Диагностика остановки (такт {world.tick})
            </h3>
            <p className="text-xs text-red-900 dark:text-rose-200/90 mt-1 leading-relaxed">
              {world.errorReason ?? 'Обнаружена ошибка в конструкции линии.'}
            </p>

            {verificationReport && verificationReport.passed < verificationReport.total && (
              <div className="mt-2.5 rounded-lg border border-red-900/25 dark:border-rose-500/35 bg-white dark:bg-slate-900/80 p-2 space-y-1">
                <div className="text-[11px] font-bold text-red-950 dark:text-rose-200">
                  Проверка на всех входных наборах ({verificationReport.passed}/{verificationReport.total}):
                </div>
                {verificationReport.results.map((r, i) => (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-start justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1 min-w-0">
                        {r.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#26b557] dark:text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-rose-400 shrink-0" />
                        )}
                        <span className="truncate font-medium text-[#141e1a] dark:text-slate-200">{r.name}</span>
                      </span>
                      <span className="font-mono-tabular text-slate-600 dark:text-slate-400 shrink-0">
                        {r.passed ? `${r.ticks} т.` : 'сбой'}
                      </span>
                    </div>
                    {!r.passed && r.reason && (
                      <div className="text-[10px] text-red-800 dark:text-rose-300 pl-4 leading-snug">
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
                  className="hud-btn px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-100 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5 text-red-600 dark:text-rose-400" />
                  <span>Показать узел</span>
                </button>
              )}
              <button
                type="button"
                onClick={onFixAndReset}
                className="hud-btn px-3 py-1.5 rounded-lg bg-red-600 dark:bg-rose-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
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
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
        <div className="hud-panel rounded-2xl max-w-sm w-full p-6 text-center">
          <h2 className="font-display text-2xl font-extrabold text-[#141e1a] dark:text-slate-100 mb-1">
            Пауза
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">
            {level.title} · Такт {world.tick}
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="hud-btn w-full py-2.5 rounded-xl bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 font-bold text-sm cursor-pointer"
            >
              Продолжить
            </button>
            <button
              type="button"
              onClick={onFixAndReset}
              className="hud-btn w-full py-2.5 rounded-xl bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-100 font-bold text-sm cursor-pointer"
            >
              Сбросить такты
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="hud-btn w-full py-2.5 rounded-xl bg-[#eef5f1] dark:bg-slate-800/70 text-[#141e1a] dark:text-slate-300 font-semibold text-sm cursor-pointer"
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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-label="Результаты уровня"
        className="hud-panel rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto cel-scroll p-5 sm:p-6 pb-3">
          <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-7 h-7 text-[#26b557] dark:text-emerald-400 shrink-0" />
            <div>
              <h2 className="font-display text-2xl font-extrabold text-[#141e1a] dark:text-slate-100 leading-tight">
                Фабрика принята!
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {level.title} · Медали: {earnedMedalsCount}/3 ·{' '}
                {hintsUsed > 0 ? `Подсказок: ${hintsUsed}` : 'Самостоятельно'}
              </p>
            </div>
          </div>
          {verificationReport && verificationReport.total > 0 && (
            <div
              data-testid="victory-verification-score"
              className="text-xs font-mono-tabular font-bold text-[#1f8f45] dark:text-emerald-400 flex items-center gap-1 shrink-0"
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
          <div className="rounded-xl border border-[#141e1a] dark:border-slate-700/70 bg-[#f4f8f5] dark:bg-slate-900/75 p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Блоки</div>
            <div className="font-mono-tabular font-extrabold text-xl text-[#141e1a] dark:text-slate-100">
              {playerBlockCount}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 dark:text-slate-400 mt-0.5 flex items-center justify-center gap-1">
              {blocksMedal ? (
                <span className="text-[#1f8f45] dark:text-emerald-400 flex items-center gap-0.5">
                  <Award className="w-3 h-3" /> Медаль
                </span>
              ) : (
                <span>Норма ≤ {blocksGold}</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#141e1a] dark:border-slate-700/70 bg-[#f4f8f5] dark:bg-slate-900/75 p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Такты</div>
            <div className="font-mono-tabular font-extrabold text-xl text-[#141e1a] dark:text-slate-100">
              {world.tick}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 dark:text-slate-400 mt-0.5 flex items-center justify-center gap-1">
              {ticksMedal ? (
                <span className="text-[#1f8f45] dark:text-emerald-400 flex items-center gap-0.5">
                  <Award className="w-3 h-3" /> Медаль
                </span>
              ) : (
                <span>Норма ≤ {ticksGold}</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#141e1a] dark:border-slate-700/70 bg-[#f4f8f5] dark:bg-slate-900/75 p-2.5 text-center">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Площадь</div>
            <div
              data-testid="victory-area-metric"
              className="font-mono-tabular font-extrabold text-xl text-[#141e1a] dark:text-slate-100"
            >
              {area}
            </div>
            <div className="text-[11px] font-mono-tabular font-bold text-slate-600 dark:text-slate-400 mt-0.5 flex items-center justify-center gap-1">
              {areaMedal ? (
                <span className="text-[#1f8f45] dark:text-emerald-400 flex items-center gap-0.5">
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
          <div className="rounded-xl border border-[#141e1a]/20 dark:border-slate-700/70 bg-white dark:bg-slate-900/75 px-3 py-2 text-xs mb-3 space-y-1">
            <div className="font-bold text-[#141e1a] dark:text-slate-100">
              Проверенные наборы входных данных:
            </div>
            {verificationReport.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  {r.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#26b557] dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-rose-400 shrink-0" />
                  )}
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="font-mono-tabular text-slate-600 dark:text-slate-400 shrink-0">
                  {r.passed ? `${r.ticks} т.` : 'ошибка'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Optional explanation reflection question */}
        {level.explainQuestion && (
          <div className="mb-3 rounded-xl border border-[#141e1a]/25 dark:border-slate-700/70 bg-white dark:bg-slate-900/75 p-3">
            <div className="text-xs font-bold text-[#141e1a] dark:text-slate-100 mb-2">
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
                        ? 'bg-emerald-100 dark:bg-emerald-950/70 border-emerald-700 dark:border-emerald-500 font-semibold text-emerald-950 dark:text-emerald-200'
                        : 'bg-red-100 dark:bg-rose-950/70 border-red-700 dark:border-rose-500 text-red-950 dark:text-rose-200'
                      : 'bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-[#141e1a] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {selectedAnswer !== null && (
              <div className="mt-2 text-[11px] text-slate-700 dark:text-slate-300">
                {level.explainQuestion.explanation}
              </div>
            )}
          </div>
        )}
        </div>

        <div className="shrink-0 bg-[#f7faf8] dark:bg-[#0d131c] px-5 sm:px-6 py-3 border-t border-[#141e1a]/15 dark:border-slate-700/70 flex flex-wrap items-center gap-1.5 sm:gap-2">
          {hasNextLevel && (
            <button
              type="button"
              data-start="true"
              onClick={onNextLevel}
              className="hud-btn flex-1 min-w-[155px] py-2 px-3 rounded-xl bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 font-bold text-xs sm:text-[13px] cursor-pointer whitespace-nowrap"
            >
              Следующий уровень
            </button>
          )}
          <button
            type="button"
            onClick={onReplay}
            className="hud-btn px-3 py-2 rounded-xl bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-100 font-bold text-xs sm:text-[13px] cursor-pointer whitespace-nowrap"
          >
            Улучшить схему
          </button>
          {level.demoSolution && onApplyDemo && (
            level.altDemoSolutions && level.altDemoSolutions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onApplyDemo(0)}
                  title={level.demoLabel ?? 'Эталон 1'}
                  className="hud-btn px-2.5 py-2 rounded-xl bg-[#fef3c7] dark:bg-amber-400/20 text-[#141e1a] dark:text-amber-200 dark:border-amber-400/40 font-bold text-xs sm:text-[13px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                  <span>Эталон 1</span>
                </button>
                {level.altDemoSolutions.map((alt, idx) => (
                  <button
                    key={alt.label}
                    type="button"
                    onClick={() => onApplyDemo(idx + 1)}
                    title={alt.description ?? alt.label}
                    className="hud-btn px-2.5 py-2 rounded-xl bg-[#eef5f1] dark:bg-slate-800 text-[#141e1a] dark:text-slate-200 font-bold text-xs sm:text-[13px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                    <span>Эталон {idx + 2}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onApplyDemo(0)}
                className="hud-btn px-3 py-2 rounded-xl bg-[#fef3c7] dark:bg-amber-400/20 text-[#141e1a] dark:text-amber-200 dark:border-amber-400/40 font-bold text-xs sm:text-[13px] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                <span>Эталон</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
