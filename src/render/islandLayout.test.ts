import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldFromLevel } from '../engine/hex-engine';
import { hexKey, hexToWorld } from '../engine/hex-math';
import { ALL_PUZZLE_LEVELS, SANDBOX_LEVEL } from '../engine/levels';
import { computeIslandTerrainLayout } from './islandLayout';

test('islandLayout never overlaps playable platformHexes across all levels', () => {
  for (const level of [...ALL_PUZZLE_LEVELS, SANDBOX_LEVEL]) {
    const world = createWorldFromLevel(level);
    const layout = computeIslandTerrainLayout(world.platformHexes, world.narrowGapHexes);

    assert.ok(layout.terraces.length >= 24, `${level.id} should have rich terraced perimeter`);

    const terraceKeys = new Set<string>();
    for (const t of layout.terraces) {
      const k = hexKey(t.coord);
      assert.equal(
        world.platformHexes.has(k),
        false,
        `${level.id}: terrace ${k} overlapped playable hex`,
      );
      assert.equal(terraceKeys.has(k), false, `${level.id}: duplicate terrace ${k}`);
      terraceKeys.add(k);
    }

    // Verify vertical multi-level spread (both elevated & lower terraces)
    const minY = Math.min(...layout.terraces.map((t) => t.y));
    const maxY = Math.max(...layout.terraces.map((t) => t.y));
    assert.ok(maxY >= 0.3, `${level.id}: expected elevated rear terrace >= 0.3, got ${maxY}`);
    assert.ok(minY <= -0.35, `${level.id}: expected stepped lower terrace <= -0.35, got ${minY}`);
  }
});

test('islandLayout keeps internal chasms open and front camera corridor unobstructed', () => {
  const imp3 = ALL_PUZZLE_LEVELS.find((l) => l.id === 'imp-03')!;
  const w3 = createWorldFromLevel(imp3);
  const l3 = computeIslandTerrainLayout(w3.platformHexes, w3.narrowGapHexes);
  const tKeys3 = new Set(l3.terraces.map((t) => hexKey(t.coord)));
  // Central chasm r=0 between top (r=-1) and bottom (r=1) banks must remain open
  for (const q of [-2, -1, 0, 1, 2]) {
    assert.equal(tKeys3.has(hexKey({ q, r: 0 })), false, `imp-03 chasm (${q},0) must stay open`);
  }

  const g55 = ALL_PUZZLE_LEVELS.find((l) => l.id === 'g5-05')!;
  const w55 = createWorldFromLevel(g55);
  const l55 = computeIslandTerrainLayout(w55.platformHexes, w55.narrowGapHexes);
  const tKeys55 = new Set(l55.terraces.map((t) => hexKey(t.coord)));
  for (const r of [-2, -1, 1, 2]) {
    assert.equal(tKeys55.has(hexKey({ q: 0, r })), false, `g5-05 chasm (0,${r}) must stay open`);
  }

  // Tall props & trees stay clear of front-south sightline and playable hexes
  for (const level of [...ALL_PUZZLE_LEVELS, SANDBOX_LEVEL]) {
    const world = createWorldFromLevel(level);
    const layout = computeIslandTerrainLayout(world.platformHexes, world.narrowGapHexes);
    const tallKinds = new Set(['observatory', 'waterfall', 'pergola', 'windvane', 'bonsai', 'blossom']);
    for (const lm of layout.landmarks) {
      if (tallKinds.has(lm.kind)) {
        const ang = Math.atan2(lm.z - layout.centerZ, lm.x - layout.centerX);
        assert.ok(
          Math.sin(ang) < 0.42,
          `${level.id}: tall landmark ${lm.kind} placed too far south (sin=${Math.sin(ang).toFixed(2)})`,
        );
      }
      for (const pk of world.platformHexes) {
        const [q, r] = pk.split(',').map(Number);
        const pw = hexToWorld({ q, r });
        assert.ok(
          Math.hypot(pw.x - lm.x, pw.z - lm.z) >= 1.0,
          `${level.id}: landmark ${lm.kind} too close to playable hex ${pk}`,
        );
      }
    }
    assert.ok(
      layout.landmarks.some((l) => l.kind === 'observatory'),
      `${level.id}: expected observatory landmark`,
    );
    assert.ok(
      layout.landmarks.some((l) => l.kind === 'waterfall'),
      `${level.id}: expected waterfall landmark`,
    );
  }
});
