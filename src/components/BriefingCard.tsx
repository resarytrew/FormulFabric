import { useEffect, useState } from 'react';
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
}

export function BriefingCard({ level }: BriefingCardProps) {
  const briefing = level.briefing;
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  // Re-open automatically when entering a level with a structured briefing on desktop
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCollapsed(window.innerWidth < 640);
    }
  }, [level.id]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 640) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!briefing) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Показать условие задачи"
        aria-expanded={false}
        data-testid="briefing-expand-btn"
        className="pointer-events-auto cel-panel rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-bold text-[#141e1a] cursor-pointer hover:bg-white"
      >
        <BookOpen className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
        <span className="truncate max-w-[180px]">Условие задачи</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Условие задачи"
      data-testid="briefing-card"
      className="pointer-events-auto cel-panel rounded-2xl p-2.5 w-[min(304px,calc(100vw-1.25rem))] text-[#141e1a]"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
          <span className="font-display font-extrabold text-[11px] tracking-wide uppercase truncate text-[#0369a1]">
            Условие за 10 секунд
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть условие задачи"
          aria-expanded={true}
          data-testid="briefing-collapse-btn"
          className="p-0.5 rounded hover:bg-black/10 cursor-pointer shrink-0"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 text-[11px] leading-snug">
        {/* 1. Goal in one line */}
        <div className="flex items-start gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#0284c7] shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold text-[#141e1a]">Цель: </span>
            <span className="text-slate-700 font-medium">
              {briefing.intro ?? level.subtitle}
            </span>
          </div>
        </div>

        {/* 2. Before -> After */}
        <div className="rounded-xl border border-[#141e1a]/20 bg-[#eef5f1] px-2 py-1">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#1f8f45] mb-0.5">
            <ArrowRight className="w-3 h-3 shrink-0" />
            <span>Было → Стало</span>
          </div>
          <div className="font-mono-tabular font-bold text-[10.5px] text-[#141e1a]">
            {briefing.example}
          </div>
        </div>

        {/* 3. The Catch */}
        <div className="rounded-xl border border-amber-400/70 bg-[#fffbeb] px-2 py-1">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#b45309] mb-0.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>В чём подвох</span>
          </div>
          <div className="text-[10.5px] text-[#78350f] font-medium">
            {briefing.catch}
          </div>
        </div>

        {/* 4. Mechanic Secret */}
        <div className="rounded-xl border border-cyan-600/35 bg-[#ecfeff] px-2 py-1">
          <div className="flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#0e7490] mb-0.5">
            <KeyRound className="w-3 h-3 shrink-0" />
            <span>Секрет механики</span>
          </div>
          <div className="text-[10.5px] text-[#164e63] font-medium">
            {briefing.secret}
          </div>
        </div>
      </div>
    </aside>
  );
}
