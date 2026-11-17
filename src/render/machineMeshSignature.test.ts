import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachineInstance } from '../engine/world';
import { machineMeshSignature } from './machineMeshSignature';

test('mesh signatures isolate unrelated edits and reflect conveyor neighbours and theme', () => {
  const belt = createMachineInstance('belt', 'conveyor', { q: 0, r: 0 }, false, { dir: 0 });
  const distant = createMachineInstance('distant', 'add1', { q: 3, r: 0 }, false, { dir: 0 });
  const machines = new Map([['0,0', belt], ['3,0', distant]]);
  const original = machineMeshSignature(belt, machines, 'workshop');
  distant.config.dir = 1;
  assert.equal(machineMeshSignature(belt, machines, 'workshop'), original);
  const feeder = createMachineInstance('feeder', 'spawner', { q: -1, r: 0 }, true, { dir: 0 });
  machines.set('-1,0', feeder);
  assert.notEqual(machineMeshSignature(belt, machines, 'workshop'), original);
  assert.notEqual(machineMeshSignature(belt, machines, 'night'), machineMeshSignature(belt, machines, 'workshop'));
});
