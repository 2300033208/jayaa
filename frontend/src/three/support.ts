import type { SurveyPlan } from '../types/api'

/** Depth (m, positive) of the displayed subsurface volume for a plan. Shared by scene and controls. */
export function volumeDepthFor(plan: SurveyPlan): number {
  const width = plan.bounds.width_m
  const length = plan.pattern === 'profile' ? Math.max(plan.bounds.length_m, width * 0.25) : plan.bounds.length_m
  const deepest = plan.bodies.reduce((max, b) => Math.max(max, b.depth_m + b.size_z_m / 2), 0)
  return Math.max(deepest * 1.25, Math.max(width, length) * 0.2)
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return false
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
