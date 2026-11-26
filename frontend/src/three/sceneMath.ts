import { Color, Plane, Vector3 } from 'three'
import type { SurveyPlan } from '../types/api'
import { volumeDepthFor } from './support'

/**
 * Maps engine coordinates (x east, y north, z up, metres) to scene units. One uniform scale is
 * used on all axes so depths and distances keep their true proportions.
 */
export interface SceneFrame {
  scale: number
  halfWidth: number
  halfLength: number
  /** Depth (m, positive) of the bottom of the displayed subsurface volume. */
  volumeDepth: number
  toWorld: (x: number, y: number, z: number) => [number, number, number]
}

export const SCENE_EXTENT = 10

export function sceneFrame(plan: SurveyPlan): SceneFrame {
  const width = plan.bounds.width_m
  const length = plan.pattern === 'profile' ? Math.max(plan.bounds.length_m, width * 0.25) : plan.bounds.length_m
  const scale = SCENE_EXTENT / Math.max(width, length)
  const volumeDepth = volumeDepthFor(plan)
  return {
    scale,
    halfWidth: width / 2,
    halfLength: length / 2,
    volumeDepth,
    toWorld: (x, y, z) => [x * scale, z * scale, -y * scale],
  }
}

/** Linear interpolation across a list of CSS hex colors for t ∈ [0, 1]. */
export function rampColor(stops: readonly string[], t: number, target = new Color()): Color {
  if (stops.length === 0) return target.set('#808080')
  const clamped = Math.min(1, Math.max(0, t))
  const position = clamped * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(position))
  if (stops.length === 1) return target.set(stops[0] ?? '#808080')
  const a = new Color(stops[i] ?? '#808080')
  const b = new Color(stops[i + 1] ?? '#808080')
  return target.copy(a).lerp(b, position - i)
}

/** Deviation (σ) mapped onto the diverging ramp, clamped at ±Z_LIMIT. */
export const Z_LIMIT = 5

export function deviationColor(stops: readonly string[], z: number, neutral: string, target = new Color()): Color {
  if (!Number.isFinite(z)) return target.set(neutral)
  return rampColor(stops, (z + Z_LIMIT) / (2 * Z_LIMIT), target)
}

/** Clipping plane that keeps only geometry below `depth` (m). */
export function slicePlane(depth: number | null, frame: SceneFrame): Plane[] {
  if (depth === null) return []
  return [new Plane(new Vector3(0, -1, 0), -depth * frame.scale)]
}

/** Gap kept between a label and the canvas edge, in normalized device coordinates. */
const EDGE_MARGIN_NDC = 0.02

/**
 * Horizontal anchor (sprite.center.x) that keeps a label of width `width` (NDC) inside the
 * viewport: centred when it fits, otherwise slid toward the inside of the view.
 */
export function anchorInsideViewport(x: number, width: number): number {
  if (!(width > 0)) return 0.5
  const highest = (x + 1 - EDGE_MARGIN_NDC) / width // keeps the left edge inside
  const lowest = 1 - (1 - EDGE_MARGIN_NDC - x) / width // keeps the right edge inside
  return Math.min(1, Math.max(0, Math.min(highest, Math.max(lowest, 0.5))))
}
