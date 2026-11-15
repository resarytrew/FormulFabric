import {
  Camera,
  HelpCircle,
  Layers,
  Moon,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { LevelDefinition, SimulationWorld } from '../engine/types';
import type { PaletteThemeId } from '../render/celMaterials';

export type UiStyleMode = 'skyline' | 'classic';

interface TopHudProps {
  level: LevelDefinition;
  world: SimulationWorld;
  isPlaying: boolean;
  canStepBack: boolean;
  simSpeed: 1 | 2 | 4;
  theme: PaletteThemeId;
  uiStyle: UiStyleMode;
  muted: boolean;
  continuousCamera: boolean;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStep: () => void;
  onReset: () => void;
  onCycleSpeed: () => void;
  onOpenLevels: () => void;
  onChangeTheme: (t: PaletteThemeId) => void;
  onToggleUiStyle: () => void;
  onResetCamera: () => void;
  onToggleContinuousCamera: () => void;
  onToggleMute: () => void;
  onToggleHelp: () => void;
  onOpenPause: () => void;
}

export function TopHud({
  level,
  world,
  isPlaying,
  canStepBack,
  simSpeed,
  theme,
  uiStyle,
  muted,
  continuousCamera,
  onTogglePlay,
  onStepBack,
  onStep,
  onReset,
  onCycleSpeed,
  onOpenLevels,
  onChangeTheme,
  onToggleUiStyle,
  onResetCamera,
  onToggleContinuousCamera,
  onToggleMute,
  onToggleHelp,
  onOpenPause,
}: TopHudProps) {
  const sinkLabels = Array.from(world.machines.values())
    .filter((m) => m.type === 'sink' && m.config.targetPattern)
    .map((m) => m.config.targetPattern!.label);

  const badgeText =
    level.id === 'sandbox'
      ? 'Песочница'
      : level.chapter === 'grade5'
        ? `5 кл. G${level.index}`
        : level.chapter === 'eureka'
          ? `Эврика E${level.index}`
          : level.chapter === 'impossible'
            ? `Невозм. N${level.index}`
            : `Задача ${level.index}`;

  const hasHiddenTests = Boolean(level.verificationRuns?.some((r) => r.hidden));
  const isSkyline = uiStyle === 'skyline';

  return (
    <header className="fixed top-2.5 left-3 right-3 z-20 pointer-events-none flex flex-wrap lg:flex-nowrap items-start justify-between gap-2">
      {/* Left Zone: Minimal borderless Skylines title lockup (or classic card) */}
      <div
        className={`pointer-events-auto flex items-center gap-2.5 max-w-full min-w-0 shrink transition-colors ${
          isSkyline
            ? 'rounded-xl px-2.5 py-1.5 bg-[#0b111a]/72 border border-white/10 shadow-lg'
            : 'hud-panel rounded-xl px-2.5 sm:px-3 py-1.5'
        }`}
      >
        <button
          type="button"
          onClick={onOpenLevels}
          aria-label="Выбрать уровень"
          className={`hud-btn px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
            isSkyline
              ? 'bg-amber-500/15 text-amber-300 border-amber-400/35 hover:bg-amber-500/25'
              : 'bg-[#eef5f1] text-[#141e1a]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{badgeText}</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[13px] sm:text-sm text-[#141e1a] dark:text-slate-100 leading-tight truncate sm:max-w-[230px]">
            {level.title}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 font-medium truncate sm:max-w-[280px]">
            Цель:{' '}
            <span className="font-mono-tabular font-bold text-[#141e1a] dark:text-cyan-300">
              {sinkLabels.join(' | ') || 'Свободная'}
            </span>
            {hasHiddenTests && (
              <span
                data-testid="hud-hidden-tests"
                title="После доставки видимого потока схема автоматически проверяется на скрытых тестовых наборах"
                className="text-slate-500 dark:text-slate-400 font-normal"
              >
                {' '}· + скрытые
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Center Zone: Compact Simulation Transport Pill */}
      <div className="pointer-events-auto hud-panel rounded-xl px-2 py-1.5 flex items-center gap-1 max-w-full">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Пауза симуляции' : 'Запуск симуляции'}
          className={`hud-btn px-3 py-1 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
            isPlaying
              ? 'bg-amber-600 dark:bg-amber-500 dark:text-slate-950'
              : 'bg-[#26b557] dark:bg-emerald-500 dark:text-slate-950'
          }`}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isPlaying ? 'Стоп' : 'Пуск'}</span>
        </button>

        <button
          type="button"
          onClick={onStepBack}
          disabled={isPlaying || !canStepBack}
          aria-label="Один такт назад"
          title="На шаг назад"
          className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-xs font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <SkipBack className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Назад</span>
        </button>

        <button
          type="button"
          onClick={onStep}
          disabled={isPlaying || world.status === 'victory' || world.status === 'error'}
          aria-label="Один такт вперёд"
          className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-xs font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <SkipForward className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Шаг</span>
        </button>

        <button
          type="button"
          onClick={onCycleSpeed}
          aria-label="Скорость симуляции"
          className="hud-btn px-2 py-1 rounded-lg bg-[#f3f6f4] dark:bg-slate-800/90 text-xs font-bold font-mono-tabular text-[#141e1a] dark:text-cyan-300 cursor-pointer whitespace-nowrap"
        >
          {simSpeed}×
        </button>

        <button
          type="button"
          onClick={onReset}
          aria-label="Сбросить симуляцию"
          title="Сброс симуляции"
          className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-xs font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Сброс</span>
        </button>
      </div>

      {/* Right Zone: Minimal Style Switch, 3D Palette & Utility Icons */}
      <div className="pointer-events-auto hud-panel rounded-xl px-2 py-1.5 flex items-center gap-1 shrink-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleUiStyle();
          }}
          aria-label="Переключить стиль интерфейса"
          data-testid="ui-style-toggle"
          title={
            isSkyline
              ? 'Стиль: Тёмный Skylines (нажмите для Светлой классики)'
              : 'Стиль: Светлая классика (нажмите для Тёмного Skylines)'
          }
          className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-xs font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          {isSkyline ? (
            <Moon className="w-3.5 h-3.5 text-cyan-400" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-amber-500" />
          )}
          <span className="hidden xl:inline">
            {isSkyline ? 'Skylines' : 'Классика'}
          </span>
        </button>

        <select
          aria-label="Цветовая тема"
          value={theme}
          onChange={(e) => onChangeTheme(e.target.value as PaletteThemeId)}
          className="text-xs font-bold bg-[#f3f6f4] dark:bg-slate-800/90 border border-[#141e1a] dark:border-slate-600/60 rounded-lg px-2 py-1 text-[#141e1a] dark:text-slate-200 cursor-pointer"
        >
          <option value="workshop">Мастерская</option>
          <option value="emerald">Изумруд</option>
          <option value="sky">Лазурь</option>
          <option value="mono">Графит</option>
        </select>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleContinuousCamera();
          }}
          aria-pressed={continuousCamera}
          aria-label="Непрерывная камера (авто-обзор)"
          title="Непрерывный облёт камеры"
          className={`hud-btn p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
            continuousCamera
              ? 'bg-[#16a3b8] text-white'
              : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200'
          }`}
        >
          <Orbit className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onResetCamera();
          }}
          aria-label="Сбросить камеру"
          title="Сбросить камеру"
          className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
        >
          <Camera className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          title="Звук [M]"
          className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleHelp();
          }}
          aria-label="Справка и подсказки"
          title="Справка"
          className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenPause();
          }}
          aria-label="Меню паузы"
          title="Пауза [Esc]"
          className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
        >
          <Pause className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
