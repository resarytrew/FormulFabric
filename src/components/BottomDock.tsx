import { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Eraser,
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

export type VariantSlotId = 'A' | 'B' | 'C';
type ToolCategoryFilter = 'all' | 'math' | 'transport' | 'assembly' | 'io';

const CATEGORY_TABS: Array<{ id: ToolCategoryFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'transport', label: 'Транспорт' },
  { id: 'math', label: 'Математика' },
  { id: 'assembly', label: 'Сборка' },
  { id: 'io', label: 'Ввод/Вывод' },
];

export interface VariantSummary {
  blocks: number;
  bestTicks?: number;
}

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
  canShowDemo: boolean;
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
  onApplyDemoSolution: () => void;
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
  canShowDemo,
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
  onApplyDemoSolution,
  onClearBoard,
}: BottomDockProps) {
  const [logOpen, setLogOpen] = useState(false);
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

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(1140px,96vw)] pointer-events-none flex flex-col items-center">
      {/* Expandable Event Log Drawer */}
      {logOpen && !collapsed && (
        <div className="pointer-events-auto w-full mb-2 cel-panel rounded-xl p-3 max-h-44 overflow-y-auto cel-scroll">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-[#141e1a]">
              Журнал симуляции и диагностики
            </span>
            <button
              type="button"
              onClick={() => setLogOpen(false)}
              className="text-xs font-semibold text-slate-600 hover:text-black cursor-pointer"
            >
              Закрыть
            </button>
          </div>
          {events.length === 0 ? (
            <div className="text-xs text-slate-500">
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
                        ? 'bg-red-100 text-red-900 font-semibold'
                        : ev.severity === 'success'
                          ? 'bg-emerald-100 text-emerald-900'
                          : ev.severity === 'warning'
                            ? 'bg-amber-100 text-amber-900'
                            : 'text-slate-700'
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
        className="pointer-events-auto cel-btn px-3 py-1 rounded-t-xl bg-[#f7faf8] text-[11px] font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer -mb-[2px]"
      >
        {collapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Панель [H]</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" />
            <span>Скрыть панель [H]</span>
          </>
        )}
      </button>

      {/* Main Dock Container */}
      {!collapsed && (
        <div className="pointer-events-auto w-full cel-panel rounded-2xl p-2.5 flex flex-col gap-2">
          {/* Top info & modifier strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="text-xs text-slate-700 flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
              {selectedTool === 'erase' ? (
                <span>
                  <strong className="text-[#141e1a]">Удаление блоков:</strong>{' '}
                  кликните по любому своему модулю на сетке (или ПКМ).
                </span>
              ) : selectedTool === 'select' ? (
                <span>
                  <strong className="text-[#141e1a]">Выбор и перенос:</strong>{' '}
                  кликните по модулю для настройки или перетащите его на другой гекс.
                </span>
              ) : activeMeta ? (
                <span className="truncate">
                  <strong className="text-[#141e1a]">{activeMeta.label}:</strong>{' '}
                  {activeMeta.description}
                </span>
              ) : (
                <span>Выберите инструмент из палитры ниже.</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto max-w-full">
              <button
                type="button"
                onClick={onUndo}
                disabled={isRunning || !canUndo}
                aria-label="Отменить действие"
                title="Отменить [Ctrl+Z]"
                className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onRedo}
                disabled={isRunning || !canRedo}
                aria-label="Повторить действие"
                title="Повторить [Ctrl+Y]"
                className="cel-btn p-1.5 rounded-lg bg-white text-[#141e1a] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onRotateDir}
                className="cel-btn px-2.5 py-1 rounded-lg bg-white text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                title="Повернуть направление [R]"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>{DIR_LABELS_RU[selectedDir]}</span>
              </button>

              {selectedTool === 'rotator' && (
                <button
                  type="button"
                  onClick={onToggleRotMode}
                  className="cel-btn px-2.5 py-1 rounded-lg bg-[#eef5f1] text-xs font-bold text-[#141e1a] cursor-pointer whitespace-nowrap"
                >
                  {rotatorMode === 'cw' ? '↻ По час.' : '↺ Против'}
                </button>
              )}

              {isSandbox && selectedTool === 'spawner' && (
                <label className="flex items-center gap-1 text-xs font-semibold">
                  <span>Поток:</span>
                  <input
                    type="text"
                    value={sandboxSeqInput}
                    onChange={(e) => onSandboxSeqChange(e.target.value)}
                    placeholder="1,2,3"
                    className="w-24 px-2 py-0.5 border border-[#141e1a] rounded bg-white font-mono-tabular text-xs"
                  />
                </label>
              )}

              {/* Saved Solution Variant Slots A/B/C */}
              <div
                className="hidden md:flex items-center gap-1 bg-[#f0f5f2] border border-[#141e1a]/25 rounded-lg px-1.5 py-0.5"
                title="Сравнение вариантов схемы"
              >
                <span className="text-[10px] font-bold text-slate-600 px-1">Схемы:</span>
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
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono-tabular font-bold cursor-pointer transition-colors ${
                        isAct
                          ? 'bg-[#141e1a] text-white'
                          : summary
                            ? 'bg-white text-[#141e1a] border border-[#141e1a]/25'
                            : 'text-slate-500 hover:bg-white/70'
                      }`}
                    >
                      {slot}
                      {summary ? `·${summary.blocks}` : ''}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => onSaveVariant(activeVariant)}
                  aria-label="Сохранить схему в активный слот"
                  title={`Сохранить текущую схему в слот ${activeVariant}`}
                  className="p-0.5 rounded hover:bg-white text-[#141e1a] cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setLogOpen((v) => !v)}
                className={`cel-btn px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  logOpen ? 'bg-[#141e1a] text-white' : 'bg-white text-[#141e1a]'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                <span>Журнал ({events.length})</span>
              </button>

              {!isSandbox && hintsCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenHints}
                  title="Пошаговые подсказки без готового ответа"
                  className="cel-btn px-2.5 py-1 rounded-lg bg-[#fef3c7] text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span className="font-mono-tabular">
                    Подсказка ({revealedHintsCount}/{hintsCount})
                  </span>
                </button>
              )}

              {canShowDemo && (
                <button
                  type="button"
                  onClick={onApplyDemoSolution}
                  disabled={isRunning}
                  title="Показать эталонную сборку уровня"
                  className="cel-btn px-2.5 py-1 rounded-lg bg-[#eef5f1] text-xs font-bold text-[#141e1a] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span>Эталон</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClearBoard}
                disabled={isRunning}
                title="Очистить установленные блоки"
                className="cel-btn px-2 py-1 rounded-lg bg-white text-xs font-bold text-red-700 cursor-pointer"
                aria-label="Очистить поле"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Category Filter Strip (shown when 2+ categories exist) */}
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
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-[#141e1a] text-white'
                        : 'bg-[#edf3ef] text-slate-700 hover:bg-[#dce8e1]'
                    }`}
                  >
                    {tab.label}{' '}
                    <span className="font-mono-tabular opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Machine Palette Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 cel-scroll">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onSelectTool('select')}
              aria-label="Выбор и инспектор"
              className={`cel-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                selectedTool === 'select'
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-white text-[#141e1a] hover:bg-sky-50'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">Выбор</span>
              <span
                className={`text-[10px] font-mono-tabular px-1 rounded ${
                  selectedTool === 'select' ? 'bg-black/20 text-white' : 'bg-black/10 text-slate-600'
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
                  className={`cel-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    isQuotaExhausted
                      ? 'bg-slate-100 text-slate-700 !opacity-75'
                      : isActive
                        ? 'bg-[#26b557] text-white'
                        : 'bg-white text-[#141e1a] hover:bg-[#f0f7f3]'
                  }`}
                >
                  <span className="font-mono-tabular font-extrabold text-sm leading-none">
                    {meta.shortSymbol}
                  </span>
                  <span className="text-xs font-bold leading-none">{meta.label}</span>
                  {quotaLabel && (
                    <span
                      className={`text-[11px] font-mono-tabular font-bold ${
                        isQuotaExhausted ? 'text-amber-800' : isActive ? 'text-white/95' : 'text-slate-600'
                      }`}
                    >
                      · {quotaLabel}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-mono-tabular px-1 rounded ${
                      isActive && !isQuotaExhausted ? 'bg-black/20 text-white' : 'bg-black/10 text-slate-600'
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
              className={`cel-btn shrink-0 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                selectedTool === 'erase'
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-[#141e1a] hover:bg-red-50'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">Ластик</span>
              <span className="text-[10px] font-mono-tabular px-1 rounded bg-black/10">
                X
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
