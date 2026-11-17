import { hexEqual, hexKey, rotateAroundPivot } from './hex-math';
import type { ConnectedComponent } from './components';
import type { AxialCoord, HexKey, SimulationWorld, TargetPattern, Token } from './types';

/**
 * Exact graph matching for Sink / Receiver constrained strictly to drawn sink footprint pads.
 */
export function matchComponentToPattern(
  component: ConnectedComponent,
  world: SimulationWorld,
  sinkCoord: AxialCoord,
  pattern: TargetPattern,
  deliveryIdx = 0,
): { matched: boolean; reason?: string; matchedValues?: number[] } {
  const tokens = component.tokenIds.map((id) => world.tokens.get(id)!);
  if (tokens.length !== pattern.nodes.length) {
    return { matched: false, reason: 'Несовпадение числа звеньев полимера' };
  }
  if (component.bondIndices.length !== pattern.edges.length) {
    return { matched: false, reason: 'Несовпадение структуры связей' };
  }

  const sinkFootprint = pattern.nodes.map((n) => ({
    q: sinkCoord.q + n.offset.q,
    r: sinkCoord.r + n.offset.r,
  }));
  const footprintSet = new Set<HexKey>(sinkFootprint.map(hexKey));
  const tokenCoordKeys = new Set<HexKey>(tokens.map((t) => hexKey(t.coord)));
  if (
    tokenCoordKeys.size !== footprintSet.size ||
    !sinkFootprint.every((f) => tokenCoordKeys.has(hexKey(f)))
  ) {
    return {
      matched: false,
      reason: 'Звенья полимера выходят за пределы посадочной площадки приёмника',
    };
  }

  const rotationsToTry = pattern.rotationInvariant ? [0, 1, 2, 3, 4, 5] : [0];

  const bondSet = new Set<string>();
  for (const idx of component.bondIndices) {
    const e = world.bonds[idx];
    const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    bondSet.add(k);
  }

  const expectedForStep = pattern.expectedNodeValues?.[deliveryIdx];
  let lastMismatchReason: string | undefined;

  for (const rot of rotationsToTry) {
    const rot0 = rotateAroundPivot(pattern.nodes[0].offset, { q: 0, r: 0 }, rot);
    const candidateShifts: AxialCoord[] = [];
    const seenShifts = new Set<HexKey>();
    if (pattern.rotationInvariant) {
      for (const target0 of sinkFootprint) {
        const shift = {
          q: target0.q - (sinkCoord.q + rot0.q),
          r: target0.r - (sinkCoord.r + rot0.r),
        };
        const sk = hexKey(shift);
        if (!seenShifts.has(sk)) {
          seenShifts.add(sk);
          candidateShifts.push(shift);
        }
      }
    } else {
      candidateShifts.push({ q: 0, r: 0 });
    }

    for (const shift of candidateShifts) {
      // Map each pattern node index to a matching token on the drawn sink footprint
      const matchedTokens: Token[] = [];
      let coordsOk = true;
      for (const node of pattern.nodes) {
        const rotOffset = rotateAroundPivot(node.offset, { q: 0, r: 0 }, rot);
        const expectedCoord = {
          q: sinkCoord.q + rotOffset.q + shift.q,
          r: sinkCoord.r + rotOffset.r + shift.r,
        };
        if (!footprintSet.has(hexKey(expectedCoord))) {
          coordsOk = false;
          break;
        }
        const tok = tokens.find((t) => hexEqual(t.coord, expectedCoord));
        if (!tok) {
          coordsOk = false;
          break;
        }
        matchedTokens.push(tok);
      }
      if (!coordsOk) continue;

      // Verify all required edges exist between mapped tokens
      let edgesOk = true;
      for (const edge of pattern.edges) {
        const tA = matchedTokens[edge.fromIdx];
        const tB = matchedTokens[edge.toIdx];
        const k = tA.id < tB.id ? `${tA.id}|${tB.id}` : `${tB.id}|${tA.id}`;
        if (!bondSet.has(k)) {
          edgesOk = false;
          break;
        }
      }
      if (!edgesOk) continue;

      const matchedValues = matchedTokens.map((t) => t.value);

      if (pattern.mode === 'exact') {
        let valuesOk = true;
        for (let i = 0; i < pattern.nodes.length; i++) {
          const reqVal = expectedForStep ? expectedForStep[i] : pattern.nodes[i].value;
          if (reqVal !== undefined && matchedTokens[i].value !== reqVal) {
            valuesOk = false;
            break;
          }
        }
        if (!valuesOk) {
          lastMismatchReason = 'Значения чисел не совпадают с эталоном';
          continue;
        }
        return { matched: true, matchedValues };
      }

      if (pattern.mode === 'sum_shape') {
        const sum = matchedTokens.reduce((acc, t) => acc + t.value, 0);
        if (pattern.requiredSum !== undefined && sum !== pattern.requiredSum) {
          lastMismatchReason = `Сумма звеньев равна ${sum}, требуется ${pattern.requiredSum}`;
          continue;
        }
        if (expectedForStep) {
          if (pattern.rotationInvariant) {
            const sortedGot = [...matchedValues].sort((a, b) => a - b);
            const sortedExp = [...expectedForStep].sort((a, b) => a - b);
            if (!sortedGot.every((v, idx) => v === sortedExp[idx])) {
              lastMismatchReason = `Состав чисел не совпадает с эталоном: получено [${matchedValues.join(', ')}], ожидается [${expectedForStep.join(', ')}]`;
              continue;
            }
          } else if (!matchedValues.every((v, idx) => v === expectedForStep[idx])) {
            lastMismatchReason = 'Значения чисел не совпадают с эталоном';
            continue;
          }
        }
        return { matched: true, matchedValues };
      }

      if (pattern.mode === 'beam_balance') {
        if (matchedTokens.length === 3) {
          // Identify hub node (degree 2 in pattern.edges) or default to middle index 1
          const deg = [0, 0, 0];
          for (const e of pattern.edges) {
            deg[e.fromIdx] = (deg[e.fromIdx] ?? 0) + 1;
            deg[e.toIdx] = (deg[e.toIdx] ?? 0) + 1;
          }
          const hubIdx = deg.indexOf(2) !== -1 ? deg.indexOf(2) : 1;
          const armIndices = [0, 1, 2].filter((idx) => idx !== hubIdx);
          const leftVal = matchedTokens[armIndices[0]].value;
          const rightVal = matchedTokens[armIndices[1]].value;
          const midVal = matchedTokens[hubIdx].value;
          if (leftVal !== rightVal) {
            lastMismatchReason = `Крылья не равны (${leftVal} ≠ ${rightVal})`;
            continue;
          }
          if (midVal !== leftVal + rightVal) {
            lastMismatchReason = `Центр равен ${midVal}, ожидается сумма крыльев (${leftVal} + ${rightVal} = ${leftVal + rightVal})`;
            continue;
          }
          if (expectedForStep && !matchedValues.every((v, idx) => v === expectedForStep[idx])) {
            lastMismatchReason = 'Значения чисел не совпадают с эталоном';
            continue;
          }
          return { matched: true, matchedValues };
        }
        lastMismatchReason = 'Для балки равновесия требуется 3 звена';
        continue;
      }

      if (pattern.mode === 'growth_ladder') {
        const step = pattern.ladderStep;
        if (step) {
          let ladderOk = true;
          for (let i = 0; i < matchedTokens.length - 1; i++) {
            const cur = matchedTokens[i].value;
            const nxt = matchedTokens[i + 1].value;
            const expectedNext = step.op === 'add' ? cur + step.value : cur * step.value;
            if (nxt !== expectedNext) {
              lastMismatchReason = `Шаг роста нарушен: после ${cur} ожидается ${expectedNext}, получено ${nxt}`;
              ladderOk = false;
              break;
            }
          }
          if (!ladderOk) continue;
        }
        if (expectedForStep && !matchedValues.every((v, idx) => v === expectedForStep[idx])) {
          lastMismatchReason = 'Значения чисел не совпадают с эталоном';
          continue;
        }
        return { matched: true, matchedValues };
      }
    }
  }

  return { matched: false, reason: lastMismatchReason ?? 'Форма полимера не соответствует приёмнику' };
}

/**
 * Advances the simulation by exactly 1 deterministic tick across 5 strict phases:
 * 1. Snapshot & Timer/Flash Decay
 * 2. Intent Collection (Movement & Rotation from all machines symmetrically)
 * 3. Conflict Check (Thrust conflict, OOB, Solid housing, Edge swap, Target overlap)
 * 4. Simultaneous Apply (Moves, Rotations, Spawners, Arithmetic, Welds, Laser cuts)
 * 5. Delivery & Victory Check
 */
