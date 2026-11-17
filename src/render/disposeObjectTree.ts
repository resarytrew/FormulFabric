import * as THREE from 'three';

export function disposeObjectTree(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const anyChild = child as THREE.Mesh & THREE.LineSegments;
    if (anyChild.geometry && !anyChild.geometry.userData?.isShared) {
      anyChild.geometry.dispose();
    }
    const mat = anyChild.material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const mAny = m as THREE.MeshBasicMaterial & THREE.MeshToonMaterial;
        if (mAny.map && !mAny.map.userData?.isShared) {
          mAny.map.dispose();
        }
        m.dispose();
      }
    }
  });
}

