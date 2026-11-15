import { X } from 'lucide-react';
import type { LevelDefinition, OnboardingStep } from '../engine/types';

interface OnboardingOverlayProps {
  level: LevelDefinition;
  step: OnboardingStep | null;
  stepIndex: number;
  totalSteps: number;
  helpOpen: boolean;
  onDismissHelp: () => void;
  onDismissOnboarding: () => void;
}

export function OnboardingOverlay({
  level,
  step,
  stepIndex,
  totalSteps,
  helpOpen,
  onDismissHelp,
  onDismissOnboarding,
}: OnboardingOverlayProps) {
  if (helpOpen) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
        <div className="hud-panel rounded-2xl max-w-lg w-full max-h-[88vh] overflow-y-auto cel-scroll p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl font-extrabold text-[#141e1a] dark:text-slate-100">
              Инженерный справочник
            </h2>
            <button
              type="button"
              onClick={onDismissHelp}
              aria-label="Закрыть справку"
              className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <div>
              <strong className="text-[#141e1a] dark:text-white">1. Точная целочисленная математика:</strong>{' '}
              числа лежат в диапазоне [-999, 999]. <strong>÷2</strong> делит только чётные числа
              (включая отрицательные и 0); нечётное вызывает остановку. <strong>√x</strong> работает
              только для квадратов (0, 1, 4, 9…). <strong>Инвертор (−x)</strong> меняет знак числа,
              а <strong>Дубликатор (=)</strong> выводит копию числа на второй порт.
            </div>
            <div>
              <strong className="text-[#141e1a] dark:text-white">2. Циклы и скрытые проверки:</strong>{' '}
              <strong>Фильтр</strong> и <strong>÷r</strong> (настраиваются через{' '}
              <strong>Выбор [V]</strong>) позволяют зацикливать поток обратно до выполнения
              условия. Бесконечный цикл останавливается на 180 тактах с диагностикой. После доставки
              видимого потока алгоритм проверяется на скрытых входных наборах.
            </div>
            <div>
              <strong className="text-[#141e1a] dark:text-white">3. Полимеры, разломы и магниты:</strong>{' '}
              Сварщик соединяет соседние сферы в твёрдый полимер, <strong>Ротатор</strong>{' '}
              поворачивает его на 60°, <strong>Лазер</strong> разрезает связь, а{' '}
              <strong>Магнит</strong> перетягивает свободные сферы на 1–2 гекса — в том числе
              через разломы платформы. <strong>Разделитель (⇄)</strong> чередует потоки между двумя
              портами A/B, а <strong>Утилизатор (×)</strong> безопасно перерабатывает лишние сферы и полимеры.
            </div>
            <div>
              <strong className="text-[#141e1a] dark:text-white">4. Бюджет, медали и управление:</strong>{' '}
              следите за лимитами деталей и оптимизируйте 3 оси: <strong>Блоки</strong>,{' '}
              <strong>Такты</strong> и <strong>Площадь</strong>. ЛКМ — поставить/повернуть; ПКМ —
              удалить; <kbd className="px-1 border rounded dark:border-slate-600">V</kbd> — инспектор;{' '}
              <kbd className="px-1 border rounded dark:border-slate-600">R</kbd> — поворот;{' '}
              <kbd className="px-1 border rounded dark:border-slate-600">I</kbd> — условие задачи;{' '}
              <kbd className="px-1 border rounded dark:border-slate-600">Ctrl+Z</kbd> — отмена;{' '}
              <kbd className="px-1 border rounded dark:border-slate-600">Пробел</kbd> — пуск/пауза;{' '}
              <kbd className="px-1 border rounded dark:border-slate-600">WASD</kbd> / колесо мыши — камера.
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onDismissHelp}
              className="hud-btn px-4 py-2 rounded-xl bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 text-xs font-bold cursor-pointer"
            >
              Понятно
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!step) return null;

  return (
    <aside
      aria-label="Онбординг"
      className="fixed top-40 sm:top-16 left-3 right-3 sm:right-auto z-20 sm:max-w-xs hud-panel rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-bold text-[#26b557] dark:text-emerald-400">
          Обучение · {stepIndex + 1}/{totalSteps}
        </span>
        <button
          type="button"
          onClick={onDismissOnboarding}
          aria-label="Пропустить обучение"
          className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-black dark:hover:text-white cursor-pointer"
        >
          Пропустить
        </button>
      </div>
      <h3 className="font-display font-bold text-sm text-[#141e1a] dark:text-slate-100 mb-1">
        {step.title}
      </h3>
      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mb-2">
        {step.body}
      </p>
      <div className="text-[11px] font-bold text-[#141e1a] dark:text-amber-200 bg-[#eef5f1] dark:bg-amber-500/15 px-2.5 py-1 rounded-lg border border-[#141e1a]/25 dark:border-amber-400/35">
        {step.actionHint}
      </div>
      {level.pedagogyNote && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          {level.pedagogyNote}
        </p>
      )}
    </aside>
  );
}
