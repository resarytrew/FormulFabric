import { sortedMachines } from './deterministic-order';
import { pushEvent, triggerError } from './events';
import { hexKey, hexNeighbor } from './hex-math';
import { isInRange } from './operations';
import { SOLID_MACHINE_TYPES } from './world';
import type { HexKey, SimulationWorld, Token } from './types';

export function activateSpawners(world: SimulationWorld, movedTokenIds: Set<string>): boolean {
  // Activate Spawners (spawn onto neighbor hex if empty).
  //
  // Источники обрабатываются в каноническом порядке координат, а не в порядке
  // хранения в `Map`. Это и есть правило общего выхода: если два источника
  // направлены на один гекс, первым считается источник с меньшей координатой
  // `q` (при равенстве — с меньшей `r`); он и выпускает сферу. Второй источник
  // видит гекс занятым и ждёт: `spawnIndex`, значение из последовательности и
  // `cooldown`, накопленный до выпуска, не теряются — выпуск произойдёт в том
  // такте, когда гекс освободится.
  //
  // PR #4C: занятость выходов проверяется по локальному индексу `Set<HexKey>`,
  // построенному за один проход по сферам, вместо перебора всех сфер на каждый
  // источник (было O(S·T), стало O(T + S)). Индекс создаётся по координатам
  // ПОСЛЕ фазы движения — `activateSpawners` вызывается из `processMechanisms`
  // после `applyMovement`, поэтому гекс, освобождённый в этом такте, доступен
  // источнику сразу. После успешного выпуска координата сразу добавляется в
  // индекс: иначе два источника могли бы выпустить сферы в одну клетку.
  // Глобального индекса в `SimulationWorld` нет — он живёт только на время фазы.
  //
  // Индекс строится при первой же проверке занятости, а не в начале функции:
  // в тактах, где ни один источник не готов выпускать (перезарядка, исчерпанная
  // последовательность, отсутствие источников), построение не выполняется
  // вовсе. Это сохраняет прежнюю стоимость для уровней без источников и для
  // тактов ожидания, а результат не меняется: сферы в фазе только добавляются,
  // поэтому индекс, построенный позже, содержит надмножество координат начала
  // фазы, а все выпущенные сферы уже лежат в `world.tokens`.
  let occupiedHexes: Set<HexKey> | null = null;
  const occupancyIndex = (): Set<HexKey> => {
    if (occupiedHexes === null) {
      const index = new Set<HexKey>();
      for (const tok of world.tokens.values()) {
        index.add(hexKey(tok.coord));
      }
      occupiedHexes = index;
    }
    return occupiedHexes;
  };

  for (const machine of sortedMachines(world)) {
    if (machine.type !== 'spawner') continue;
    const seq = machine.config.sequence ?? [];
    if (seq.length === 0) continue;

    if (machine.state.cooldown > 0) {
      machine.state.cooldown -= 1;
      continue;
    }

    if (machine.state.spawnIndex >= seq.length) {
      if (machine.config.loopSequence) {
        machine.state.spawnIndex = 0;
      } else {
        continue;
      }
    }

    const spawnCoord = hexNeighbor(machine.coord, machine.config.dir);
    const spawnKey = hexKey(spawnCoord);
    if (!world.platformHexes.has(spawnKey)) {
      triggerError(
        world,
        'Источник направлен за пределы платформы',
        [machine.coord, spawnCoord],
        'error',
      );
      return false;
    }

    const spawnDestMachine = world.machines.get(spawnKey);
    if (spawnDestMachine && SOLID_MACHINE_TYPES.has(spawnDestMachine.type)) {
      triggerError(
        world,
        `Источник направлен внутрь корпуса механизма (${spawnDestMachine.type})`,
        [machine.coord, spawnCoord],
        'collision',
      );
      return false;
    }

    // Check if spawn hex currently occupied (O(1) по индексу фазы).
    if (occupancyIndex().has(spawnKey)) {
      pushEvent(world, {
        type: 'blocked',
        coord: spawnCoord,
        message: 'Выход источника занят — ожидание освобождения гекса',
        severity: 'warning',
      });
      continue;
    }

    const val = seq[machine.state.spawnIndex];
    if (!isInRange(val, world.minValue, world.maxValue)) {
      triggerError(
        world,
        `Входное значение ${val} выходит за допустимый диапазон [${world.minValue}, ${world.maxValue}]`,
        [machine.coord],
        'error',
      );
      return false;
    }

    const newTok: Token = {
      id: `t_${world.nextTokenId++}`,
      value: val,
      prevValue: val,
      coord: { ...spawnCoord },
      prevCoord: { ...machine.coord },
      moveSource: 'spawner',
      spawnOrder: world.nextSpawnOrder++,
    };
    world.tokens.set(newTok.id, newTok);
    movedTokenIds.add(newTok.id);
    // Индекс обязан оставаться актуальным внутри фазы: второй источник,
    // направленный на тот же гекс, должен увидеть его занятым (правило общего
    // выхода сохраняется).
    occupancyIndex().add(spawnKey);
    machine.state.spawnIndex += 1;
    machine.state.cooldown = Math.max(0, (machine.config.spawnInterval ?? 2) - 1);
    machine.state.activeFlashTicks = 1;
    machine.state.lastActionTick = world.tick;

    pushEvent(world, {
      type: 'spawn',
      coord: spawnCoord,
      message: `Выпущено число ${val}`,
      severity: 'info',
    });
  }

  return true;
}
