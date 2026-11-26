/*
 * Body extents from mass and density contrast, mirroring engine/geometry.py. This is pure
 * geometry used to reject impossible configurations before they reach the engine; the
 * engine repeats the check and remains authoritative.
 */
import type { BodyConfig, Terrain } from '../../types/config'

export interface BodyExtent {
  radius: number | null
  halfX: number
  halfY: number
  halfZ: number
  x: number
  y: number
  zCenter: number
}

export function bodyExtent(body: BodyConfig): BodyExtent | null {
  const mass = Math.abs(body.mass_kg)
  const density = Math.abs(body.density_contrast_kg_m3)
  if (!Number.isFinite(mass) || !Number.isFinite(density) || density <= 0 || mass <= 0) return null
  const volume = mass / density
  let radius: number | null = null
  let halfX: number
  let halfY: number
  let halfZ: number
  if (body.geometry === 'sphere') {
    radius = Math.cbrt((3 * volume) / (4 * Math.PI))
    halfX = halfY = halfZ = radius
  } else if (body.geometry === 'cube') {
    halfX = halfY = halfZ = Math.cbrt(volume) / 2
  } else {
    const thickness = Math.cbrt(volume / 9)
    halfX = halfY = 1.5 * thickness
    halfZ = thickness / 2
  }
  return { radius, halfX, halfY, halfZ, x: body.x_m, y: body.y_m, zCenter: -body.depth_m }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function extentsOverlap(a: BodyExtent, b: BodyExtent): boolean {
  if (a.radius !== null && b.radius !== null) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.zCenter - b.zCenter) < a.radius + b.radius
  }
  if (a.radius === null && b.radius === null) {
    return (
      Math.abs(a.x - b.x) < a.halfX + b.halfX &&
      Math.abs(a.y - b.y) < a.halfY + b.halfY &&
      Math.abs(a.zCenter - b.zCenter) < a.halfZ + b.halfZ
    )
  }
  const sphere = a.radius !== null ? a : b
  const box = a.radius !== null ? b : a
  const cx = clamp(sphere.x, box.x - box.halfX, box.x + box.halfX)
  const cy = clamp(sphere.y, box.y - box.halfY, box.y + box.halfY)
  const cz = clamp(sphere.zCenter, box.zCenter - box.halfZ, box.zCenter + box.halfZ)
  return Math.hypot(sphere.x - cx, sphere.y - cy, sphere.zCenter - cz) < (sphere.radius ?? 0)
}

/** Lowest ground elevation relative to the datum for a terrain model. */
export function terrainMinElevation(terrain: Terrain, relief: number): number {
  return terrain === 'flat' ? 0 : -relief / 2
}

export function axisCount(extent: number, spacing: number): number {
  return Math.floor(extent / spacing + 1e-9) + 1
}
