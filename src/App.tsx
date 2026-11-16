import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from './audio/sound';
import {
  BottomDock,
  type VariantSlotId,
  type VariantSummary,
} from './components/BottomDock';
import { BriefingCard } from './components/BriefingCard';
import { CampaignModal, type LevelProgressRecord } from './components/CampaignModal';
import { GoalCard } from './components/GoalCard';
import { HintsDrawer } from './components/HintsDrawer';
import { MachineInspector } from './components/MachineInspector';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { OutcomeModal } from './components/OutcomeModal';
import { TitleScreen } from './components/TitleScreen';
import { TopHud, type UiStyleMode } from './components/TopHud';
import {
  MAX_SIMULATION_TICKS,
  cloneWorld,
  computeWorldArea,
  createWorldFromLevel,
  getBlockedPlacementInfo,
  stepSimulation,
  verifyLevelSolution,
} from './engine/hex-engine';
import { hexEqual, hexKey, rotateDir } from './engine/hex-math';
import {
  ALL_PUZZLE_LEVELS,
  CAMPAIGN_LEVELS,
  SANDBOX_LEVEL,
  TOOL_METADATA,
} from './engine/levels';
import type {
  AxialCoord,
  HexDir,
  LevelDefinition,
  MachineConfig,
  MachineType,
  RotatorMode,
  SimulationWorld,
  VerificationReport,
} from './engine/types';
import type { PaletteThemeId } from './render/celMaterials';
import { HexScene3D } from './render/HexScene3D';
import { TOKEN_TRIGGER_ALPHA } from './render/tokenAnimationTimeline';

const BASE_SIM_TICK_MS = 1050;

type AppState = 'title' | 'playing' | 'paused' | 'gameover';

interface PlacedBlock {
  type: MachineType;
  coord: AxialCoord;
  config: MachineConfig;
}

interface StoredVariant {
  blocks: PlacedBlock[];
  blocksSig?: string;
  bestTicks?: number;
}

function getBlocksSignature(blocks: PlacedBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.coord.q - b.coord.q || a.coord.r - b.coord.r)
    .map((b) => `${b.type}@${b.coord.q},${b.coord.r}:${JSON.stringify(b.config)}`)
    .join('|');
}

function sanitizeBlocksForLevel(lvl: LevelDefinition, blocks: PlacedBlock[]): PlacedBlock[] {
  const baseWorld = createWorldFromLevel(lvl, []);
  const seen = new Set<string>();
  return blocks
    .filter((b) => {
      const k = hexKey(b.coord);
      if (seen.has(k)) return false;
      seen.add(k);
      return !getBlockedPlacementInfo(baseWorld, b.coord).blocked;
    })
    .map((b) => ({
      type: b.type,
      coord: { ...b.coord },
      config: structuredClone(b.config),
    }));
}

type LevelVariantsMap = Record<string, Partial<Record<VariantSlotId, StoredVariant>>>;

const PROGRESS_STORAGE_KEY = 'fabrika_chisel_progress_v1';
const VARIANTS_STORAGE_KEY = 'fabrika_chisel_variants_v1';
const HINTS_STORAGE_KEY = 'fabrika_chisel_hints_v1';
const UI_STYLE_STORAGE_KEY = 'fabrika_chisel_ui_style_v1';
const MAX_EDIT_HISTORY = 50;
const MAX_TICK_HISTORY = 80;

function loadSavedUiStyle(): UiStyleMode {
  try {
    const raw = localStorage.getItem(UI_STYLE_STORAGE_KEY);
    return raw === 'classic' ? 'classic' : 'skyline';
  } catch {
    return 'skyline';
  }
}

function loadSavedProgress(): Record<string, LevelProgressRecord> {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LevelProgressRecord>;
  } catch {
    return {};
  }
}

function saveProgress(p: Record<string, LevelProgressRecord>) {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore storage errors
  }
}

function loadSavedVariants(): LevelVariantsMap {
  try {
    const raw = localStorage.getItem(VARIANTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LevelVariantsMap;
  } catch {
    return {};
  }
}

function saveVariants(v: LevelVariantsMap) {
  try {
    localStorage.setItem(VARIANTS_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore storage errors
  }
}

function loadSavedHints(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HINTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveHints(h: Record<string, number>) {
  try {
    localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(h));
  } catch {
    // ignore storage errors
  }
}

export default function App() {
  const autostart = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);

  const [appState, setAppState] = useState<AppState>(autostart ? 'playing' : 'title');
  const [theme, setTheme] = useState<PaletteThemeId>('workshop');
  const [uiStyle, setUiStyle] = useState<UiStyleMode>(() => loadSavedUiStyle());
  const [progress, setProgress] = useState<Record<string, LevelProgressRecord>>(() =>
    loadSavedProgress(),
  );
  const [variantsMap, setVariantsMap] = useState<LevelVariantsMap>(() =>
    loadSavedVariants(),
  );
  const [hintsRevealedByLevel, setHintsRevealedByLevel] = useState<Record<string, number>>(
    () => loadSavedHints(),
  );
  const [activeVariant, setActiveVariant] = useState<VariantSlotId>('A');
  const [currentLevelId, setCurrentLevelId] = useState<string>('lvl-01');
  const [playerBlocks, setPlayerBlocks] = useState<PlacedBlock[]>([]);
  const [editPast, setEditPast] = useState<PlacedBlock[][]>([]);
  const [editFuture, setEditFuture] = useState<PlacedBlock[][]>([]);
  const [inspectedCoord, setInspectedCoord] = useState<AxialCoord | null>(null);
  const [victoryReport, setVictoryReport] = useState<VerificationReport | null>(null);
  const [failedVerificationReport, setFailedVerificationReport] =
    useState<VerificationReport | null>(null);
  const [budgetWarning, setBudgetWarning] = useState<string | null>(null);

  // Initial title-tour world uses Level 10 demo solution
  const titleTourLevel = CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.length - 1];
  const [world, setWorld] = useState<SimulationWorld>(() =>
    autostart
      ? createWorldFromLevel(ALL_PUZZLE_LEVELS[0], [])
      : createWorldFromLevel(titleTourLevel, titleTourLevel.demoSolution ?? []),
  );

  const [isSimPlaying, setIsSimPlaying] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<1 | 2 | 4>(1);
  const [selectedTool, setSelectedTool] = useState<
    MachineType | 'erase' | 'select' | null
  >('conveyor');
  const [selectedDir, setSelectedDir] = useState<HexDir>(0);
  const [rotatorMode, setRotatorMode] = useState<RotatorMode>('cw');
  const [sandboxSeqInput, setSandboxSeqInput] = useState<string>('1, 2, 3, 4');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [briefingExpanded, setBriefingExpanded] = useState<boolean>(false);
  const [levelsModalOpen, setLevelsModalOpen] = useState<boolean>(false);
  const [hintsDrawerOpen, setHintsDrawerOpen] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [cameraResetTrigger, setCameraResetTrigger] = useState<number>(0);
  const [continuousCamera, setContinuousCamera] = useState<boolean>(false);
  const [focusCoordTrigger, setFocusCoordTrigger] = useState<{
    coord: AxialCoord;
    seq: number;
  } | null>(null);
  const [tickHistoryCount, setTickHistoryCount] = useState<number>(0);

  const tickProgressRef = useRef<number>(1);
  const tickHistoryRef = useRef<SimulationWorld[]>([]);
  const warningTimerRef = useRef<number | null>(null);
  const pendingSoundTimerRef = useRef<number | null>(null);
  const worldRef = useRef<SimulationWorld>(world);
  worldRef.current = world;
  const hintsRevealedRef = useRef(hintsRevealedByLevel);
  hintsRevealedRef.current = hintsRevealedByLevel;
  const simSpeedRef = useRef<1 | 2 | 4>(simSpeed);
  simSpeedRef.current = simSpeed;

  const currentLevel: LevelDefinition = useMemo(() => {
    if (currentLevelId === 'sandbox') return SANDBOX_LEVEL;
    return (
      ALL_PUZZLE_LEVELS.find((l) => l.id === currentLevelId) ?? ALL_PUZZLE_LEVELS[0]
    );
  }, [currentLevelId]);

  const currentLevelRef = useRef(currentLevel);
  currentLevelRef.current = currentLevel;
  const playerBlocksRef = useRef(playerBlocks);
  playerBlocksRef.current = playerBlocks;
  const activeVariantRef = useRef(activeVariant);
  activeVariantRef.current = activeVariant;

  // Sync document.body.dataset.state for testability & Game Shell contract
  useEffect(() => {
    document.body.dataset.state = appState;
  }, [appState]);

  // Sync Tailwind v4 .dark class & persist UI style ('skyline' vs 'classic')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', uiStyle === 'skyline');
    try {
      localStorage.setItem(UI_STYLE_STORAGE_KEY, uiStyle);
    } catch {
      // ignore storage errors
    }
  }, [uiStyle]);

  const handleToggleUiStyle = useCallback(() => {
    setUiStyle((prev) => (prev === 'skyline' ? 'classic' : 'skyline'));
  }, []);

  const showBudgetWarning = useCallback((msg: string) => {
    setBudgetWarning(msg);
    if (warningTimerRef.current !== null) {
      window.clearTimeout(warningTimerRef.current);
    }
    warningTimerRef.current = window.setTimeout(() => {
      setBudgetWarning(null);
      warningTimerRef.current = null;
    }, 2600);
  }, []);

  const rebuildWorld = useCallback(
    (lvl: LevelDefinition, blocks: PlacedBlock[]) => {
      if (pendingSoundTimerRef.current !== null) {
        window.clearTimeout(pendingSoundTimerRef.current);
        pendingSoundTimerRef.current = null;
      }
      tickProgressRef.current = 1;
      tickHistoryRef.current = [];
      setTickHistoryCount(0);
      setVictoryReport(null);
      setFailedVerificationReport(null);
      const fresh = createWorldFromLevel(lvl, blocks);
      worldRef.current = fresh;
      setWorld(fresh);
      setIsSimPlaying(false);
    },
    [],
  );

  const commitBlocks = useCallback(
    (nextBlocks: PlacedBlock[], recordHistory = true) => {
      if (recordHistory) {
        const prevSnapshot = structuredClone(playerBlocksRef.current);
        setEditPast((past) => [...past.slice(-(MAX_EDIT_HISTORY - 1)), prevSnapshot]);
        setEditFuture([]);
      }
      setPlayerBlocks(nextBlocks);
      rebuildWorld(currentLevelRef.current, nextBlocks);
    },
    [rebuildWorld],
  );

  const loadLevel = useCallback(
    (levelId: string, nextState: AppState = 'playing') => {
      const lvl =
        levelId === 'sandbox'
          ? SANDBOX_LEVEL
          : ALL_PUZZLE_LEVELS.find((l) => l.id === levelId) ?? ALL_PUZZLE_LEVELS[0];
      setCurrentLevelId(lvl.id);
      setActiveVariant('A');
      setPlayerBlocks([]);
      setEditPast([]);
      setEditFuture([]);
      setInspectedCoord(null);
      setSelectedTool(lvl.availableTools[0] ?? 'conveyor');
      setSelectedDir(0);
      setOnboardingDismissed(false);
      setLevelsModalOpen(false);
      setHintsDrawerOpen(false);
      setBudgetWarning(null);
      setHelpOpen(false);
      setFocusCoordTrigger(null);
      rebuildWorld(lvl, []);
      setAppState(nextState);
    },
    [rebuildWorld],
  );

  const handleStartCampaign = useCallback(() => {
    const firstIncomplete = ALL_PUZZLE_LEVELS.find((l) => !progress[l.id]?.completed);
    const target = firstIncomplete ?? ALL_PUZZLE_LEVELS[0];
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    loadLevel(target.id, 'playing');
  }, [loadLevel, progress]);

  const handleStartSandbox = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    loadLevel('sandbox', 'playing');
  }, [loadLevel]);

  // Pure imperative tick stepper: clones world, steps simulation, pushes tick history, & fires side effects OUTSIDE React state updaters
  const advanceSimulationTick = useCallback((isSingleStep: boolean) => {
    const prev = worldRef.current;
    if (prev.status === 'victory' || prev.status === 'error') {
      return;
    }

    const rewindSnapshot = cloneWorld(prev);
    const nextHistory = [
      ...tickHistoryRef.current.slice(-(MAX_TICK_HISTORY - 1)),
      rewindSnapshot,
    ];
    tickHistoryRef.current = nextHistory;
    setTickHistoryCount(nextHistory.length);

    const nextWorld = cloneWorld(prev);
    stepSimulation(nextWorld);
    worldRef.current = nextWorld;
    setWorld(nextWorld);

    if (isSingleStep) {
      tickProgressRef.current = 1;
    }

    const lvl = currentLevelRef.current;
    const blocks = playerBlocksRef.current;
    const latest = nextWorld.events[nextWorld.events.length - 1];

    if (nextWorld.status === 'victory') {
      setIsSimPlaying(false);
      const report = verifyLevelSolution(lvl, blocks, MAX_SIMULATION_TICKS);
      if (report.passed < report.total) {
        const firstFail = report.results.find((r) => !r.passed);
        nextWorld.status = 'error';
        nextWorld.errorReason = firstFail
          ? `Скрытая проверка «${firstFail.name}» не пройдена: ${firstFail.reason ?? 'схема не работает на альтернативных данных'}`
          : 'Скрытая проверка алгоритма не пройдена: решение не является общим.';
        worldRef.current = nextWorld;
        setWorld(nextWorld);
        setFailedVerificationReport(report);
        sound.playError();
        return;
      }

      sound.playVictory();
      setVictoryReport(report);
      setAppState('gameover');

      const area = computeWorldArea(nextWorld);
      const blocksGold = lvl.targets?.blocksGold ?? lvl.maxBlocksBonus;
      const ticksGold = lvl.targets?.ticksGold ?? lvl.maxTicksBonus;
      const areaGold = lvl.targets?.areaGold ?? lvl.maxAreaBonus;
      const earnedMedals = {
        blocks: blocksGold !== undefined ? blocks.length <= blocksGold : true,
        ticks: ticksGold !== undefined ? nextWorld.tick <= ticksGold : true,
        area: areaGold !== undefined ? area <= areaGold : true,
      };
      const hintsUsed = hintsRevealedRef.current[lvl.id] ?? 0;

      setProgress((oldProg) => {
        const prevRec = oldProg[lvl.id];
        const updated: Record<string, LevelProgressRecord> = {
          ...oldProg,
          [lvl.id]: {
            completed: true,
            bestTicks:
              prevRec?.bestTicks !== undefined
                ? Math.min(prevRec.bestTicks, nextWorld.tick)
                : nextWorld.tick,
            bestBlocks:
              prevRec?.bestBlocks !== undefined
                ? Math.min(prevRec.bestBlocks, blocks.length)
                : blocks.length,
            bestArea:
              prevRec?.bestArea !== undefined
                ? Math.min(prevRec.bestArea, area)
                : area,
            medals: {
              blocks: Boolean(prevRec?.medals?.blocks || earnedMedals.blocks),
              ticks: Boolean(prevRec?.medals?.ticks || earnedMedals.ticks),
              area: Boolean(prevRec?.medals?.area || earnedMedals.area),
            },
            hintsUsed:
              prevRec?.hintsUsed !== undefined
                ? Math.min(prevRec.hintsUsed, hintsUsed)
                : hintsUsed,
          },
        };
        saveProgress(updated);
        return updated;
      });

      const slot = activeVariantRef.current;
      const sig = getBlocksSignature(blocks);
      setVariantsMap((oldVars) => {
        const levelVars = oldVars[lvl.id] ?? {};
        const prevSlot = levelVars[slot];
        const prevSig = prevSlot ? (prevSlot.blocksSig ?? getBlocksSignature(prevSlot.blocks)) : undefined;
        const nextBest =
          prevSlot?.bestTicks !== undefined && prevSig === sig
            ? Math.min(prevSlot.bestTicks, nextWorld.tick)
            : nextWorld.tick;
        const updatedVars: LevelVariantsMap = {
          ...oldVars,
          [lvl.id]: {
            ...levelVars,
            [slot]: {
              blocks: structuredClone(blocks),
              blocksSig: sig,
              bestTicks: nextBest,
            },
          },
        };
        saveVariants(updatedVars);
        return updatedVars;
      });
    } else {
      if (pendingSoundTimerRef.current !== null) {
        window.clearTimeout(pendingSoundTimerRef.current);
        pendingSoundTimerRef.current = null;
      }

      if (nextWorld.status === 'error') {
        sound.playError();
        setIsSimPlaying(false);
      } else if (isSingleStep) {
        if (latest?.type === 'deliver') sound.playDeliver();
        else if (latest?.type === 'weld') sound.playWeld();
        else if (latest?.type === 'destroy') sound.playDestroy();
        else if (latest?.type === 'transform' || latest?.type === 'cut' || latest?.type === 'store') sound.playTransform();
        else sound.playStep();
      } else {
        const tickEvents = nextWorld.events.filter((ev) => ev.tick === nextWorld.tick);
        const triggerEv =
          tickEvents.find((ev) => ev.type === 'deliver') ??
          tickEvents.find((ev) => ev.type === 'weld' || ev.type === 'cut') ??
          tickEvents.find((ev) => ev.type === 'destroy') ??
          tickEvents.find((ev) => ev.type === 'transform' || ev.type === 'store');

        if (triggerEv) {
          const delayMs = Math.max(
            40,
            Math.round((BASE_SIM_TICK_MS / simSpeedRef.current) * TOKEN_TRIGGER_ALPHA),
          );
          pendingSoundTimerRef.current = window.setTimeout(() => {
            pendingSoundTimerRef.current = null;
            if (triggerEv.type === 'deliver') sound.playDeliver();
            else if (triggerEv.type === 'weld' || triggerEv.type === 'cut') sound.playWeld();
            else if (triggerEv.type === 'destroy') sound.playDestroy();
            else sound.playTransform();
          }, delayMs);
        } else {
          sound.playStep();
        }
      }
    }
  }, []);

  // Title Screen ambient showcase loop & Playing Simulation Stepper
  useEffect(() => {
    if (appState === 'title') {
      const intervalMs = BASE_SIM_TICK_MS;
      let lastTickTime = performance.now();
      let animId = 0;

      const frame = (now: number) => {
        const elapsed = now - lastTickTime;
        tickProgressRef.current = Math.min(1, elapsed / intervalMs);
        if (elapsed >= intervalMs) {
          lastTickTime = now;
          tickProgressRef.current = 0;
          const prev = worldRef.current;
          if (prev.status === 'victory' || prev.status === 'error' || prev.tick > 45) {
            const fresh = createWorldFromLevel(
              titleTourLevel,
              titleTourLevel.demoSolution ?? [],
            );
            worldRef.current = fresh;
            setWorld(fresh);
          } else {
            const nextClone = cloneWorld(prev);
            stepSimulation(nextClone);
            worldRef.current = nextClone;
            setWorld(nextClone);
          }
        }
        animId = requestAnimationFrame(frame);
      };
      animId = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(animId);
    }

    if (appState !== 'playing' || !isSimPlaying) {
      tickProgressRef.current = 1;
      return;
    }

    const intervalMs = BASE_SIM_TICK_MS / simSpeed;
    let lastTickTime = performance.now();
    let animId = 0;

    const frame = (now: number) => {
      const elapsed = now - lastTickTime;
      tickProgressRef.current = Math.min(1, elapsed / intervalMs);

      if (elapsed >= intervalMs) {
        lastTickTime = now;
        tickProgressRef.current = 0;
        advanceSimulationTick(false);
      }
      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animId);
      if (pendingSoundTimerRef.current !== null) {
        window.clearTimeout(pendingSoundTimerRef.current);
        pendingSoundTimerRef.current = null;
      }
    };
  }, [appState, isSimPlaying, simSpeed, titleTourLevel, advanceSimulationTick]);

  const handleStepOnce = useCallback(() => {
    if (isSimPlaying) return;
    advanceSimulationTick(true);
  }, [isSimPlaying, advanceSimulationTick]);

  const handleStepBack = useCallback(() => {
    if (isSimPlaying) return;
    const hist = tickHistoryRef.current;
    if (hist.length === 0) return;
    const prevWorld = hist[hist.length - 1];
    const nextHist = hist.slice(0, -1);
    tickHistoryRef.current = nextHist;
    setTickHistoryCount(nextHist.length);
    tickProgressRef.current = 1;
    worldRef.current = prevWorld;
    setWorld(prevWorld);
    setVictoryReport(null);
    setAppState('playing');
    sound.playStep();
  }, [isSimPlaying]);

  const handleResetSim = useCallback(() => {
    setIsSimPlaying(false);
    setAppState('playing');
    rebuildWorld(currentLevel, playerBlocks);
  }, [currentLevel, playerBlocks, rebuildWorld]);

  const handleUndo = useCallback(() => {
    if (isSimPlaying || editPast.length === 0) return;
    const prev = editPast[editPast.length - 1];
    const currentSnapshot = structuredClone(playerBlocksRef.current);
    setEditPast((p) => p.slice(0, -1));
    setEditFuture((f) => [currentSnapshot, ...f]);
    setPlayerBlocks(prev);
    setInspectedCoord((sel) =>
      sel && prev.some((b) => hexEqual(b.coord, sel)) ? sel : null,
    );
    rebuildWorld(currentLevelRef.current, prev);
    sound.playStep();
  }, [isSimPlaying, editPast, rebuildWorld]);

  const handleRedo = useCallback(() => {
    if (isSimPlaying || editFuture.length === 0) return;
    const next = editFuture[0];
    const currentSnapshot = structuredClone(playerBlocksRef.current);
    setEditFuture((f) => f.slice(1));
    setEditPast((p) => [...p.slice(-(MAX_EDIT_HISTORY - 1)), currentSnapshot]);
    setPlayerBlocks(next);
    setInspectedCoord((sel) =>
      sel && next.some((b) => hexEqual(b.coord, sel)) ? sel : null,
    );
    rebuildWorld(currentLevelRef.current, next);
    sound.playStep();
  }, [isSimPlaying, editFuture, rebuildWorld]);

  const handleUpdateMachineConfig = useCallback(
    (coord: AxialCoord, patch: Partial<MachineConfig>) => {
      if (isSimPlaying) return;
      const idx = playerBlocksRef.current.findIndex((b) => hexEqual(b.coord, coord));
      if (idx === -1) return;
      const nextBlocks = playerBlocksRef.current.map((b, i) =>
        i === idx ? { ...b, config: { ...b.config, ...patch } } : b,
      );
      sound.playRotate();
      commitBlocks(nextBlocks, true);
    },
    [isSimPlaying, commitBlocks],
  );

  const handleDeleteBlock = useCallback(
    (coord: AxialCoord) => {
      if (isSimPlaying) return;
      const nextBlocks = playerBlocksRef.current.filter((b) => !hexEqual(b.coord, coord));
      if (nextBlocks.length !== playerBlocksRef.current.length) {
        sound.playRemove();
        if (inspectedCoord && hexEqual(inspectedCoord, coord)) {
          setInspectedCoord(null);
        }
        commitBlocks(nextBlocks, true);
      }
    },
    [isSimPlaying, inspectedCoord, commitBlocks],
  );

  const handleSaveVariant = useCallback(
    (slot: VariantSlotId) => {
      if (isSimPlaying) return;
      const lvlId = currentLevelRef.current.id;
      const blocksCopy = structuredClone(playerBlocksRef.current);
      const nextSig = getBlocksSignature(blocksCopy);
      setVariantsMap((old) => {
        const lvlVars = old[lvlId] ?? {};
        const prevSlot = lvlVars[slot];
        const prevSig = prevSlot ? (prevSlot.blocksSig ?? getBlocksSignature(prevSlot.blocks)) : undefined;
        const prevBest = prevSlot?.bestTicks;
        const updated: LevelVariantsMap = {
          ...old,
          [lvlId]: {
            ...lvlVars,
            [slot]: {
              blocks: blocksCopy,
              blocksSig: nextSig,
              bestTicks: prevSig === nextSig ? prevBest : undefined,
            },
          },
        };
        saveVariants(updated);
        return updated;
      });
      setActiveVariant(slot);
      sound.playPlace();
    },
    [isSimPlaying],
  );

  const handleSelectVariant = useCallback(
    (slot: VariantSlotId) => {
      if (isSimPlaying || slot === activeVariant) return;
      const lvlId = currentLevelRef.current.id;
      // Auto-snapshot current non-empty work into previous slot before switching
      const currBlocks = structuredClone(playerBlocksRef.current);
      const nextVariants = structuredClone(variantsMap);
      const lvlVars = nextVariants[lvlId] ?? {};
      if (currBlocks.length > 0) {
        const oldSlot = lvlVars[activeVariant];
        const currSig = getBlocksSignature(currBlocks);
        const oldSig = oldSlot ? (oldSlot.blocksSig ?? getBlocksSignature(oldSlot.blocks)) : undefined;
        lvlVars[activeVariant] = {
          blocks: currBlocks,
          blocksSig: currSig,
          bestTicks: oldSlot && oldSig === currSig ? oldSlot.bestTicks : undefined,
        };
      }
      nextVariants[lvlId] = lvlVars;
      saveVariants(nextVariants);
      setVariantsMap(nextVariants);

      const targetBlocks = lvlVars[slot]?.blocks
        ? sanitizeBlocksForLevel(currentLevelRef.current, lvlVars[slot]!.blocks)
        : [];
      setActiveVariant(slot);
      setInspectedCoord(null);
      commitBlocks(targetBlocks, true);
      sound.playStep();
    },
    [isSimPlaying, activeVariant, variantsMap, commitBlocks],
  );

  const handleHexClick = useCallback(
    (coord: AxialCoord) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const key = hexKey(coord);
      if (selectedTool !== 'select' && selectedTool !== 'erase') {
        const blockCheck = getBlockedPlacementInfo(worldRef.current, coord);
        if (blockCheck.blocked) {
          sound.playError();
          if (blockCheck.reason) {
            showBudgetWarning(blockCheck.reason);
          }
          return;
        }
      } else if (!worldRef.current.platformHexes.has(key)) {
        sound.playError();
        showBudgetWarning('Нельзя разместить блок над разломом платформы.');
        return;
      }

      if (selectedTool === 'select') {
        const found = playerBlocks.find((b) => hexEqual(b.coord, coord));
        if (found) {
          setInspectedCoord({ ...coord });
          sound.playStep();
        } else {
          setInspectedCoord(null);
        }
        return;
      }

      if (selectedTool === 'erase') {
        handleDeleteBlock(coord);
        return;
      }

      if (!selectedTool) return;

      const lvl = currentLevelRef.current;
      const existingIdx = playerBlocks.findIndex((b) => hexEqual(b.coord, coord));
      let nextBlocks: PlacedBlock[];

      if (existingIdx !== -1 && playerBlocks[existingIdx].type === selectedTool) {
        // Rotate existing machine in place & open it in Inspector!
        const nextDir = rotateDir(playerBlocks[existingIdx].config.dir, 1);
        nextBlocks = playerBlocks.map((b, idx) =>
          idx === existingIdx
            ? {
                ...b,
                config: {
                  ...b.config,
                  dir: nextDir,
                  altDir: rotateDir(nextDir, 1),
                  rotMode: selectedTool === 'rotator' ? rotatorMode : b.config.rotMode,
                },
              }
            : b,
        );
        setInspectedCoord({ ...coord });
        sound.playRotate();
      } else {
        // Enforce total budget & per-type part limits before adding or swapping
        if (
          existingIdx === -1 &&
          lvl.maxTotalBlocks !== undefined &&
          playerBlocks.length >= lvl.maxTotalBlocks
        ) {
          sound.playError();
          showBudgetWarning(
            `Достигнут лимит блоков (${playerBlocks.length}/${lvl.maxTotalBlocks}). Удалите или замените лишний модуль.`,
          );
          return;
        }

        const partLimit = lvl.partLimits?.[selectedTool];
        if (partLimit !== undefined) {
          const usedOther = playerBlocks.filter(
            (b, i) => i !== existingIdx && b.type === selectedTool,
          ).length;
          if (usedOther >= partLimit) {
            sound.playError();
            showBudgetWarning(
              `Лимит модуля «${TOOL_METADATA[selectedTool].label}» (${partLimit} шт.) исчерпан.`,
            );
            return;
          }
        }

        const parsedSeq = sandboxSeqInput
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        const newConfig: MachineConfig = {
          dir: selectedDir,
          altDir: rotateDir(selectedDir, 1),
          rotMode: selectedTool === 'rotator' ? rotatorMode : undefined,
          filterRule: selectedTool === 'filter' ? 'even' : undefined,
          divisor: selectedTool === 'divmod' ? (lvl.fixedDivisor ?? 2) : undefined,
          sequence:
            selectedTool === 'spawner'
              ? parsedSeq.length > 0
                ? parsedSeq
                : [1, 2, 3]
              : undefined,
          loopSequence: selectedTool === 'spawner' ? true : undefined,
          spawnInterval: selectedTool === 'spawner' ? 3 : undefined,
          targetPattern:
            selectedTool === 'sink'
              ? {
                  mode: 'exact',
                  nodes: [{ offset: { q: 0, r: 0 } }],
                  edges: [],
                  rotationInvariant: true,
                  label: 'Любое',
                }
              : undefined,
        };
        const filtered = playerBlocks.filter((b) => !hexEqual(b.coord, coord));
        nextBlocks = [...filtered, { type: selectedTool, coord: { ...coord }, config: newConfig }];
        setInspectedCoord({ ...coord });
        setBudgetWarning(null);
        sound.playPlace();
      }

      commitBlocks(nextBlocks, true);
    },
    [
      appState,
      isSimPlaying,
      selectedTool,
      selectedDir,
      rotatorMode,
      sandboxSeqInput,
      playerBlocks,
      commitBlocks,
      handleDeleteBlock,
      showBudgetWarning,
    ],
  );

  const handleHexRightClick = useCallback(
    (coord: AxialCoord) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const existing = worldRef.current.machines.get(hexKey(coord));
      if (existing?.locked) return;
      handleDeleteBlock(coord);
    },
    [appState, isSimPlaying, handleDeleteBlock],
  );

  const handleMoveBlock = useCallback(
    (fromCoord: AxialCoord, toCoord: AxialCoord, newDir?: HexDir) => {
      if (appState !== 'playing' || isSimPlaying) return;
      const blockCheck = getBlockedPlacementInfo(worldRef.current, toCoord);
      if (blockCheck.blocked) {
        sound.playError();
        showBudgetWarning(blockCheck.reason ?? 'Целевой гекс недоступен для размещения.');
        return;
      }

      const blocks = playerBlocksRef.current;
      const fromIdx = blocks.findIndex((b) => hexEqual(b.coord, fromCoord));
      if (fromIdx === -1) return;

      const moving = blocks[fromIdx];
      const nextDir = newDir ?? moving.config.dir;
      const dirDelta = ((nextDir - moving.config.dir) % 6 + 6) % 6;
      const nextAltDir =
        moving.config.altDir !== undefined
          ? rotateDir(moving.config.altDir, dirDelta)
          : rotateDir(nextDir, 1);

      const destIdx = blocks.findIndex((b) => hexEqual(b.coord, toCoord));
      if (hexEqual(fromCoord, toCoord) && dirDelta === 0) return;

      const updatedMoving: PlacedBlock = {
        ...moving,
        coord: { ...toCoord },
        config: {
          ...moving.config,
          dir: nextDir,
          altDir: nextAltDir,
        },
      };

      let nextBlocks: PlacedBlock[];
      if (destIdx !== -1 && destIdx !== fromIdx) {
        // Swap with unlocked player block on destination hex cleanly
        const swappedDest: PlacedBlock = {
          ...blocks[destIdx],
          coord: { ...fromCoord },
        };
        nextBlocks = blocks.map((b, i) =>
          i === fromIdx ? updatedMoving : i === destIdx ? swappedDest : b,
        );
      } else {
        nextBlocks = blocks.map((b, i) => (i === fromIdx ? updatedMoving : b));
      }

      setInspectedCoord({ ...toCoord });
      setBudgetWarning(null);
      sound.playPlace();
      commitBlocks(nextBlocks, true);
    },
    [appState, isSimPlaying, commitBlocks, showBudgetWarning],
  );

  const handleApplyDemo = useCallback(
    (variantIdx = 0) => {
      if (isSimPlaying) return;
      const sourceBlocks =
        variantIdx === 0
          ? currentLevel.demoSolution
          : currentLevel.altDemoSolutions?.[variantIdx - 1]?.blocks;
      if (!sourceBlocks) return;
      const demoBlocks: PlacedBlock[] = sourceBlocks.map((d) => ({
        type: d.type,
        coord: { ...d.coord },
        config: { ...d.config },
      }));
      sound.playPlace();
      setInspectedCoord(null);
      commitBlocks(demoBlocks, true);
    },
    [isSimPlaying, currentLevel, commitBlocks],
  );

  const handleClearBoard = useCallback(() => {
    if (isSimPlaying) return;
    sound.playRemove();
    setInspectedCoord(null);
    commitBlocks([], true);
  }, [isSimPlaying, commitBlocks]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (appState === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartCampaign();
        }
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (hintsDrawerOpen) {
          setHintsDrawerOpen(false);
        } else if (helpOpen) {
          setHelpOpen(false);
        } else if (levelsModalOpen) {
          setLevelsModalOpen(false);
        } else if (inspectedCoord) {
          setInspectedCoord(null);
        } else if (appState === 'playing') {
          setIsSimPlaying(false);
          setAppState('paused');
        } else if (appState === 'paused') {
          setAppState('playing');
        }
        return;
      }

      if (e.code === 'KeyM') {
        setMuted((prev) => {
          sound.muted = !prev;
          return !prev;
        });
        return;
      }

      if (appState !== 'playing') return;

      // Undo / Redo shortcuts
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.code === 'Delete' || e.code === 'Backspace') && inspectedCoord) {
        e.preventDefault();
        handleDeleteBlock(inspectedCoord);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (worldRef.current.status === 'victory' || worldRef.current.status === 'error') {
          handleResetSim();
        } else {
          setIsSimPlaying((p) => !p);
        }
      } else if (e.code === 'KeyR') {
        sound.playRotate();
        setSelectedDir((d) => rotateDir(d, 1));
      } else if (e.code === 'KeyV') {
        setSelectedTool('select');
      } else if (e.code === 'KeyX') {
        setSelectedTool('erase');
      } else if (e.code === 'KeyH') {
        setDockCollapsed((c) => !c);
      } else if (e.code === 'KeyI') {
        setBriefingExpanded((v) => !v);
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const tool = currentLevel.availableTools[idx];
        if (tool) setSelectedTool(tool);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const matched = currentLevel.availableTools.find(
          (t) => TOOL_METADATA[t].hotkey.toUpperCase() === e.key.toUpperCase(),
        );
        if (matched) setSelectedTool(matched);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    appState,
    hintsDrawerOpen,
    helpOpen,
    levelsModalOpen,
    inspectedCoord,
    currentLevel.availableTools,
    handleStartCampaign,
    handleResetSim,
    handleUndo,
    handleRedo,
    handleDeleteBlock,
  ]);

  const inspectedBlock = useMemo(() => {
    if (!inspectedCoord) return null;
    return playerBlocks.find((b) => hexEqual(b.coord, inspectedCoord)) ?? null;
  }, [inspectedCoord, playerBlocks]);

  const variantSummaries = useMemo(() => {
    const levelVars = variantsMap[currentLevel.id] ?? {};
    const out: Partial<Record<VariantSlotId, VariantSummary>> = {};
    (['A', 'B', 'C'] as VariantSlotId[]).forEach((slot) => {
      const entry = levelVars[slot];
      if (entry && entry.blocks.length > 0) {
        out[slot] = { blocks: entry.blocks.length, bestTicks: entry.bestTicks };
      }
    });
    return out;
  }, [variantsMap, currentLevel.id]);

  // Compute Onboarding Step for Level 1
  const onboardingInfo = useMemo(() => {
    if (
      onboardingDismissed ||
      appState !== 'playing' ||
      !currentLevel.onboarding ||
      currentLevel.onboarding.length === 0
    ) {
      return { step: null, stepIndex: 0, total: 0 };
    }
    const steps = currentLevel.onboarding;
    const hasAdd1AtCenter = playerBlocks.some(
      (b) => b.type === 'add1' && b.coord.q === 0 && b.coord.r === 0,
    );
    if (isSimPlaying || world.tick > 0) {
      return { step: null, stepIndex: 3, total: steps.length };
    }
    if (hasAdd1AtCenter) {
      return { step: steps[2], stepIndex: 2, total: steps.length };
    }
    if (selectedTool === 'add1') {
      return { step: steps[1], stepIndex: 1, total: steps.length };
    }
    return { step: steps[0], stepIndex: 0, total: steps.length };
  }, [
    onboardingDismissed,
    appState,
    currentLevel.onboarding,
    playerBlocks,
    selectedTool,
    isSimPlaying,
    world.tick,
  ]);

  const completedCount = useMemo(
    () => ALL_PUZZLE_LEVELS.filter((l) => progress[l.id]?.completed).length,
    [progress],
  );

  const areaMetric = useMemo(() => computeWorldArea(world), [world]);

  const toolCounts = useMemo(() => {
    const counts: Partial<Record<MachineType, number>> = {};
    for (const b of playerBlocks) {
      counts[b.type] = (counts[b.type] ?? 0) + 1;
    }
    return counts;
  }, [playerBlocks]);

  const canShowDemo = Boolean(currentLevel.demoSolution);
  const revealedHintsCount = hintsRevealedByLevel[currentLevel.id] ?? 0;

  const handleRevealNextHint = useCallback(() => {
    const total = currentLevel.hints?.length ?? 0;
    if (total === 0) return;
    setHintsRevealedByLevel((old) => {
      const curr = old[currentLevel.id] ?? 0;
      if (curr >= total) return old;
      const next = { ...old, [currentLevel.id]: curr + 1 };
      saveHints(next);
      return next;
    });
    sound.playStep();
  }, [currentLevel.id, currentLevel.hints]);

  const currentIdx = ALL_PUZZLE_LEVELS.findIndex((l) => l.id === currentLevel.id);
  const nextLevel =
    currentIdx >= 0 && currentIdx < ALL_PUZZLE_LEVELS.length - 1
      ? ALL_PUZZLE_LEVELS[currentIdx + 1]
      : null;

  return (
    <main className="relative w-full h-full overflow-hidden">
      {/* Isolated 3D WebGL Viewport */}
      <HexScene3D
        world={world}
        theme={theme}
        isTitleMode={appState === 'title'}
        isSimPlaying={isSimPlaying}
        continuousCamera={continuousCamera}
        onStopContinuousCamera={() => setContinuousCamera(false)}
        focusCoordTrigger={focusCoordTrigger}
        selectedTool={selectedTool}
        selectedDir={selectedDir}
        rotatorMode={rotatorMode}
        tickProgressRef={tickProgressRef}
        highlightCoord={onboardingInfo.step?.highlightCoord}
        inspectedCoord={inspectedBlock?.coord ?? null}
        onHexClick={handleHexClick}
        onHexRightClick={handleHexRightClick}
        onMoveBlock={handleMoveBlock}
        cameraResetTrigger={cameraResetTrigger}
      />

      {/* Title Screen */}
      {appState === 'title' && (
        <TitleScreen
          onStartCampaign={handleStartCampaign}
          onStartSandbox={handleStartSandbox}
          onOpenLevels={() => setLevelsModalOpen(true)}
          theme={theme}
          onChangeTheme={setTheme}
          uiStyle={uiStyle}
          onToggleUiStyle={handleToggleUiStyle}
          completedCount={completedCount}
          totalLevels={ALL_PUZZLE_LEVELS.length}
        />
      )}

      {/* Active Gameplay HUD */}
      {appState !== 'title' && (
        <>
          <TopHud
            level={currentLevel}
            world={world}
            isPlaying={isSimPlaying}
            canStepBack={tickHistoryCount > 0}
            simSpeed={simSpeed}
            theme={theme}
            uiStyle={uiStyle}
            muted={muted}
            continuousCamera={continuousCamera}
            onTogglePlay={() => {
              if (world.status === 'victory' || world.status === 'error') {
                handleResetSim();
              } else {
                setIsSimPlaying((p) => !p);
              }
            }}
            onStepBack={handleStepBack}
            onStep={handleStepOnce}
            onReset={handleResetSim}
            onCycleSpeed={() =>
              setSimSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))
            }
            onOpenLevels={() => {
              setIsSimPlaying(false);
              setLevelsModalOpen(true);
            }}
            onChangeTheme={setTheme}
            onToggleUiStyle={handleToggleUiStyle}
            onResetCamera={() => {
              setContinuousCamera(false);
              setCameraResetTrigger((c) => c + 1);
            }}
            onToggleContinuousCamera={() => setContinuousCamera((v) => !v)}
            onToggleMute={() => {
              setMuted((m) => {
                sound.muted = !m;
                return !m;
              });
            }}
            onToggleHelp={() => setHelpOpen((h) => !h)}
            onOpenPause={() => {
              setIsSimPlaying(false);
              setAppState('paused');
            }}
          />

          {/* Non-blocking Quota / Placement Warning Toast */}
          {budgetWarning && (
            <div
              role="status"
              aria-live="polite"
              className="fixed top-20 left-1/2 -translate-x-1/2 z-30 hud-panel rounded-xl px-4 py-2 bg-[#fffbeb] dark:bg-amber-950/95 text-xs font-bold text-[#92400e] dark:text-amber-200 dark:border-amber-400/50 max-w-md text-center"
            >
              {budgetWarning}
            </div>
          )}

          {/* Top-left Compact «Задача?» Chip / Expandable 10-second Briefing Card */}
          {appState === 'playing' &&
            currentLevel.briefing &&
            !onboardingInfo.step &&
            world.status !== 'error' &&
            !levelsModalOpen &&
            !hintsDrawerOpen &&
            !helpOpen && (
              <div className="fixed top-[9.75rem] sm:top-16 left-3 z-[24] pointer-events-none">
                <BriefingCard
                  level={currentLevel}
                  expanded={briefingExpanded}
                  onToggle={setBriefingExpanded}
                />
              </div>
            )}

          {/* Top-right Unified Skylines Goal + Telemetry + Flow Sparkline Card */}
          {appState === 'playing' &&
            !inspectedBlock &&
            world.status !== 'error' &&
            !levelsModalOpen &&
            !hintsDrawerOpen &&
            !helpOpen && (
              <div className="fixed top-[9.75rem] sm:top-16 right-3 z-[25] pointer-events-none flex flex-col items-end gap-2">
                <GoalCard
                  level={currentLevel}
                  world={world}
                  playerBlockCount={playerBlocks.length}
                  area={areaMetric}
                />
              </div>
            )}

          {/* Machine Property Inspector */}
          {appState === 'playing' &&
            inspectedBlock &&
            !isSimPlaying &&
            world.status !== 'error' && (
              <MachineInspector
                block={inspectedBlock}
                isRunning={isSimPlaying}
                fixedDivisor={currentLevel.fixedDivisor}
                onUpdateConfig={handleUpdateMachineConfig}
                onDelete={handleDeleteBlock}
                onClose={() => setInspectedCoord(null)}
              />
            )}

          <BottomDock
            availableTools={currentLevel.availableTools}
            selectedTool={selectedTool}
            selectedDir={selectedDir}
            rotatorMode={rotatorMode}
            sandboxSeqInput={sandboxSeqInput}
            isSandbox={currentLevel.id === 'sandbox'}
            isRunning={isSimPlaying}
            canUndo={editPast.length > 0}
            canRedo={editFuture.length > 0}
            hasDemo={canShowDemo}
            hintsCount={currentLevel.hints?.length ?? 0}
            revealedHintsCount={revealedHintsCount}
            maxTotalBlocks={currentLevel.maxTotalBlocks}
            playerBlockCount={playerBlocks.length}
            partLimits={currentLevel.partLimits}
            toolCounts={toolCounts}
            activeVariant={activeVariant}
            variantSummaries={variantSummaries}
            events={world.events}
            collapsed={dockCollapsed}
            onToggleCollapse={() => setDockCollapsed((c) => !c)}
            onSelectTool={(t) => setSelectedTool(t)}
            onRotateDir={() => {
              sound.playRotate();
              setSelectedDir((d) => rotateDir(d, 1));
            }}
            onToggleRotMode={() =>
              setRotatorMode((m) => (m === 'cw' ? 'ccw' : 'cw'))
            }
            onSandboxSeqChange={setSandboxSeqInput}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSelectVariant={handleSelectVariant}
            onSaveVariant={handleSaveVariant}
            onOpenHints={() => {
              setIsSimPlaying(false);
              setHintsDrawerOpen(true);
            }}
            onClearBoard={handleClearBoard}
          />

          <OnboardingOverlay
            level={currentLevel}
            step={onboardingInfo.step}
            stepIndex={onboardingInfo.stepIndex}
            totalSteps={onboardingInfo.total}
            helpOpen={helpOpen}
            onDismissHelp={() => setHelpOpen(false)}
            onDismissOnboarding={() => setOnboardingDismissed(true)}
          />
        </>
      )}

      {/* Diagnostic Alert Card when simulation halts with collision/math/verification error */}
      {appState === 'playing' && world.status === 'error' && (
        <OutcomeModal
          mode="error"
          level={currentLevel}
          world={world}
          playerBlockCount={playerBlocks.length}
          area={areaMetric}
          verificationReport={failedVerificationReport}
          hasNextLevel={!!nextLevel}
          onNextLevel={() => {}}
          onReplay={handleResetSim}
          onResume={() => {}}
          onBackToTitle={() => setAppState('title')}
          onFixAndReset={handleResetSim}
          onFocusError={
            world.errorHighlightHexes.length > 0
              ? () => {
                  setContinuousCamera(false);
                  setFocusCoordTrigger((prev) => ({
                    coord: { ...world.errorHighlightHexes[0] },
                    seq: (prev?.seq ?? 0) + 1,
                  }));
                }
              : undefined
          }
        />
      )}

      {/* Pause Modal */}
      {appState === 'paused' && (
        <OutcomeModal
          mode="paused"
          level={currentLevel}
          world={world}
          playerBlockCount={playerBlocks.length}
          area={areaMetric}
          hasNextLevel={!!nextLevel}
          onNextLevel={() => {}}
          onReplay={handleResetSim}
          onResume={() => setAppState('playing')}
          onBackToTitle={() => {
            setIsSimPlaying(false);
            const tourWorld = createWorldFromLevel(
              titleTourLevel,
              titleTourLevel.demoSolution ?? [],
            );
            worldRef.current = tourWorld;
            setWorld(tourWorld);
            setAppState('title');
          }}
          onFixAndReset={handleResetSim}
        />
      )}

      {/* Victory Modal */}
      {appState === 'gameover' && (
        <OutcomeModal
          mode="victory"
          level={currentLevel}
          world={world}
          playerBlockCount={playerBlocks.length}
          area={areaMetric}
          hintsUsed={revealedHintsCount}
          verificationReport={victoryReport}
          hasNextLevel={!!nextLevel}
          onNextLevel={() => nextLevel && loadLevel(nextLevel.id, 'playing')}
          onReplay={handleResetSim}
          onApplyDemo={
            canShowDemo
              ? (variantIdx) => {
                  setAppState('playing');
                  handleApplyDemo(variantIdx);
                }
              : undefined
          }
          onResume={() => {}}
          onBackToTitle={() => setAppState('title')}
          onFixAndReset={handleResetSim}
        />
      )}

      {/* Progressive 3-Tier Hints Modal */}
      {hintsDrawerOpen && (
        <HintsDrawer
          level={currentLevel}
          revealedCount={revealedHintsCount}
          onRevealNext={handleRevealNextHint}
          onApplyDemoSolution={handleApplyDemo}
          onClose={() => setHintsDrawerOpen(false)}
        />
      )}

      {/* Campaign & Sandbox Selector Modal */}
      {levelsModalOpen && (
        <CampaignModal
          currentLevelId={currentLevel.id}
          progress={progress}
          onSelectLevel={(id) => loadLevel(id, 'playing')}
          onSelectSandbox={handleStartSandbox}
          onClose={() => setLevelsModalOpen(false)}
        />
      )}
    </main>
  );
}
