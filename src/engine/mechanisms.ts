import { activateSpawners } from './spawning';
import { getConnectedComponents, type ConnectedComponent } from './components';
import { pushEvent, triggerError } from './events';
import { hexDistance, hexEqual, hexKey, hexNeighbor, oppositeDir, rotateAroundPivot, rotateDir } from './hex-math';
import { SOLID_MACHINE_TYPES } from './world';
import { evaluateFilterRule, isInRange, getExactDiv2, getExactSqrt, euclideanDivMod } from './operations';
import type { AxialCoord, ConsumedTokenKind, HexDir, HexKey, MachineInstance, MachineType, SimulationWorld, Token } from './types';

function addBondCanonical(world: SimulationWorld, idA: string, idB: string): boolean {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const exists = world.bonds.some((e) => e.a === a && e.b === b);
  if (exists) return false;
  world.bonds.push({ a, b });
  return true;
}

export function processMechanisms(world: SimulationWorld, movedTokenIds: Set<string>, recordConsumed: (token: Token, kind: ConsumedTokenKind) => void): boolean | null {
  if (!activateSpawners(world, movedTokenIds)) return null;

  // Track visited hexes for Area optimization metric
  for (const t of world.tokens.values()) {
    world.visitedHexes.add(hexKey(t.coord));
  }

  // Helper to classify side-port availability: free vs temporary token occupation vs permanent obstacle
  const getSidePortAvailability = (
    altCoord: AxialCoord,
  ): 'free' | 'occupied_token' | 'blocked_static' => {
    const aKey = hexKey(altCoord);
    if (!world.platformHexes.has(aKey)) return 'blocked_static';
    if (SOLID_MACHINE_TYPES.has(world.machines.get(aKey)?.type ?? 'conveyor')) {
      return 'blocked_static';
    }
    if (Array.from(world.tokens.values()).some((t) => hexEqual(t.coord, altCoord))) {
      return 'occupied_token';
    }
    return 'free';
  };

  let machineActionOccurredThisTick = movedTokenIds.size > 0;

  // Process Duplicators (dup: keeps original to exit along dir, spawns copy onto altDir or pauses if altDir busy)
  for (const tok of Array.from(world.tokens.values())) {
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine || machine.type !== 'dup') continue;
    if (!movedTokenIds.has(tok.id) && tok.waitingSidePort !== machine.id) continue;
    const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
    if (isBonded) {
      triggerError(
        world,
        'Дубликатор копирует только отдельные несвязанные числа',
        [machine.coord],
        'error',
      );
      return null;
    }
    const copyCoord = hexNeighbor(
      machine.coord,
      machine.config.altDir ?? rotateDir(machine.config.dir, 1),
    );
    const portState = getSidePortAvailability(copyCoord);
    if (portState === 'blocked_static') {
      triggerError(
        world,
        'Нет свободного гекса для вывода копии дубликатора',
        [machine.coord, copyCoord],
        'blocked',
      );
      return null;
    }
    if (portState === 'occupied_token') {
      tok.waitingSidePort = machine.id;
      machine.state.isWaitingSideExit = true;
      machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
      if (machine.state.waitTicks === 1) {
        pushEvent(world, {
          type: 'blocked',
          coord: machine.coord,
          relatedCoords: [copyCoord],
          message: 'Боковой выход дубликатора = занят — ожидание очереди',
          severity: 'warning',
          badge: '⏳',
        });
      }
      continue;
    }
    tok.waitingSidePort = undefined;
    machine.state.isWaitingSideExit = false;
    machine.state.waitTicks = 0;
    const copyTok: Token = {
      id: `t_${world.nextTokenId++}`,
      value: tok.value,
      prevValue: tok.value,
      coord: { ...copyCoord },
      prevCoord: { ...machine.coord },
      moveSource: 'split',
      spawnOrder: tok.spawnOrder,
    };
    world.tokens.set(copyTok.id, copyTok);
    movedTokenIds.add(copyTok.id);
    machineActionOccurredThisTick = true;
    world.visitedHexes.add(hexKey(copyCoord));
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;
    pushEvent(world, {
      type: 'transform',
      coord: machine.coord,
      message: `Дубликатор =: копия числа ${tok.value}`,
      severity: 'info',
      badge: '=',
    });
  }

  // Process Adder & Scales (2-input consumption & memory)
  for (const machine of world.machines.values()) {
    if (machine.type !== 'adder' && machine.type !== 'scales') continue;
    const tokensHere = Array.from(world.tokens.values()).filter((t) =>
      hexEqual(t.coord, machine.coord),
    );
    if (tokensHere.length === 0) continue;

    if (tokensHere.length > 2 || (tokensHere.length >= 2 && machine.state.memory !== null)) {
      triggerError(
        world,
        `${machine.type === 'adder' ? 'Сумматор Σ' : 'Весы ⚖'} переполнены одновременными входами при занятой памяти`,
        [machine.coord],
        'collision',
      );
      return null;
    }

    if (machine.type === 'adder') {
      // Simultaneous 2-token arrival
      if (tokensHere.length === 2) {
        const [t1, t2] = tokensHere;
        const sum = t1.value + t2.value;
        if (!isInRange(sum, world.minValue, world.maxValue)) {
          triggerError(
            world,
            `Переполнение сумматора: ${t1.value} + ${t2.value} = ${sum} вне [${world.minValue}, ${world.maxValue}]`,
            [machine.coord],
            'error',
          );
          return null;
        }
        recordConsumed(t2, 'merge');
        world.tokens.delete(t2.id);
        t1.value = sum;
        t1.producedByAdderAtTick = world.tick;
        machine.state.memory = null;
        machineActionOccurredThisTick = true;
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'transform',
          coord: machine.coord,
          message: `Сумматор Σ: ${t1.value - t2.value} + ${t2.value} = ${sum}`,
          severity: 'success',
          badge: `Σ=${sum}`,
        });
        continue;
      }

      const tok = tokensHere[0];
      // Never re-absorb a token produced on this exact tick!
      if (tok.producedByAdderAtTick === world.tick) {
        continue;
      }
      // Only newly arrived tokens interact with adder
      if (!movedTokenIds.has(tok.id)) {
        continue;
      }

      // Adder rejects bonded polymers
      const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
      if (isBonded) {
        triggerError(
          world,
          'Сумматор принимает только отдельные несвязанные числа',
          [machine.coord],
          'error',
        );
        return null;
      }

      if (machine.state.memory === null) {
        machine.state.memory = tok.value;
        recordConsumed(tok, 'store');
        world.tokens.delete(tok.id);
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'store',
          coord: machine.coord,
          message: `Сумматор Σ сохранил первое слагаемое: ${tok.value}`,
          severity: 'info',
          badge: `Σ(${tok.value})`,
        });
      } else {
        const first = machine.state.memory;
        const second = tok.value;
        const sum = first + second;
        if (!isInRange(sum, world.minValue, world.maxValue)) {
          triggerError(
            world,
            `Переполнение сумматора: ${first} + ${second} = ${sum} вне [${world.minValue}, ${world.maxValue}]`,
            [machine.coord],
            'error',
          );
          return null;
        }
        machine.state.memory = null;
        tok.value = sum;
        tok.producedByAdderAtTick = world.tick;
        machineActionOccurredThisTick = true;
        machine.state.activeFlashTicks = 1;
        machine.state.lastActionTick = world.tick;
        pushEvent(world, {
          type: 'transform',
          coord: machine.coord,
          message: `Сумматор Σ: ${first} + ${second} = ${sum}`,
          severity: 'success',
          badge: `Σ=${sum}`,
        });
      }
      continue;
    }

    // Scales (Весы-сортировщик ⚖): larger exits dir, smaller spawns onto altDir (or pauses if altDir busy)
    const emitSortedScales = (a: number, b: number, keepTok: Token, removeTok?: Token) => {
      if (a === b) {
        triggerError(
          world,
          `Весы в равновесии (${a} = ${b}): равные числа нельзя отсортировать на большее и меньшее`,
          [machine.coord],
          'error',
        );
        return false;
      }
      const altCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(altCoord);
      if (portState === 'blocked_static') {
        triggerError(
          world,
          'Нет свободного гекса для вывода меньшего числа с весов',
          [machine.coord, altCoord],
          'blocked',
        );
        return false;
      }
      if (portState === 'occupied_token') {
        // Hold first value in memory and pause second token on scales until altDir clears
        if (removeTok) {
          machine.state.memory = removeTok.value;
          recordConsumed(removeTok, 'store');
          world.tokens.delete(removeTok.id);
        } else {
          machine.state.memory = a;
        }
        keepTok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [altCoord],
            message: 'Боковой выход весов ⚖ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        return true;
      }
      const big = Math.max(a, b);
      const small = Math.min(a, b);
      if (removeTok) {
        recordConsumed(removeTok, 'merge');
        world.tokens.delete(removeTok.id);
      }
      machine.state.memory = null;
      keepTok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      keepTok.value = big;
      keepTok.producedByAdderAtTick = world.tick;
      const smallTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: small,
        prevValue: small,
        coord: { ...altCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: keepTok.spawnOrder,
      };
      world.tokens.set(smallTok.id, smallTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(altCoord));
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `Весы ⚖: ${big} > ${small}`,
        severity: 'success',
        badge: `${big}|${small}`,
      });
      return true;
    };

    if (tokensHere.length === 2) {
      const [t1, t2] = tokensHere;
      if (!emitSortedScales(t1.value, t2.value, t1, t2)) return null;
      continue;
    }

    const tok = tokensHere[0];
    if (tok.producedByAdderAtTick === world.tick) continue;
    if (!movedTokenIds.has(tok.id) && tok.waitingSidePort !== machine.id) continue;

    const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
    if (isBonded) {
      triggerError(
        world,
        'Весы-сортировщик принимают только отдельные несвязанные числа',
        [machine.coord],
        'error',
      );
      return null;
    }

    if (machine.state.memory === null) {
      machine.state.memory = tok.value;
      recordConsumed(tok, 'store');
      world.tokens.delete(tok.id);
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'store',
        coord: machine.coord,
        message: `Весы ⚖ взвесили первое число: ${tok.value}`,
        severity: 'info',
        badge: `⚖(${tok.value})`,
      });
    } else {
      if (!emitSortedScales(machine.state.memory, tok.value, tok)) return null;
    }
  }

  // Process Unary Math Pads & side-port arithmetic on newly arrived or waiting tokens
  for (const tok of Array.from(world.tokens.values())) {
    const machine = world.machines.get(hexKey(tok.coord));
    if (!machine) continue;
    const isWaitingHere = tok.waitingSidePort === machine.id;
    if (!movedTokenIds.has(tok.id) && !isWaitingHere) continue;

    if (machine.type === 'add1') {
      const next = tok.value + 1;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return null;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `+1: ${prev} → ${next}`, severity: 'info', badge: '+1' });
    } else if (machine.type === 'sub1') {
      const next = tok.value - 1;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return null;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `-1: ${prev} → ${next}`, severity: 'info', badge: '−1' });
    } else if (machine.type === 'mul2') {
      const next = tok.value * 2;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Переполнение ×2: ${next} вне [${world.minValue}, ${world.maxValue}]`, [tok.coord], 'error');
        return null;
      }
      const prev = tok.value;
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `×2: ${prev} → ${next}`, severity: 'info', badge: '×2' });
    } else if (machine.type === 'div2') {
      const res = getExactDiv2(tok.value);
      if (!res.ok) {
        triggerError(world, res.reason, [tok.coord], 'error');
        return null;
      }
      const prev = tok.value;
      tok.value = res.result;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `÷2: ${prev} → ${res.result}`, severity: 'info', badge: '÷2' });
    } else if (machine.type === 'sqrt') {
      const res = getExactSqrt(tok.value);
      if (!res.ok) {
        triggerError(world, res.reason, [tok.coord], 'error');
        return null;
      }
      const prev = tok.value;
      tok.value = res.result;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `√x: √${prev} → ${res.result}`, severity: 'info', badge: `√=${res.result}` });
    } else if (machine.type === 'neg') {
      const prev = tok.value;
      const next = prev === 0 ? 0 : -prev;
      if (!isInRange(next, world.minValue, world.maxValue)) {
        triggerError(world, `Выход за диапазон [${world.minValue}, ${world.maxValue}]: ${next}`, [tok.coord], 'error');
        return null;
      }
      tok.value = next;
      machineActionOccurredThisTick = true;
      machine.state.activeFlashTicks = 1;
      pushEvent(world, { type: 'transform', coord: tok.coord, message: `−x: ${prev} → ${next}`, severity: 'info', badge: '−x' });
    } else if (machine.type === 'divmod') {
      const b = machine.config.divisor ?? 2;
      const { q, r } = euclideanDivMod(tok.value, b);
      const remCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(remCoord);
      if (portState === 'blocked_static') {
        triggerError(world, 'Нет места для вывода остатка от деления', [machine.coord, remCoord], 'blocked');
        return null;
      }
      if (portState === 'occupied_token') {
        tok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [remCoord],
            message: 'Боковой выход делителя ÷ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        continue;
      }
      const prev = tok.value;
      tok.value = q;
      tok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      const remTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: r,
        prevValue: r,
        coord: { ...remCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: tok.spawnOrder,
      };
      world.tokens.set(remTok.id, remTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(remCoord));
      machine.state.activeFlashTicks = 1;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `${prev} = ${b}·${q} + ${r}`,
        severity: 'info',
        badge: `${q} | ${r}`,
      });
    } else if (machine.type === 'halver') {
      const isBonded = world.bonds.some((b) => b.a === tok.id || b.b === tok.id);
      if (isBonded) {
        triggerError(
          world,
          'Раскольник ½ делит только отдельные несвязанные числа',
          [machine.coord],
          'error',
        );
        return null;
      }
      const divRes = getExactDiv2(tok.value);
      if (!divRes.ok) {
        triggerError(
          world,
          `Число ${tok.value} нечётное — раскольник ½ не может разделить его поровну`,
          [machine.coord],
          'error',
        );
        return null;
      }
      const altCoord = hexNeighbor(
        machine.coord,
        machine.config.altDir ?? rotateDir(machine.config.dir, 1),
      );
      const portState = getSidePortAvailability(altCoord);
      if (portState === 'blocked_static') {
        triggerError(
          world,
          'Нет свободного гекса для второй половины раскольника ½',
          [machine.coord, altCoord],
          'blocked',
        );
        return null;
      }
      if (portState === 'occupied_token') {
        tok.waitingSidePort = machine.id;
        machine.state.isWaitingSideExit = true;
        machine.state.waitTicks = (machine.state.waitTicks ?? 0) + 1;
        if (machine.state.waitTicks === 1) {
          pushEvent(world, {
            type: 'blocked',
            coord: machine.coord,
            relatedCoords: [altCoord],
            message: 'Боковой выход раскольника ½ занят — ожидание очереди',
            severity: 'warning',
            badge: '⏳',
          });
        }
        continue;
      }
      const prev = tok.value;
      const half = divRes.result;
      tok.value = half;
      tok.waitingSidePort = undefined;
      machine.state.isWaitingSideExit = false;
      machine.state.waitTicks = 0;
      const splitTok: Token = {
        id: `t_${world.nextTokenId++}`,
        value: half,
        prevValue: half,
        coord: { ...altCoord },
        prevCoord: { ...machine.coord },
        moveSource: 'split',
        spawnOrder: tok.spawnOrder,
      };
      world.tokens.set(splitTok.id, splitTok);
      machineActionOccurredThisTick = true;
      world.visitedHexes.add(hexKey(altCoord));
      machine.state.activeFlashTicks = 1;
      machine.state.lastActionTick = world.tick;
      pushEvent(world, {
        type: 'transform',
        coord: machine.coord,
        message: `Раскольник ½: ${prev} = ${half} + ${half}`,
        severity: 'success',
        badge: `${half} + ${half}`,
      });
    }
  }

  // Process Welders & Steam Lasers
  const updatedHexMap = new Map<HexKey, Token>();
  for (const t of world.tokens.values()) {
    updatedHexMap.set(hexKey(t.coord), t);
  }

  for (const machine of world.machines.values()) {
    if (machine.type === 'welder') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB && hexDistance(tA.coord, tB.coord) === 1) {
        if (addBondCanonical(world, tA.id, tB.id)) {
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'weld',
            coord: machine.coord,
            message: `Сварка: [${tA.value} ━━ ${tB.value}]`,
            severity: 'success',
            relatedCoords: [machine.coord, neighbor],
            badge: 'СВАРКА',
          });
        }
      }
    } else if (machine.type === 'laser') {
      const tA = updatedHexMap.get(hexKey(machine.coord));
      const neighbor = hexNeighbor(machine.coord, machine.config.dir);
      const tB = updatedHexMap.get(hexKey(neighbor));
      if (tA && tB) {
        const [a, b] = tA.id < tB.id ? [tA.id, tB.id] : [tB.id, tA.id];
        const idx = world.bonds.findIndex((e) => e.a === a && e.b === b);
        if (idx !== -1) {
          world.bonds.splice(idx, 1);
          machineActionOccurredThisTick = true;
          machine.state.activeFlashTicks = 1;
          pushEvent(world, {
            type: 'cut',
            coord: machine.coord,
            message: `Лазер разрезал связь [${tA.value} -/- ${tB.value}]`,
            severity: 'info',
            relatedCoords: [machine.coord, neighbor],
            badge: 'РАЗРЕЗ',
          });
        }
      }
    }
  }

  // Process Destroyers (recycles any token or bonded polymer touching the shredder hex)
  const postMoveComponents = getConnectedComponents(world);
  const compByTokenAfterMove = new Map<string, ConnectedComponent>();
  for (const c of postMoveComponents) {
    for (const id of c.tokenIds) compByTokenAfterMove.set(id, c);
  }
  const destroyedCompIds = new Set<string>();
  for (const machine of world.machines.values()) {
    if (machine.type !== 'destroyer') continue;
    const victim = Array.from(world.tokens.values()).find((t) => hexEqual(t.coord, machine.coord));
    if (!victim) continue;
    const comp = compByTokenAfterMove.get(victim.id);
    if (!comp || destroyedCompIds.has(comp.id)) continue;
    destroyedCompIds.add(comp.id);
    const compSet = new Set(comp.tokenIds);
    const vals = comp.tokenIds.map((id) => world.tokens.get(id)?.value ?? 0);
    for (const id of comp.tokenIds) {
      const deadTok = world.tokens.get(id);
      if (deadTok) recordConsumed(deadTok, 'destroy');
      world.tokens.delete(id);
    }
    for (const b of world.bonds) {
      if (compSet.has(b.a) || compSet.has(b.b)) {
        world.consumedBonds!.push({ ...b });
      }
    }
    world.bonds = world.bonds.filter((b) => !compSet.has(b.a) && !compSet.has(b.b));
    machineActionOccurredThisTick = true;
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;
    pushEvent(world, {
      type: 'destroy',
      coord: machine.coord,
      message: `Утилизатор × переработал: [${vals.join(' ━━ ')}]`,
      severity: 'warning',
      badge: '×',
    });
  }

  // Guard against cutting/spawning leaving an unsupported token over a narrow fissure
  if (world.narrowGapHexes.size > 0) {
    const gapComponents = getConnectedComponents(world);
    for (const comp of gapComponents) {
      const compToks = comp.tokenIds.map((id) => world.tokens.get(id)!);
      const overGap = compToks.filter((t) => world.narrowGapHexes.has(hexKey(t.coord)));
      if (overGap.length === 0) continue;
      const hasSolidAnchor =
        compToks.length >= 2 &&
        compToks.some((t) => {
          const k = hexKey(t.coord);
          return world.platformHexes.has(k) && !world.narrowGapHexes.has(k);
        });
      if (!hasSolidAnchor) {
        world.fallingTokens = overGap.map((t) => ({
          value: t.value,
          fromCoord: { ...t.prevCoord },
          toCoord: { ...t.coord },
        }));
        triggerError(
          world,
          'Сфера провалилась в узкий разлом: после разреза или спавна не осталось опоры на твёрдой плитке',
          overGap.map((t) => t.coord),
          'collision',
        );
        return null;
      }
    }
  }

  return machineActionOccurredThisTick;
}
