import { useRef, useState } from 'react';
import type { AxialCoord, HexDir, MachineType, RotatorMode } from '../engine/types';
import type { PlacedBlock } from '../services/storage';

export function useEditorState() {
  const [playerBlocks, setPlayerBlocks] = useState<PlacedBlock[]>([]);
  const playerBlocksRef = useRef(playerBlocks);
  playerBlocksRef.current = playerBlocks;
  const [inspectedCoord, setInspectedCoord] = useState<AxialCoord | null>(null);
  const [selectedTool, setSelectedTool] = useState<MachineType | 'erase' | 'select' | null>('conveyor');
  const [selectedDir, setSelectedDir] = useState<HexDir>(0);
  const [rotatorMode, setRotatorMode] = useState<RotatorMode>('cw');
  const [sandboxSeqInput, setSandboxSeqInput] = useState('1, 2, 3, 4');
  return { playerBlocks, setPlayerBlocks, playerBlocksRef, inspectedCoord, setInspectedCoord, selectedTool, setSelectedTool, selectedDir, setSelectedDir, rotatorMode, setRotatorMode, sandboxSeqInput, setSandboxSeqInput };
}
