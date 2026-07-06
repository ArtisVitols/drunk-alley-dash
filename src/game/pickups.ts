import * as THREE from 'three';
import type { BottleKind } from '../net/network';
import { glowTexture } from './fx';

const BOTTLE_SPECS: Record<BottleKind, { color: number; height: number; radius: number }> = {
  beer: { color: 0xa05a1c, height: 0.48, radius: 0.16 },
  wine: { color: 0x2e6b34, height: 0.66, radius: 0.15 },
  vodka: { color: 0xdfe6f0, height: 0.58, radius: 0.13 },
};

export const BOTTLE_GLOW: Record<BottleKind, number> = {
  beer: 0xffa04a,
  wine: 0x4ade6a,
  vodka: 0xbfd4ff,
};

export function createBottleMesh(kind: BottleKind): THREE.Group {
  const spec = BOTTLE_SPECS[kind];
  const group = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.2,
    metalness: 0.15,
    emissive: spec.color,
    emissiveIntensity: 0.7,
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
  // Soft halo so pickups read from across the alley (and feed the bloom)
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: BOTTLE_GLOW[kind],
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.scale.set(1.7, 1.7, 1);
  halo.position.y = 0.35;
  group.add(body, neck, cap, halo);
  return group;
}
