import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachineInstance } from '../engine/world';
import { createDecorationSynchronizer, decorationSignature } from './decorationSignature';

test('decoration rebuilds on geometry inputs but not runtime machine state', () => {
  const machine = createMachineInstance('m1', 'adder', { q: 0, r: 0 }, false, { dir: 0 });
  const machines = new Map([['0,0', machine]]);
  const platform = new Set(['0,0', '1,0']);
  const sync = createDecorationSynchronizer();
  let builds = 0;
  const rebuild = () => { builds++; };
  const key = () => decorationSignature(machines, platform, 'workshop');
  assert.equal(sync(key(), rebuild), true);
  machine.state.memory = 9;
  machine.state.cooldown = 2;
  machine.state.activeFlashTicks = 1;
  machine.state.isWaitingSideExit = true;
  assert.equal(sync(key(), rebuild), false);
  assert.equal(builds, 1);
  machine.config.dir = 1;
  assert.equal(sync(key(), rebuild), true);
  platform.add('2,0');
  assert.equal(sync(key(), rebuild), true);
  assert.equal(sync(decorationSignature(machines, platform, 'other'), rebuild), true);
  machines.set('1,0', createMachineInstance('m2', 'conveyor', { q: 1, r: 0 }, false, { dir: 0 }));
  assert.equal(sync(decorationSignature(machines, platform, 'other'), rebuild), true);
  assert.equal(builds, 5);
});

test('failed decoration rebuild is retried', () => {
  const sync = createDecorationSynchronizer();
  assert.throws(() => sync('layout', () => { throw new Error('failed'); }));
  assert.equal(sync('layout', () => {}), true);
});
