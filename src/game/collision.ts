export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** The collider shape GameApp tracks: centre-x/z, width/depth, and a vertical range. */
export interface ColliderBox {
  x: number;
  z: number;
  w: number;
  d: number;
  topY: number;
  bottomY: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export function colliderToAabb(c: ColliderBox): Aabb {
  const halfW = c.w / 2;
  const halfD = c.d / 2;
  return {
    minX: c.x - halfW,
    maxX: c.x + halfW,
    minY: c.bottomY,
    maxY: c.topY,
    minZ: c.z - halfD,
    maxZ: c.z + halfD,
  };
}

export function pointInAabb(p: Point3, box: Aabb): boolean {
  return (
    p.x >= box.minX &&
    p.x <= box.maxX &&
    p.y >= box.minY &&
    p.y <= box.maxY &&
    p.z >= box.minZ &&
    p.z <= box.maxZ
  );
}

/** Slab-based segment-vs-AABB intersection. Returns true if any part of the segment
 *  [a, b] lies inside `box`. Handles zero-length segments and rays that start inside. */
export function segmentHitsAabb(a: Point3, b: Point3, box: Aabb): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;

  let tMin = 0;
  let tMax = 1;

  const clip = (origin: number, delta: number, slabMin: number, slabMax: number): boolean => {
    if (Math.abs(delta) < 1e-9) {
      return origin >= slabMin && origin <= slabMax;
    }
    let t1 = (slabMin - origin) / delta;
    let t2 = (slabMax - origin) / delta;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    return tMin <= tMax;
  };

  if (!clip(a.x, dx, box.minX, box.maxX)) return false;
  if (!clip(a.y, dy, box.minY, box.maxY)) return false;
  if (!clip(a.z, dz, box.minZ, box.maxZ)) return false;
  return true;
}

export function raycastHitsAnyAabb(origin: Point3, target: Point3, boxes: Aabb[]): boolean {
  for (const box of boxes) {
    if (segmentHitsAabb(origin, target, box)) return true;
  }
  return false;
}

export function distance3(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
