import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeObjectTree } from './disposeObjectTree';

test('disposing a scene tree releases owned resources and retains shared geometry and texture', () => {
  const ownedGeometry = new THREE.BoxGeometry();
  const sharedGeometry = new THREE.BoxGeometry();
  sharedGeometry.userData.isShared = true;
  const sharedTexture = new THREE.Texture();
  sharedTexture.userData.isShared = true;
  const material = new THREE.MeshBasicMaterial({ map: sharedTexture });
  let ownedDisposed = 0, sharedDisposed = 0, textureDisposed = 0, materialDisposed = 0;
  ownedGeometry.addEventListener('dispose', () => { ownedDisposed++; });
  sharedGeometry.addEventListener('dispose', () => { sharedDisposed++; });
  sharedTexture.addEventListener('dispose', () => { textureDisposed++; });
  material.addEventListener('dispose', () => { materialDisposed++; });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(ownedGeometry, material));
  root.add(new THREE.Mesh(sharedGeometry, new THREE.MeshBasicMaterial()));
  disposeObjectTree(root);
  assert.equal(ownedDisposed, 1);
  assert.equal(materialDisposed, 1);
  assert.equal(sharedDisposed, 0);
  assert.equal(textureDisposed, 0);
});
