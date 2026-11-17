import { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Eraser,
  FolderKanban,
  Lightbulb,
  MousePointer,
  Redo2,
  RotateCw,
  ScrollText,
  Trash2,
  Undo2,
} from 'lucide-react';
import { DIR_LABELS_RU } from '../engine/hex-math';
import { TOOL_METADATA } from '../engine/levels';
import type { HexDir, MachineType, RotatorMode, SimEvent } from '../engine/types';

import type { VariantSlotId, VariantSummary } from '../models/ui';
export type { VariantSlotId, VariantSummary } from '../models/ui';
type ToolCategoryFilter = 'all' | 'math' | 'transport' | 'assembly' | 'io';

const CATEGORY_TABS: Array<{ id: ToolCategoryFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'transport', label: 'Транспорт' },
  { id: 'math', label: 'Математика' },
  { id: 'assembly', label: 'Сборка' },
  { id: 'io', label: 'Ввод/Вывод' },
];

interface BottomDockProps {
  availableTools: MachineType[];
  selectedTool: MachineType | 'erase' | 'select' | null;
  selectedDir: HexDir;
  rotatorMode: RotatorMode;
  sandboxSeqInput: string;
  isSandbox: boolean;
  isRunning: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasDemo: boolean;
  hintsCount: number;
  revealedHintsCount: number;
  maxTotalBlocks?: number;
  playerBlockCount: number;
  partLimits?: Partial<Record<MachineType, number>>;
  toolCounts: Partial<Record<MachineType, number>>;
  activeVariant: VariantSlotId;
  variantSummaries: Partial<Record<VariantSlotId, VariantSummary>>;
  events: SimEvent[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTool: (tool: MachineType | 'erase' | 'select') => void;
  onRotateDir: () => void;
  onToggleRotMode: () => void;
  onSandboxSeqChange: (val: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectVariant: (slot: VariantSlotId) => void;
  onSaveVariant: (slot: VariantSlotId) => void;
  onOpenHints: () => void;
  onClearBoard: () => void;
}

export function BottomDock({
  availableTools,
  selectedTool,
  selectedDir,
  rotatorMode,
  sandboxSeqInput,
  isSandbox,
  isRunning,
  canUndo,
  canRedo,
  hasDemo,
  hintsCount,
  revealedHintsCount,
  maxTotalBlocks,
  playerBlockCount,
  partLimits,
  toolCounts,
  activeVariant,
  variantSummaries,
  events,
  collapsed,
  onToggleCollapse,
  onSelectTool,
  onRotateDir,
  onToggleRotMode,
  onSandboxSeqChange,
  onUndo,
  onRedo,
  onSelectVariant,
  onSaveVariant,
  onOpenHints,
  onClearBoard,
}: BottomDockProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [schemesOpen, setSchemesOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ToolCategoryFilter>('all');

  const presentCategories = useMemo(() => {
    const counts: Record<ToolCategoryFilter, number> = {
      all: availableTools.length,
      math: 0,
      transport: 0,
      assembly: 0,
      io: 0,
    };
    for (const t of availableTools) {
      counts[TOOL_METADATA[t].category] += 1;
    }
    return counts;
  }, [availableTools]);

  useEffect(() => {
    if (activeCategory !== 'all' && presentCategories[activeCategory] === 0) {
      setActiveCategory('all');
    }
  }, [activeCategory, presentCategories]);

  const filteredTools = useMemo(() => {
    if (activeCategory === 'all') return availableTools;
    return availableTools.filter((t) => TOOL_METADATA[t].category === activeCategory);
  }, [availableTools, activeCategory]);

  const activeMeta =
    selectedTool && selectedTool !== 'erase' && selectedTool !== 'select'
      ? TOOL_METADATA[selectedTool]
      : null;

  const isTotalBudgetFull =
    maxTotalBlocks !== undefined && playerBlockCount >= maxTotalBlocks;

  const showHintsOrDemoBtn = !isSandbox && (hintsCount > 0 || hasDemo);

  return (
    <>
      <div className="fixed bottom-2.5 left-1/2 -translate-x-1/2 z-20 w-[min(980px,96vw)] pointer-events-none flex flex-col items-center">
        {/* Expandable Schemes A/B/C Popover */}
        {schemesOpen && !collapsed && (
          <div className="pointer-events-auto mb-2 hud-panel rounded-xl px-3 py-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
              Слоты схем:
            </span>
            {(['A', 'B', 'C'] as VariantSlotId[]).map((slot) => {
              const summary = variantSummaries[slot];
              const isAct = activeVariant === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onSelectVariant(slot)}
                  aria-label={`Вариант схемы ${slot}`}
                  title={
                    summary
                      ? `Вариант ${slot}: ${summary.blocks} бл.${summary.bestTicks !== undefined ? `, ${summary.bestTicks} т.` : ''}`
                      : `Пустой слот ${slot}`
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono-tabular font-bold cursor-pointer transition-colors ${
                    isAct
                      ? 'bg-[#141e1a] dark:bg-amber-500 text-white dark:text-slate-950'
                      : summary
                        ? 'bg-white dark:bg-slate-800 text-[#141e1a] dark:text-slate-100 border border-[#141e1a]/25 dark:border-slate-600'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  {slot}
                  {summary ? ` · ${summary.blocks}` : ''}
                </button>
              );
            })}
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onSaveVariant(activeVariant)}
              aria-label="Сохранить схему в активный слот"
              title={`Сохранить текущую схему в слот ${activeVariant}`}
              className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800 text-xs font-bold text-[#141e1a] dark:text-slate-100 flex items-center gap-1 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Сохранить {activeVariant}</span>
            </button>
          </div>
        )}

        {/* Expandable Event Log Drawer */}
        {logOpen && !collapsed && (
          <div className="pointer-events-auto w-full mb-2 hud-panel rounded-xl p-3 max-h-40 overflow-y-auto cel-scroll">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-[#141e1a] dark:text-slate-100">
                Журнал симуляции
              </span>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white cursor-pointer"
              >
                Закрыть
              </button>
            </div>
            {events.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Событий пока нет. Поставьте модули и нажмите «Пуск» или «Шаг».
              </div>
            ) : (
              <div className="space-y-1">
                {[...events]
                  .reverse()
                  .slice(0, 30)
                  .map((ev) => (
                    <div
                      key={ev.id}
                      className={`text-xs font-mono-tabular flex items-start gap-2 px-2 py-0.5 rounded ${
                        ev.severity === 'error'
                          ? 'bg-red-100 dark:bg-red-950/70 text-red-900 dark:text-red-200 font-semibold'
                          : ev.severity === 'success'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200'
                            : ev.severity === 'warning'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                              : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="opacity-65 shrink-0">t={ev.tick}</span>
                      <span>{ev.message}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Collapse / Expand Tab */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Показать панель' : 'Скрыть панель'}
          className="pointer-events-auto hud-panel px-3 py-0.5 rounded-t-xl text-[11px] font-bold text-[#141e1a] dark:text-slate-200 flex items-center gap-1 cursor-pointer -mb-[1px]"
        >
          {collapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Панель [H]</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Скрыть [H]</span>
            </>
          )}
        </button>

        {/* Main Skylines Dock Container */}
        {!collapsed && (
          <div className="pointer-events-auto w-full hud-panel rounded-2xl p-2 flex flex-col gap-1.5">
            {/* Slim Top Utility & Info Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
                {selectedTool === 'erase' ? (
                  <span className="truncate">
                    <strong className="text-[#141e1a] dark:text-white">Ластик:</strong> кликните по модулю для удаления (или ПКМ).
                  </span>
                ) : selectedTool === 'select' ? (
                  <span className="truncate">
                    <strong className="text-[#141e1a] dark:text-white">Выбор:</strong> клик по модулю для настройки или перетаскивания.
                  </span>
                ) : activeMeta ? (
                  <span className="truncate">
                    <strong className="text-[#141e1a] dark:text-amber-300">{activeMeta.label}:</strong>{' '}
                    {activeMeta.description}
                  </span>
                ) : (
                  <span>Выберите механизм на панели ниже.</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto max-w-full">
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={isRunning || !canUndo}
                  aria-label="Отменить действие"
                  title="Отменить [Ctrl+Z]"
                  className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={onRedo}
                  disabled={isRunning || !canRedo}
                  aria-label="Повторить действие"
                  title="Повторить [Ctrl+Y]"
                  className="hud-btn p-1.5 rounded-lg bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200 cursor-pointer"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={onRotateDir}
                  className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-[11px] font-bold text-[#141e1a] dark:text-slate-100 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  title="Повернуть направление [R]"
                >
                  <RotateCw className="w-3 h-3" />
                  <span>{DIR_LABELS_RU[selectedDir]}</span>
                </button>

                {selectedTool === 'rotator' && (
                  <button
                    type="button"
                    onClick={onToggleRotMode}
                    className="hud-btn px-2 py-1 rounded-lg bg-[#eef5f1] dark:bg-slate-800 text-[11px] font-bold text-[#141e1a] dark:text-cyan-300 cursor-pointer whitespace-nowrap"
                  >
                    {rotatorMode === 'cw' ? '↻ По час.' : '↺ Против'}
                  </button>
                )}

                {isSandbox && selectedTool === 'spawner' && (
                  <label className="flex items-center gap-1 text-[11px] font-semibold">
                    <span>Поток:</span>
                    <input
                      type="text"
                      value={sandboxSeqInput}
                      onChange={(e) => onSandboxSeqChange(e.target.value)}
                      placeholder="1,2,3"
                      className="w-20 px-2 py-0.5 border border-[#141e1a] dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-[#141e1a] dark:text-slate-100 font-mono-tabular text-xs"
                    />
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSchemesOpen((v) => !v);
                    setLogOpen(false);
                  }}
                  aria-label="Сравнение вариантов схемы"
                  title="Слоты схем A · B · C"
                  className={`hidden md:flex hud-btn px-2 py-1 rounded-lg text-[11px] font-bold items-center gap-1 cursor-pointer whitespace-nowrap ${
                    schemesOpen
                      ? 'bg-[#141e1a] dark:bg-cyan-500 text-white dark:text-slate-950'
                      : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200'
                  }`}
                >
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span className="font-mono-tabular">Схемы · {activeVariant}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLogOpen((v) => !v);
                    setSchemesOpen(false);
                  }}
                  className={`hud-btn px-2 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                    logOpen
                      ? 'bg-[#141e1a] dark:bg-cyan-500 text-white dark:text-slate-950'
                      : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-200'
                  }`}
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  <span className="font-mono-tabular">Журнал ({events.length})</span>
                </button>

                {showHintsOrDemoBtn && (
                  <button
                    type="button"
                    onClick={onOpenHints}
                    title="Открыть пошаговые подсказки и эталонные сборки"
                    className="hud-btn px-2.5 py-1 rounded-lg bg-[#fef3c7] dark:bg-amber-400/15 text-[11px] font-bold text-[#141e1a] dark:text-amber-300 dark:border-amber-400/40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>
                      Подсказки / Эталон
                      {hintsCount > 0 ? ` (${revealedHintsCount}/${hintsCount})` : ''}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClearBoard}
                  disabled={isRunning}
                  title="Очистить установленные блоки"
                  className="hud-btn px-2 py-1 rounded-lg bg-white dark:bg-slate-800/90 text-xs font-bold text-red-700 dark:text-rose-400 cursor-pointer"
                  aria-label="Очистить поле"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Category Filter Strip */}
            {CATEGORY_TABS.filter((c) => c.id !== 'all' && presentCategories[c.id] > 0).length >= 2 && (
              <div className="flex items-center gap-1 overflow-x-auto cel-scroll px-0.5">
                {CATEGORY_TABS.map((tab) => {
                  const count = presentCategories[tab.id];
                  if (tab.id !== 'all' && count === 0) return null;
                  const isSelected = activeCategory === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveCategory(tab.id)}
                      aria-pressed={isSelected}
                      className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                        isSelected
                          ? 'bg-[#141e1a] dark:bg-slate-100 text-white dark:text-slate-950'
                          : 'bg-[#edf3ef] dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 hover:bg-[#dce8e1] dark:hover:bg-slate-700/80'
                      }`}
                    >
                      {tab.label}{' '}
                      <span className="font-mono-tabular opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Machine Palette Row (Skylines Amber Active Highlight) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 cel-scroll">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => onSelectTool('select')}
                aria-label="Выбор и инспектор"
                className={`hud-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  selectedTool === 'select'
                    ? 'bg-[#0284c7] dark:bg-cyan-400 text-white dark:text-slate-950'
                    : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-100 hover:bg-sky-50 dark:hover:bg-slate-700/80'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">Выбор</span>
                <span
                  className={`text-[10px] font-mono-tabular px-1 rounded ${
                    selectedTool === 'select'
                      ? 'bg-black/20 text-white dark:text-slate-950'
                      : 'bg-black/10 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  V
                </span>
              </button>

              {filteredTools.map((tool) => {
                const meta = TOOL_METADATA[tool];
                const isActive = selectedTool === tool;
                const limit = partLimits?.[tool];
                const used = toolCounts[tool] ?? 0;
                const isQuotaExhausted = limit !== undefined && used >= limit;
                const quotaLabel = limit !== undefined ? `${used}/${limit}` : null;

                return (
                  <button
                    key={tool}
                    type="button"
                    disabled={isRunning || isQuotaExhausted}
                    onClick={() => onSelectTool(tool)}
                    aria-label={`Выбрать ${meta.label}`}
                    data-quota-full={isQuotaExhausted ? 'true' : undefined}
                    title={
                      isQuotaExhausted
                        ? `Лимит модуля «${meta.label}» исчерпан (${used}/${limit})`
                        : isTotalBudgetFull
                          ? `Достигнут общий лимит блоков (${playerBlockCount}/${maxTotalBlocks})`
                          : meta.description
                    }
                    className={`hud-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      isQuotaExhausted
                        ? 'bg-slate-100 dark:bg-slate-900/70 text-slate-700 dark:text-slate-500 !opacity-70'
                        : isActive
                          ? 'bg-[#26b557] dark:bg-amber-400 text-white dark:text-slate-950 dark:border-amber-300'
                          : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-100 hover:bg-[#f0f7f3] dark:hover:bg-slate-700/80'
                    }`}
                  >
                    <span className="font-mono-tabular font-extrabold text-sm leading-none">
                      {meta.shortSymbol}
                    </span>
                    <span className="text-xs font-bold leading-none">{meta.label}</span>
                    {quotaLabel && (
                      <span
                        className={`text-[11px] font-mono-tabular font-bold ${
                          isQuotaExhausted
                            ? 'text-amber-800 dark:text-amber-500/70'
                            : isActive
                              ? 'text-white/95 dark:text-slate-950'
                              : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        · {quotaLabel}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-mono-tabular px-1 rounded ${
                        isActive && !isQuotaExhausted
                          ? 'bg-black/20 text-white dark:text-slate-950'
                          : 'bg-black/10 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {meta.hotkey}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                disabled={isRunning}
                onClick={() => onSelectTool('erase')}
                aria-label="Удалить блок"
                className={`hud-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  selectedTool === 'erase'
                    ? 'bg-red-600 dark:bg-rose-500 text-white'
                    : 'bg-white dark:bg-slate-800/90 text-[#141e1a] dark:text-slate-100 hover:bg-red-50 dark:hover:bg-rose-950/40'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">Ластик</span>
                <span
                  className={`text-[10px] font-mono-tabular px-1 rounded ${
                    selectedTool === 'erase'
                      ? 'bg-black/20 text-white'
                      : 'bg-black/10 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  X
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Subtle Bottom-Right Keyboard Hint Strip (Skylines style) */}
      <div className="hidden 2xl:flex fixed bottom-3 right-3 z-10 pointer-events-none items-center gap-2 text-[10.5px] font-medium text-slate-700 dark:text-slate-300/80 bg-white/75 dark:bg-[#0b111a]/75 border border-black/10 dark:border-white/10 rounded-lg px-2.5 py-1">
        <span><kbd className="font-mono-tabular font-bold">Пробел</kbd> Пуск</span>
        <span>·</span>
        <span><kbd className="font-mono-tabular font-bold">R</kbd> Поворот</span>
        <span>·</span>
        <span><kbd className="font-mono-tabular font-bold">I</kbd> Задача</span>
      </div>
    </>
  );
}
