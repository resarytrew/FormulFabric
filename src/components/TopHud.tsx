import {
  Camera,
  HelpCircle,
  Layers,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { LevelDefinition, SimulationWorld } from '../engine/types';
import type { PaletteThemeId } from '../render/celMaterials';

interface TopHudProps {
  level: LevelDefinition;
  world: SimulationWorld;
  isPlaying: boolean;
  canStepBack: boolean;
  simSpeed: 1 | 2 | 4;
  theme: PaletteThemeId;
  muted: boolean;
  playerBlockCount: number;
  area: number;
  continuousCamera: boolean;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStep: () => void;
  onReset: () => void;
  onCycleSpeed: () => void;
  onOpenLevels: () => void;
  onChangeTheme: (t: PaletteThemeId) => void;
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
  muted,
  playerBlockCount,
  area,
  continuousCamera,
  onTogglePlay,
  onStepBack,
  onStep,
  onReset,
  onCycleSpeed,
  onOpenLevels,
  onChangeTheme,
  onResetCamera,
  onToggleContinuousCamera,
  onToggleMute,
  onToggleHelp,
  onOpenPause,
}: TopHudProps) {
  // Find target summary label from sinks
  const sinkLabels = Array.from(world.machines.values())
    .filter((m) => m.type === 'sink' && m.config.targetPattern)
    .map((m) => m.config.targetPattern!.label);

  const badgeText =
    level.id === 'sandbox'
      ? 'Песочница'
      : level.chapter === 'eureka'
        ? `Эврика E${level.index}`
        : `Уровень ${level.index}`;

  const atBlockLimit =
    level.maxTotalBlocks !== undefined && playerBlockCount >= level.maxTotalBlocks;
  const hasHiddenTests = Boolean(level.verificationRuns?.some((r) => r.hidden));

  return (
    <header className="fixed top-2.5 left-2.5 right-2.5 z-20 pointer-events-none flex flex-wrap lg:flex-nowrap items-center justify-between gap-2">
      {/* Left Zone: Level & Goal */}
      <div className="pointer-events-auto cel-panel rounded-xl px-2.5 sm:px-3 py-1.5 flex items-center gap-2.5 max-w-full min-w-0 shrink">
        <button
          type="button"
          onClick={onOpenLevels}
          aria-label="Выбрать уровень"
          className="cel-btn px-2.5 py-1 rounded-lg bg-[#eef5f1] text-xs font-bold text-[#141e1a] flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{badgeText}</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[13px] sm:text-sm text-[#141e1a] leading-tight truncate sm:max-w-[240px]">
            {level.title}
          </div>
          <div className="text-[11px] text-slate-600 font-medium truncate sm:max-w-[290px]">
            Цель:{' '}
            <span className="font-mono-tabular font-bold text-[#141e1a]">
              {sinkLabels.join(' | ') || 'Свободная'}
            </span>
            {hasHiddenTests && (
              <span
                data-testid="hud-hidden-tests"
                title="После доставки видимого потока схема автоматически проверяется на скрытых тестовых наборах"
                className="text-slate-500 font-normal"
              >
                {' '}· + скрытые
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Center Zone: Simulation Transport & Live Tabular Telemetry */}
      <div className="pointer-events-auto cel-panel rounded-xl px-2.5 py-1.5 flex flex-wrap items-center justify-center gap-2 max-w-full">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Пауза симуляции' : 'Запуск симуляции'}
            className={`cel-btn px-3 py-1 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              isPlaying ? 'bg-[#e67e22]' : 'bg-[#26b557]'
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
            className="cel-btn px-2 py-1 rounded-lg bg-white text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Назад</span>
          </button>

          <button
            type="button"
            onClick={onStep}
            disabled={isPlaying || world.status === 'victory' || world.status === 'error'}
            aria-label="Один такт вперёд"
            className="cel-btn px-2 py-1 rounded-lg bg-white text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Шаг</span>
          </button>

          <button
            type="button"
            onClick={onCycleSpeed}
            aria-label="Скорость симуляции"
            className="cel-btn px-2 py-1 rounded-lg bg-[#f3f6f4] text-xs font-bold font-mono-tabular text-[#141e1a] cursor-pointer whitespace-nowrap"
          >
            {simSpeed}×
          </button>

          <button
            type="button"
            onClick={onReset}
            aria-label="Сбросить симуляцию"
            className="cel-btn px-2 py-1 rounded-lg bg-white text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Сброс</span>
          </button>
        </div>

        <div className="h-5 w-[1px] bg-[#141e1a]/20 hidden sm:block" />

        <div className="hidden sm:flex items-center gap-2.5 text-[11px] font-mono-tabular whitespace-nowrap">
          <span>
            <span className="text-slate-500 mr-1">Дост.</span>
            <strong className="text-[#141e1a]" data-testid="hud-delivered">
              {world.deliveredCount}/{level.infiniteMode || level.id === 'sandbox' ? '∞' : world.requiredDeliveries}
            </strong>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            <span className="text-slate-500 mr-1">Такт</span>
            <strong className="text-[#141e1a]" data-testid="hud-tick">
              {world.tick}
            </strong>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            <span className="text-slate-500 mr-1">Бл.</span>
            <strong
              className={atBlockLimit ? 'text-[#b45309]' : 'text-[#141e1a]'}
              data-testid="hud-blocks"
            >
              {playerBlockCount}
              {level.maxTotalBlocks !== undefined ? `/${level.maxTotalBlocks}` : ''}
            </strong>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            <span className="text-slate-500 mr-1">Пл.</span>
            <strong className="text-[#141e1a]" data-testid="hud-area">
              {area}
            </strong>
          </span>
        </div>
      </div>

      {/* Right Zone: Theme & Compact Utility Controls */}
      <div className="pointer-events-auto cel-panel rounded-xl px-2 py-1.5 flex items-center gap-1 shrink-0">
        <select
          aria-label="Цветовая тема"
          value={theme}
          onChange={(e) => onChangeTheme(e.target.value as PaletteThemeId)}
          className="text-xs font-bold bg-[#f3f6f4] border border-[#141e1a] rounded-lg px-2 py-1 text-[#141e1a] cursor-pointer"
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
          className={`cel-btn px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
            continuousCamera
              ? 'bg-[#16a3b8] text-white'
              : 'bg-white text-[#141e1a]'
          }`}
        >
          <Orbit className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Авто-обзор</span>
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
          className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer"
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
          className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer"
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
          className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer"
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
          className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer"
        >
          <Pause className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
