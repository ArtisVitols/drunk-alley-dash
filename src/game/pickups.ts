import * as THREE from 'three';
import type { BottleKind } from '../net/network';

const BOTTLE_SPECS: Record<BottleKind, { color: number; height: number; radius: number }> = {
  beer: { color: 0xa05a1c, height: 0.48, radius: 0.16 },
  wine: { color: 0x2e6b34, height: 0.66, radius: 0.15 },
  vodka: { color: 0xdfe6f0, height: 0.58, radius: 0.13 },
};

export function createBottleMesh(kind: BottleKind): THREE.Group {
  const spec = BOTTLE_SPECS[kind];
  const group = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.25,
    metalness: 0.1,
    emissive: spec.color,
    emissiveIntensity: 0.35,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 10),
    glassMat,
  );
  body.position.y = spec.height / 2;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.22, 10), glassMat);
  neck.position.y = spec.height + 0.1;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9c623, roughness: 0.4, metalness: 0.6 }),
  );
  cap.position.y = spec.height + 0.24;
  group.add(body, neck, cap);
  return group;
}
