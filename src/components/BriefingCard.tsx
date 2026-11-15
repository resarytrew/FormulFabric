import { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Sparkles,
} from 'lucide-react';
import type { LevelDefinition } from '../engine/types';

interface BriefingCardProps {
  level: LevelDefinition;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}

export function BriefingCard({ level, expanded, onToggle }: BriefingCardProps) {
  const briefing = level.briefing;

  // Always start collapsed as a compact «Задача?» chip on entering a level
  useEffect(() => {
    onToggle(false);
  }, [level.id, onToggle]);

  if (!briefing) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        aria-label="Показать условие задачи"
        aria-expanded={false}
        data-testid="briefing-expand-btn"
        title="Открыть условие задачи [I]"
        className="pointer-events-auto hud-panel rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-bold text-[#141e1a] dark:text-slate-100 cursor-pointer hover:brightness-105"
      >
        <BookOpen className="w-3.5 h-3.5 text-[#0284c7] dark:text-cyan-400 shrink-0" />
        <span>Задача?</span>
        <span className="text-[10px] font-mono-tabular px-1 rounded bg-black/10 dark:bg-white/10 text-slate-600 dark:text-slate-300">
          I
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Условие задачи"
      data-testid="briefing-card"
      className="pointer-events-auto hud-panel rounded-2xl p-3 w-[min(308px,calc(100vw-1.5rem))] text-[#141e1a] dark:text-slate-100"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-[#0284c7] dark:text-cyan-400 shrink-0" />
          <span className="font-display font-extrabold text-[11px] tracking-wide uppercase truncate text-[#0369a1] dark:text-cyan-300">
            Условие за 10 секунд
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggle(false)}
          aria-label="Свернуть условие задачи"
          aria-expanded={true}
          data-testid="briefing-collapse-btn"
          className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer shrink-0"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 text-[11px] leading-snug">
        {/* 1. Goal in one line */}
        <div className="flex items-start gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#0284c7] dark:text-cyan-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold text-[#141e1a] dark:text-white">Цель: </span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {briefing.intro ?? level.subtitle}
            </span>
          </div>
        </div>

        {/* 2. Before -> After */}
        <div className="rounded-xl border border-[#141e1a]/20 dark:border-emerald-500/30 bg-[#eef5f1] dark:bg-emerald-950/45 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#1f8f45] dark:text-emerald-400 mb-0.5">
            <ArrowRight className="w-3 h-3 shrink-0" />
            <span>Было → Стало</span>
          </div>
          <div className="font-mono-tabular font-bold text-[10.5px] text-[#141e1a] dark:text-emerald-100">
            {briefing.example}
          </div>
        </div>

        {/* 3. The Catch */}
        <div className="rounded-xl border border-amber-400/70 dark:border-amber-500/35 bg-[#fffbeb] dark:bg-amber-950/40 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#b45309] dark:text-amber-400 mb-0.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>В чём подвох</span>
          </div>
          <div className="text-[10.5px] text-[#78350f] dark:text-amber-100/90 font-medium">
            {briefing.catch}
          </div>
        </div>

        {/* 4. Mechanic Secret */}
        <div className="rounded-xl border border-cyan-600/35 dark:border-cyan-500/35 bg-[#ecfeff] dark:bg-cyan-950/45 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#0e7490] dark:text-cyan-300 mb-0.5">
            <KeyRound className="w-3 h-3 shrink-0" />
            <span>Секрет механики</span>
          </div>
          <div className="text-[10.5px] text-[#164e63] dark:text-cyan-100/90 font-medium">
            {briefing.secret}
          </div>
        </div>
      </div>
    </aside>
  );
}
