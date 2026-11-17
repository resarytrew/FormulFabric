import { useEditorActions } from './hooks/useEditorActions';
import { useSimulationStep } from './hooks/useSimulationStep';
import { useEditorState } from './hooks/useEditorState';
import { useProgressState } from './hooks/useProgressState';
import { useSimulationClock, type AppState } from './hooks/useSimulationClock';
import { useEditHistory } from './hooks/useEditHistory';
import { saveHints, saveUiStyle, type PlacedBlock } from './services/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from './audio/sound';
import {
  BottomDock,
  type VariantSlotId,
  type VariantSummary,
} from './components/BottomDock';
import { BriefingCard } from './components/BriefingCard';
import { CampaignModal } from './components/CampaignModal';
import { GoalCard } from './components/GoalCard';
import { HintsDrawer } from './components/HintsDrawer';
import { MachineInspector } from './components/MachineInspector';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { OutcomeModal } from './components/OutcomeModal';
import { TitleScreen } from './components/TitleScreen';
import { TopHud } from './components/TopHud';
import {
  computeWorldArea,
  createEditableWorldFromLevel,
  createWorldFromLevel,
} from './engine/hex-engine';
import { hexEqual, rotateDir } from './engine/hex-math';
import {
  ALL_PUZZLE_LEVELS,
  CAMPAIGN_LEVELS,
  SANDBOX_LEVEL,
  TOOL_METADATA,
} from './engine/levels';
import type {
  AxialCoord,
  LevelDefinition,
  MachineType,
  SimulationWorld,
  VerificationReport,
} from './engine/types';
import type { PaletteThemeId } from './render/celMaterials';
import { HexScene3D } from './render/HexScene3D';

export default function App() {
  const autostart = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);

  const [appState, setAppState] = useState<AppState>(autostart ? 'playing' : 'title');
  const [theme, setTheme] = useState<PaletteThemeId>('workshop');
  const { uiStyle, setUiStyle, progress, setProgress, variantsMap, setVariantsMap, hintsRevealedByLevel, setHintsRevealedByLevel } = useProgressState();
  const [activeVariant, setActiveVariant] = useState<VariantSlotId>('A');
  const [currentLevelId, setCurrentLevelId] = useState<string>('lvl-01');
  const { playerBlocks, setPlayerBlocks, playerBlocksRef, inspectedCoord, setInspectedCoord, selectedTool, setSelectedTool, selectedDir, setSelectedDir, rotatorMode, setRotatorMode, sandboxSeqInput, setSandboxSeqInput } = useEditorState();
  const { canUndo, canRedo, record: recordEdit, clear: clearEditHistory, undo, redo } = useEditHistory();
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
      saveUiStyle(uiStyle);
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
      // Keep the player's layout visible even when it is invalid: the world is
      // marked as an error world, which blocks the simulation until it is fixed.
      const fresh = createEditableWorldFromLevel(lvl, blocks);
      worldRef.current = fresh;
      setWorld(fresh);
      setIsSimPlaying(false);
    },
    [],
  );

  const commitBlocks = useCallback(
    (nextBlocks: PlacedBlock[], recordHistory = true) => {
      if (recordHistory) {
        recordEdit(playerBlocksRef.current);
      }
      setPlayerBlocks(nextBlocks);
      rebuildWorld(currentLevelRef.current, nextBlocks);
    },
    [rebuildWorld, recordEdit],
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
      clearEditHistory();
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
    [rebuildWorld, clearEditHistory],
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

  const advanceSimulationTick = useSimulationStep({ worldRef, tickHistoryRef, tickProgressRef, currentLevelRef, playerBlocksRef, hintsRevealedRef, activeVariantRef, pendingSoundTimerRef, simSpeedRef, setTickHistoryCount, setWorld, setIsSimPlaying, setFailedVerificationReport, setVictoryReport, setAppState, setProgress, setVariantsMap });

  useSimulationClock({ appState, isSimPlaying, simSpeed, titleTourLevel, advanceSimulationTick, tickProgressRef, worldRef, pendingSoundTimerRef, setWorld });

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
    if (isSimPlaying) return;
    const prev = undo(playerBlocksRef.current);
    if (!prev) return;
    setPlayerBlocks(prev);
    setInspectedCoord((sel) =>
      sel && prev.some((b) => hexEqual(b.coord, sel)) ? sel : null,
    );
    rebuildWorld(currentLevelRef.current, prev);
    sound.playStep();
  }, [isSimPlaying, undo, rebuildWorld]);

  const handleRedo = useCallback(() => {
    if (isSimPlaying) return;
    const next = redo(playerBlocksRef.current);
    if (!next) return;
    setPlayerBlocks(next);
    setInspectedCoord((sel) =>
      sel && next.some((b) => hexEqual(b.coord, sel)) ? sel : null,
    );
    rebuildWorld(currentLevelRef.current, next);
    sound.playStep();
  }, [isSimPlaying, redo, rebuildWorld]);

  const { handleUpdateMachineConfig, handleDeleteBlock, handleSaveVariant, handleSelectVariant, handleHexClick, handleHexRightClick, handleMoveBlock, handleApplyDemo, handleClearBoard } = useEditorActions({ isSimPlaying, appState, inspectedCoord, selectedTool, selectedDir, rotatorMode, sandboxSeqInput, playerBlocks, currentLevel, activeVariant, variantsMap, currentLevelRef, playerBlocksRef, worldRef, setInspectedCoord, setVariantsMap, setActiveVariant, setBudgetWarning, commitBlocks, showBudgetWarning });

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
        if (worldRef.current.status === 'error') {
          showBudgetWarning(
            worldRef.current.errorReason ?? 'Исправьте конфликты схемы перед запуском симуляции.',
          );
        } else if (worldRef.current.status === 'victory') {
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
        events={world.events}
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
              if (world.status === 'error') {
                // An invalid layout cannot be simulated; explain it instead.
                showBudgetWarning(
                  world.errorReason ?? 'Исправьте конфликты схемы перед запуском симуляции.',
                );
                return;
              }
              if (world.status === 'victory') {
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
            canUndo={canUndo}
            canRedo={canRedo}
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
