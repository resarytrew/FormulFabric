import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldFromLevel } from '../engine/world';
import { CAMPAIGN_LEVELS } from '../engine/levels';
import { animateMachines } from './animateMachines';
import { TOKEN_TRIGGER_ALPHA } from './tokenAnimationTimeline';

test('machine animation updates the existing mesh and returns its piston to rest', () => {
  const world = createWorldFromLevel(CAMPAIGN_LEVELS[0]);
  const [key, machine] = [...world.machines.entries()].find(([, m]) => m.type === 'spawner')!;
  const group = new THREE.Group();
  const piston = new THREE.Object3D();
  piston.userData.animType = 'spawnerPiston';
  group.add(piston);
  const meshes = new Map([[key, group]]);
  const ages = new Map<string, number>();
  machine.state.activeFlashTicks = 1;
  animateMachines(meshes, ages, world, null, TOKEN_TRIGGER_ALPHA, 1, 1, 0, 0.016);
  assert.ok(Math.abs(piston.position.y - 0.87) < 1e-9);
  animateMachines(meshes, ages, world, null, 1, 1, 1, 0.016, 0.016);
  assert.ok(Math.abs(piston.position.y - 1.05) < 1e-9);
  assert.equal(meshes.get(key), group);
  animateMachines(meshes, ages, world, machine.coord, 1, 1, 1, 0.032, 0.016);
  assert.equal(group.visible, false);
  animateMachines(meshes, ages, world, null, 1, 1, 1, 0.048, 0.016);
  assert.equal(group.visible, true);
});
