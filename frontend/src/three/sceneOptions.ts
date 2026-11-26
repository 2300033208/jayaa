export type SceneView = 'perspective' | 'top' | 'side'

export interface SceneOptions {
  opacity: number
  /** Depth (m) of the horizontal slice; geometry above it is clipped. Null disables the slice. */
  sliceDepth: number | null
  isolate: boolean
  showSensor: boolean
  showPath: boolean
  showTruth: boolean
  view: SceneView
  /** Incremented to re-apply the camera preset. */
  resetToken: number
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  opacity: 0.55,
  sliceDepth: null,
  isolate: false,
  showSensor: true,
  showPath: true,
  showTruth: true,
  view: 'perspective',
  resetToken: 0,
}
