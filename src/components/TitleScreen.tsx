import { Moon, Sun } from 'lucide-react';
import type { PaletteThemeId } from '../render/celMaterials';
import type { UiStyleMode } from './TopHud';

interface TitleScreenProps {
  onStartCampaign: () => void;
  onStartSandbox: () => void;
  onOpenLevels: () => void;
  theme: PaletteThemeId;
  onChangeTheme: (t: PaletteThemeId) => void;
  uiStyle: UiStyleMode;
  onToggleUiStyle: () => void;
  completedCount: number;
  totalLevels: number;
}

export function TitleScreen({
  onStartCampaign,
  onStartSandbox,
  onOpenLevels,
  theme,
  onChangeTheme,
  uiStyle,
  onToggleUiStyle,
  completedCount,
  totalLevels,
}: TitleScreenProps) {
  const isSkyline = uiStyle === 'skyline';

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 md:p-10">
      {/* Top minimal row: UI Style switch + 3D Palette + Progress */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 hud-panel rounded-xl px-2.5 py-1.5 text-xs font-semibold">
          <button
            type="button"
            onClick={onToggleUiStyle}
            aria-label="Переключить стиль интерфейса"
            className="px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/10 text-[#141e1a] dark:text-slate-100 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {isSkyline ? (
              <Moon className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span>{isSkyline ? 'Skylines' : 'Классика'}</span>
          </button>

          <span className="text-slate-400 dark:text-slate-600 px-0.5">|</span>

          {(['workshop', 'emerald', 'sky', 'mono'] as PaletteThemeId[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChangeTheme(t)}
              className={`px-2 py-1 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                theme === t
                  ? 'bg-[#141e1a] dark:bg-amber-400 text-white dark:text-slate-950 font-bold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              {t === 'workshop'
                ? 'Мастерская'
                : t === 'emerald'
                  ? 'Изумруд'
                  : t === 'sky'
                    ? 'Лазурь'
                    : 'Графит'}
            </button>
          ))}
        </div>

        {completedCount > 0 && (
          <div className="pointer-events-auto hud-panel rounded-xl px-3.5 py-1.5 text-xs font-semibold font-mono-tabular">
            Пройдено: {completedCount}/{totalLevels}
          </div>
        )}
      </div>

      {/* Left negative-space focal lockup */}
      <div
        className={`max-w-lg pointer-events-auto rounded-2xl p-6 md:p-8 ${
          isSkyline
            ? 'bg-[#0b111a]/82 border border-white/12 shadow-2xl text-slate-100'
            : 'hud-panel'
        }`}
      >
        {/* Bespoke inline SVG emblem */}
        <div className="mb-4 flex items-center gap-3.5">
          <svg
            viewBox="0 0 64 64"
            className="w-14 h-14 shrink-0"
            aria-hidden="true"
          >
            <polygon
              points="32,4 56,18 56,46 32,60 8,46 8,18"
              fill={isSkyline ? '#162536' : '#99dab8'}
              stroke={isSkyline ? '#22d3ee' : '#141e1a'}
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            <circle
              cx="23"
              cy="32"
              r="9"
              fill="#26b557"
              stroke="#0f172a"
              strokeWidth="3"
            />
            <circle
              cx="42"
              cy="32"
              r="9"
              fill="#f59e0b"
              stroke="#0f172a"
              strokeWidth="3"
            />
            <line
              x1="31"
              y1="32"
              x2="34"
              y2="32"
              stroke={isSkyline ? '#f1f5f9' : '#141e1a'}
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            <text
              x="23"
              y="36"
              textAnchor="middle"
              fontSize="11"
              fontWeight="800"
              fill="#ffffff"
              fontFamily="JetBrains Mono, monospace"
            >
              2
            </text>
            <text
              x="42"
              y="36"
              textAnchor="middle"
              fontSize="11"
              fontWeight="800"
              fill="#ffffff"
              fontFamily="JetBrains Mono, monospace"
            >
              4
            </text>
          </svg>
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-[#141e1a] dark:text-white leading-none">
              Фабрика чисел
            </h1>
            <p className="mt-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              Математика · Движение · Автоматизация
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-6">
          Стройте автономные конвейеры, сваривайте числовые сферы в полимеры и находите компактные решения на гексагональном поле.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onStartCampaign}
            className="hud-btn px-6 py-2.5 rounded-xl bg-[#26b557] dark:bg-emerald-500 text-white dark:text-slate-950 font-bold text-base cursor-pointer whitespace-nowrap"
          >
            {completedCount > 0 ? 'Продолжить' : 'Начать игру'}
          </button>
          <button
            type="button"
            onClick={onOpenLevels}
            className="hud-btn px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-100 font-semibold text-sm cursor-pointer whitespace-nowrap"
          >
            Уровни ({totalLevels})
          </button>
          <button
            type="button"
            onClick={onStartSandbox}
            className="hud-btn px-4 py-2.5 rounded-xl bg-[#f4f7f5] dark:bg-slate-800/70 text-[#141e1a] dark:text-slate-200 font-semibold text-sm cursor-pointer whitespace-nowrap"
          >
            Песочница
          </button>
        </div>
      </div>

      {/* Bottom borderless inline control hint */}
      <div className="text-center">
        <span className="inline-block px-4 py-1.5 rounded-lg bg-[#0b111a]/80 text-white/90 text-xs font-medium tracking-wide border border-white/10">
          Enter Старт · ЛКМ Поставить · ПКМ Удалить · R Поворот · WASD Камера
        </span>
      </div>
    </div>
  );
}
