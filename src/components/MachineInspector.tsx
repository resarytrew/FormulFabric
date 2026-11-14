import { useEffect, useState } from 'react';
import { RotateCw, Sliders, Trash2, X } from 'lucide-react';
import { DIR_LABELS_RU, rotateDir } from '../engine/hex-math';
import { TOOL_METADATA } from '../engine/levels';
import type {
  AxialCoord,
  FilterRule,
  HexDir,
  MachineConfig,
  MachineType,
} from '../engine/types';

export interface InspectableBlock {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
}

interface MachineInspectorProps {
  block: InspectableBlock;
  isRunning: boolean;
  fixedDivisor?: number;
  onUpdateConfig: (coord: AxialCoord, patch: Partial<MachineConfig>) => void;
  onDelete: (coord: AxialCoord) => void;
  onClose: () => void;
}

const FILTER_OPTIONS: Array<{ value: FilterRule; label: string }> = [
  { value: 'even', label: 'Чётные (x mod 2 = 0)' },
  { value: 'odd', label: 'Нечётные (|x| mod 2 = 1)' },
  { value: 'positive', label: 'Положительные (x > 0)' },
  { value: 'negative', label: 'Отрицательные (x < 0)' },
  { value: 'gt5', label: 'Больше 5 (x > 5)' },
];

export function MachineInspector({
  block,
  isRunning,
  fixedDivisor,
  onUpdateConfig,
  onDelete,
  onClose,
}: MachineInspectorProps) {
  const meta = TOOL_METADATA[block.type];
  const [seqText, setSeqText] = useState<string>(
    (block.config.sequence ?? [1, 2, 3]).join(', '),
  );

  useEffect(() => {
    setSeqText((block.config.sequence ?? [1, 2, 3]).join(', '));
  }, [block.coord.q, block.coord.r, block.type, block.config.sequence]);

  const applySequenceText = (raw: string) => {
    setSeqText(raw);
    const parsed = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    if (parsed.length > 0) {
      onUpdateConfig(block.coord, { sequence: parsed });
    }
  };

  return (
    <aside
      aria-label="Свойства механизма"
      className="fixed top-56 left-3 right-3 max-h-[calc(100vh-27rem)] sm:top-20 sm:left-auto sm:right-3 sm:w-64 sm:max-h-[calc(100vh-14rem)] z-20 cel-panel rounded-2xl p-3.5 text-[#141e1a] flex flex-col gap-2.5 overflow-y-auto cel-scroll"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/15 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sliders className="w-4 h-4 text-[#26b557] shrink-0" />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm leading-tight truncate">
              {meta.label}
            </div>
            <div className="text-[11px] font-mono-tabular text-slate-500">
              Гекс ({block.coord.q}, {block.coord.r})
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть инспектор"
          className="cel-btn p-1 rounded-lg bg-white cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary Direction */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-600">Выход (осн.):</span>
        <button
          type="button"
          disabled={isRunning}
          onClick={() => {
            const nextDir = rotateDir(block.config.dir, 1);
            onUpdateConfig(block.coord, { dir: nextDir });
          }}
          aria-label="Повернуть выход механизма"
          className="cel-btn px-2.5 py-1 rounded-lg bg-white font-bold flex items-center gap-1 cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>{DIR_LABELS_RU[block.config.dir]}</span>
        </button>
      </div>

      {/* Rotator Mode */}
      {block.type === 'rotator' && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-600">Вращение:</span>
          <button
            type="button"
            disabled={isRunning}
            onClick={() =>
              onUpdateConfig(block.coord, {
                rotMode: block.config.rotMode === 'ccw' ? 'cw' : 'ccw',
              })
            }
            aria-label="Переключить направление вращения ротатора"
            className="cel-btn px-2.5 py-1 rounded-lg bg-[#eef5f1] font-bold cursor-pointer"
          >
            {block.config.rotMode === 'ccw' ? '↺ Против час.' : '↻ По час.'}
          </button>
        </div>
      )}

      {/* Filter Rule & Secondary Port */}
      {block.type === 'filter' && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-600">Условие прямо:</span>
            <select
              disabled={isRunning}
              aria-label="Правило фильтра"
              value={block.config.filterRule ?? 'even'}
              onChange={(e) =>
                onUpdateConfig(block.coord, {
                  filterRule: e.target.value as FilterRule,
                })
              }
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-semibold text-xs cursor-pointer"
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Иначе порт:</span>
            <select
              disabled={isRunning}
              aria-label="Дополнительное направление фильтра"
              value={block.config.altDir ?? rotateDir(block.config.dir, 1)}
              onChange={(e) =>
                onUpdateConfig(block.coord, {
                  altDir: Number(e.target.value) as HexDir,
                })
              }
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-semibold text-xs cursor-pointer"
            >
              {([0, 1, 2, 3, 4, 5] as HexDir[]).map((d) => (
                <option key={d} value={d}>
                  {DIR_LABELS_RU[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Divmod Divisor & Remainder Port */}
      {block.type === 'divmod' && (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Делитель b:</span>
            {fixedDivisor !== undefined ? (
              <span
                data-testid="inspector-divisor"
                className="font-mono-tabular font-extrabold px-2 py-0.5 rounded bg-[#ede9fe] text-[#5b21b6] border border-[#141e1a]/30"
                title="Делитель зафиксирован условием уровня"
              >
                {fixedDivisor} (фикс.)
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isRunning || (block.config.divisor ?? 2) <= 2}
                  aria-label="Уменьшить делитель"
                  onClick={() =>
                    onUpdateConfig(block.coord, {
                      divisor: Math.max(2, (block.config.divisor ?? 2) - 1),
                    })
                  }
                  className="cel-btn w-6 h-6 rounded bg-white font-bold cursor-pointer"
                >
                  −
                </button>
                <span
                  data-testid="inspector-divisor"
                  className="font-mono-tabular font-extrabold w-6 text-center"
                >
                  {block.config.divisor ?? 2}
                </span>
                <button
                  type="button"
                  disabled={isRunning || (block.config.divisor ?? 2) >= 12}
                  aria-label="Увеличить делитель"
                  onClick={() =>
                    onUpdateConfig(block.coord, {
                      divisor: Math.min(12, (block.config.divisor ?? 2) + 1),
                    })
                  }
                  className="cel-btn w-6 h-6 rounded bg-white font-bold cursor-pointer"
                >
                  +
                </button>
              </div>
            )}
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Порт остатка r:</span>
            <select
              disabled={isRunning}
              aria-label="Направление остатка от деления"
              value={block.config.altDir ?? rotateDir(block.config.dir, 1)}
              onChange={(e) =>
                onUpdateConfig(block.coord, {
                  altDir: Number(e.target.value) as HexDir,
                })
              }
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-semibold text-xs cursor-pointer"
            >
              {([0, 1, 2, 3, 4, 5] as HexDir[]).map((d) => (
                <option key={d} value={d}>
                  {DIR_LABELS_RU[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Duplicator Copy Port */}
      {block.type === 'dup' && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Порт копии:</span>
            <select
              disabled={isRunning}
              aria-label="Направление копии дубликатора"
              value={block.config.altDir ?? rotateDir(block.config.dir, 1)}
              onChange={(e) =>
                onUpdateConfig(block.coord, {
                  altDir: Number(e.target.value) as HexDir,
                })
              }
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-semibold text-xs cursor-pointer"
            >
              {([0, 1, 2, 3, 4, 5] as HexDir[]).map((d) => (
                <option key={d} value={d}>
                  {DIR_LABELS_RU[d]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500 leading-snug">
            Оригинал выходит по основной стрелке, точная копия — в выбранный порт.
          </p>
        </div>
      )}

      {/* Splitter Alternate Port B */}
      {block.type === 'splitter' && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Порт B (черед.):</span>
            <select
              disabled={isRunning}
              aria-label="Запасной выход разделителя"
              value={block.config.altDir ?? rotateDir(block.config.dir, 1)}
              onChange={(e) =>
                onUpdateConfig(block.coord, {
                  altDir: Number(e.target.value) as HexDir,
                })
              }
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-semibold text-xs cursor-pointer"
            >
              {([0, 1, 2, 3, 4, 5] as HexDir[]).map((d) => (
                <option key={d} value={d}>
                  {DIR_LABELS_RU[d]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500 leading-snug">
            Поочерёдно отправляет сферы: сначала по основной стрелке (A), затем в порт B.
          </p>
        </div>
      )}

      {/* Spawner Stream Settings */}
      {block.type === 'spawner' && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-slate-600">Последовательность:</span>
            <input
              type="text"
              disabled={isRunning}
              aria-label="Последовательность чисел источника"
              value={seqText}
              onChange={(e) => applySequenceText(e.target.value)}
              className="px-2 py-1 rounded-lg border border-[#141e1a] bg-white font-mono-tabular text-xs"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Интервал (такты):</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={isRunning || (block.config.spawnInterval ?? 2) <= 1}
                aria-label="Уменьшить интервал"
                onClick={() =>
                  onUpdateConfig(block.coord, {
                    spawnInterval: Math.max(1, (block.config.spawnInterval ?? 2) - 1),
                  })
                }
                className="cel-btn w-6 h-6 rounded bg-white font-bold cursor-pointer"
              >
                −
              </button>
              <span className="font-mono-tabular font-extrabold w-5 text-center">
                {block.config.spawnInterval ?? 2}
              </span>
              <button
                type="button"
                disabled={isRunning || (block.config.spawnInterval ?? 2) >= 12}
                aria-label="Увеличить интервал"
                onClick={() =>
                  onUpdateConfig(block.coord, {
                    spawnInterval: Math.min(12, (block.config.spawnInterval ?? 2) + 1),
                  })
                }
                className="cel-btn w-6 h-6 rounded bg-white font-bold cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={isRunning}
              checked={Boolean(block.config.loopSequence)}
              onChange={(e) =>
                onUpdateConfig(block.coord, { loopSequence: e.target.checked })
              }
            />
            <span className="font-semibold text-slate-700">Зациклить поток</span>
          </label>
        </div>
      )}

      <button
        type="button"
        disabled={isRunning}
        onClick={() => onDelete(block.coord)}
        aria-label="Удалить выбранный механизм"
        className="cel-btn w-full py-1.5 rounded-xl bg-red-50 text-red-700 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer mt-1"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Удалить блок</span>
      </button>
    </aside>
  );
}
