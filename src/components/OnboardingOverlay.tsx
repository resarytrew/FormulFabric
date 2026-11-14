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
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
        <div className="cel-panel rounded-2xl max-w-lg w-full max-h-[88vh] overflow-y-auto cel-scroll p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl font-extrabold text-[#141e1a]">
              Инженерный справочник
            </h2>
            <button
              type="button"
              onClick={onDismissHelp}
              aria-label="Закрыть справку"
              className="cel-btn p-1.5 rounded-lg bg-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
            <div>
              <strong className="text-[#141e1a]">1. Точная целочисленная математика:</strong>{' '}
              числа лежат в диапазоне [-999, 999]. <strong>÷2</strong> делит только чётные числа
              (включая отрицательные и 0); нечётное вызывает остановку. <strong>√x</strong> работает
              только для квадратов (0, 1, 4, 9…). <strong>Инвертор (−x)</strong> меняет знак числа,
              а <strong>Дубликатор (=)</strong> выводит копию числа на второй порт.
            </div>
            <div>
              <strong className="text-[#141e1a]">2. Циклы и скрытые проверки:</strong>{' '}
              <strong>Фильтр</strong> и <strong>÷r</strong> (настраиваются через{' '}
              <strong>Выбор [V]</strong>) позволяют зацикливать поток обратно до выполнения
              условия. Бесконечный цикл останавливается на 180 тактах с диагностикой. После доставки
              видимого потока алгоритм проверяется на скрытых входных наборах.
            </div>
            <div>
              <strong className="text-[#141e1a]">3. Полимеры, разломы и магниты:</strong>{' '}
              Сварщик соединяет соседние сферы в твёрдый полимер, <strong>Ротатор</strong>{' '}
              поворачивает его на 60°, <strong>Лазер</strong> разрезает связь, а{' '}
              <strong>Магнит</strong> перетягивает свободные сферы на 1–2 гекса — в том числе
              через разломы платформы. <strong>Разделитель (⇄)</strong> чередует потоки между двумя
              портами A/B, а <strong>Утилизатор (×)</strong> безопасно перерабатывает лишние сферы и полимеры.
            </div>
            <div>
              <strong className="text-[#141e1a]">4. Бюджет, медали и управление:</strong>{' '}
              следите за лимитами деталей и оптимизируйте 3 оси: <strong>Блоки</strong>,{' '}
              <strong>Такты</strong> и <strong>Площадь</strong>. ЛКМ — поставить/повернуть; ПКМ —
              удалить; <kbd className="px-1 border rounded">V</kbd> — инспектор;{' '}
              <kbd className="px-1 border rounded">R</kbd> — поворот;{' '}
              <kbd className="px-1 border rounded">Ctrl+Z</kbd> — отмена;{' '}
              <kbd className="px-1 border rounded">Пробел</kbd> — пуск/пауза;{' '}
              <kbd className="px-1 border rounded">WASD</kbd> / колесо мыши — камера.
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onDismissHelp}
              className="cel-btn px-4 py-2 rounded-xl bg-[#26b557] text-white text-xs font-bold cursor-pointer"
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
      className="fixed top-56 sm:top-20 left-3 right-3 sm:right-auto z-20 sm:max-w-xs cel-panel rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-bold text-[#26b557]">
          Обучение · {stepIndex + 1}/{totalSteps}
        </span>
        <button
          type="button"
          onClick={onDismissOnboarding}
          aria-label="Пропустить обучение"
          className="text-[11px] font-semibold text-slate-500 hover:text-black cursor-pointer"
        >
          Пропустить
        </button>
      </div>
      <h3 className="font-display font-bold text-sm text-[#141e1a] mb-1">
        {step.title}
      </h3>
      <p className="text-xs text-slate-700 leading-relaxed mb-2">
        {step.body}
      </p>
      <div className="text-[11px] font-bold text-[#141e1a] bg-[#eef5f1] px-2.5 py-1 rounded-lg border border-[#141e1a]/25">
        {step.actionHint}
      </div>
      {level.pedagogyNote && (
        <p className="mt-2 text-[11px] text-slate-500 leading-snug">
          {level.pedagogyNote}
        </p>
      )}
    </aside>
  );
}
