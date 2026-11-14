import type { PaletteThemeId } from '../render/celMaterials';

interface TitleScreenProps {
  onStartCampaign: () => void;
  onStartSandbox: () => void;
  onOpenLevels: () => void;
  theme: PaletteThemeId;
  onChangeTheme: (t: PaletteThemeId) => void;
  completedCount: number;
  totalLevels: number;
}

export function TitleScreen({
  onStartCampaign,
  onStartSandbox,
  onOpenLevels,
  theme,
  onChangeTheme,
  completedCount,
  totalLevels,
}: TitleScreenProps) {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 md:p-10">
      {/* Top minimal row: Theme switcher only */}
      <div className="flex items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-2 cel-panel rounded-xl px-3 py-1.5 text-xs font-semibold">
          <span className="text-slate-600">Палитра:</span>
          {(['workshop', 'emerald', 'sky', 'mono'] as PaletteThemeId[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChangeTheme(t)}
              className={`px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                theme === t
                  ? 'bg-[#141e1a] text-white'
                  : 'text-slate-700 hover:bg-black/5'
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
          <div className="pointer-events-auto cel-panel rounded-xl px-3.5 py-1.5 text-xs font-semibold font-mono-tabular">
            Пройдено уровней: {completedCount}/{totalLevels}
          </div>
        )}
      </div>

      {/* Left negative-space focal lockup */}
      <div className="max-w-lg pointer-events-auto cel-panel rounded-2xl p-7 md:p-8">
        {/* Bespoke inline SVG emblem */}
        <div className="mb-4 flex items-center gap-3">
          <svg
            viewBox="0 0 64 64"
            className="w-14 h-14 shrink-0"
            aria-hidden="true"
          >
            <polygon
              points="32,4 56,18 56,46 32,60 8,46 8,18"
              fill="#99dab8"
              stroke="#141e1a"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <circle
              cx="23"
              cy="32"
              r="9"
              fill="#26b557"
              stroke="#141e1a"
              strokeWidth="3.5"
            />
            <circle
              cx="42"
              cy="32"
              r="9"
              fill="#f0861a"
              stroke="#141e1a"
              strokeWidth="3.5"
            />
            <line
              x1="31"
              y1="32"
              x2="34"
              y2="32"
              stroke="#141e1a"
              strokeWidth="5"
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
            <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-[#141e1a] leading-none">
              Фабрика чисел
            </h1>
            <p className="mt-1.5 text-sm font-medium text-slate-600">
              3D-автоматизация и математическая инженерия на гексагональной сетке
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed mb-6">
          Стройте автономные конвейеры, сваривайте числовые сферы в жёсткие
          полимеры, вращайте их ротаторами на 60° и решайте задачи точной
          математики.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onStartCampaign}
            className="cel-btn px-6 py-3 rounded-xl bg-[#26b557] text-white font-bold text-base cursor-pointer whitespace-nowrap"
          >
            {completedCount > 0 ? 'Продолжить кампанию' : 'Начать кампанию'}
          </button>
          <button
            type="button"
            onClick={onOpenLevels}
            className="cel-btn px-4 py-3 rounded-xl bg-white text-[#141e1a] font-semibold text-sm cursor-pointer whitespace-nowrap"
          >
            Уровни ({totalLevels})
          </button>
          <button
            type="button"
            onClick={onStartSandbox}
            className="cel-btn px-4 py-3 rounded-xl bg-[#f4f7f5] text-[#141e1a] font-semibold text-sm cursor-pointer whitespace-nowrap"
          >
            Песочница
          </button>
        </div>
      </div>

      {/* Bottom borderless control hint */}
      <div className="text-center">
        <span className="inline-block px-4 py-1.5 rounded-lg bg-[#141e1a]/85 text-white/95 text-xs font-medium tracking-wide">
          Enter Старт · ЛКМ Поставить · ПКМ Удалить · R Поворот · WASD Камера
        </span>
      </div>
    </div>
  );
}
