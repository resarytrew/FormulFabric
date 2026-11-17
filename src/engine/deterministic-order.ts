/**
 * Канонический порядок обхода состояния мира (PR #4B).
 *
 * Симуляция хранит механизмы и сферы в `Map`, и порядок итерации такого `Map`
 * — это порядок вставки, а не игровое правило. Всё, что видно снаружи
 * (идентификаторы новых сфер, вспышки механизмов, `moveSource`, `pushChainIndex`,
 * тексты диагностики и порядок игровых событий), обязано зависеть только от
 * физического состояния мира, а не от того, в каком порядке записи попали в `Map`.
 *
 * Поэтому все фазы такта, у которых есть наблюдаемый побочный эффект, обходят
 * коллекции через функции из этого модуля:
 *
 *  - координаты: сначала меньший `q`, затем меньший `r`;
 *  - механизмы: координата, затем `id` (координата механизма уникальна, `id` —
 *    страховка на случай повреждённых данных);
 *  - сферы: `spawnOrder` (старшая сфера раньше), затем координата, затем `id`.
 *
 * Модуль зависит только от типов, поэтому его можно использовать в любой фазе
 * такта без риска циклических импортов.
 */
import type { AxialCoord, MachineInstance, SimulationWorld, Token } from './types';

/** Канонический порядок координат: меньший `q`, при равенстве — меньший `r`. */
export function compareCoords(a: AxialCoord, b: AxialCoord): number {
  if (a.q !== b.q) return a.q - b.q;
  if (a.r !== b.r) return a.r - b.r;
  return 0;
}

const MISSING_SPAWN_ORDER = Number.MAX_SAFE_INTEGER;

function spawnOrderOf(token: Token): number {
  const order = token.spawnOrder;
  return typeof order === 'number' && Number.isFinite(order) ? order : MISSING_SPAWN_ORDER;
}

/** Канонический порядок сфер: `spawnOrder`, затем текущая координата, затем `id`. */
export function compareTokenOrder(a: Token, b: Token): number {
  const bySpawnOrder = spawnOrderOf(a) - spawnOrderOf(b);
  if (bySpawnOrder !== 0) return bySpawnOrder;
  const byCoord = compareCoords(a.coord, b.coord);
  if (byCoord !== 0) return byCoord;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Порядок сфер по их происхождению: `spawnOrder`, затем координата на начало
 * такта (`prevCoord` — откуда сфера пришла), затем `id`.
 *
 * Используется там, где несколько сфер стоят на одном гексе (одновременный
 * вход в сумматор/весы): текущая координата у них одинакова, поэтому решение
 * должно опираться на происхождение сферы.
 */
export function compareTokenOrigin(a: Token, b: Token): number {
  const bySpawnOrder = spawnOrderOf(a) - spawnOrderOf(b);
  if (bySpawnOrder !== 0) return bySpawnOrder;
  const byOrigin = compareCoords(a.prevCoord ?? a.coord, b.prevCoord ?? b.coord);
  if (byOrigin !== 0) return byOrigin;
  const byCoord = compareCoords(a.coord, b.coord);
  if (byCoord !== 0) return byCoord;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Канонический порядок механизмов: координата, затем `id`. */
export function compareMachines(a: MachineInstance, b: MachineInstance): number {
  const byCoord = compareCoords(a.coord, b.coord);
  if (byCoord !== 0) return byCoord;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Снимок сфер мира в каноническом порядке. */
export function sortedTokens(world: SimulationWorld): Token[] {
  return [...world.tokens.values()].sort(compareTokenOrder);
}

/** Снимок сфер мира в порядке происхождения (см. `compareTokenOrigin`). */
export function sortedTokensByOrigin(world: SimulationWorld): Token[] {
  return [...world.tokens.values()].sort(compareTokenOrigin);
}

/** Снимок механизмов мира в каноническом порядке. */
export function sortedMachines(world: SimulationWorld): MachineInstance[] {
  return [...world.machines.values()].sort(compareMachines);
}
