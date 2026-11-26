import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, LinearFilter, PerspectiveCamera, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three'
import { anchorInsideViewport } from './sceneMath'

export interface LabelStyle {
  ink: string
  background: string
  border: string
  fontFamily: string
}

interface LabelProps {
  text: string
  position: readonly [number, number, number]
  style: LabelStyle
  /** Accent drawn as a left bar (e.g. estimate color); optional. */
  accent?: string
  bold?: boolean
}

const PIXEL_RATIO = 2
const FONT_PX = 11
const PAD_X = 6
const HEIGHT_PX = 20
/** Screen-space label height (sizeAttenuation off keeps labels readable at any zoom). */
const SCREEN_HEIGHT = 0.042
/**
 * Text label rendered as a sprite with a canvas texture. Unlike DOM overlays it needs no
 * separate React root, and its texture and material are disposed on unmount.
 */
export function Label({ text, position, style, accent, bold = false }: LabelProps) {
  const sprite = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const font = `${bold ? 600 : 500} ${FONT_PX * PIXEL_RATIO}px ${style.fontFamily}`
    let width = 80 * PIXEL_RATIO
    if (ctx) {
      ctx.font = font
      width = Math.ceil(ctx.measureText(text).width) + (PAD_X * 2 + (accent ? 4 : 0)) * PIXEL_RATIO
    }
    const height = HEIGHT_PX * PIXEL_RATIO
    canvas.width = width
    canvas.height = height
    if (ctx) {
      const r = 4 * PIXEL_RATIO
      ctx.beginPath()
      ctx.roundRect(1, 1, width - 2, height - 2, r)
      ctx.fillStyle = style.background
      ctx.globalAlpha = 0.92
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = PIXEL_RATIO
      ctx.strokeStyle = style.border
      ctx.stroke()
      if (accent) {
        ctx.fillStyle = accent
        ctx.fillRect(3 * PIXEL_RATIO, 4 * PIXEL_RATIO, 2 * PIXEL_RATIO, height - 8 * PIXEL_RATIO)
      }
      ctx.font = font
      ctx.fillStyle = style.ink
      ctx.textBaseline = 'middle'
      ctx.fillText(text, (PAD_X + (accent ? 4 : 0)) * PIXEL_RATIO, height / 2 + PIXEL_RATIO / 2)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: false })
    const result = new Sprite(material)
    result.center.set(0.5, 0)
    result.scale.set((SCREEN_HEIGHT * width) / height, SCREEN_HEIGHT, 1)
    result.renderOrder = 20
    return result
  }, [text, style.fontFamily, style.background, style.border, style.ink, accent, bold])

  // Labels near the edge of the view (e.g. the reference clock at a survey corner) would be cut
  // off; the anchor shifts each frame so the whole label stays inside the canvas.
  const placed = useRef<Sprite>(null)
  const projected = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    const label = placed.current
    if (label === null || !(camera instanceof PerspectiveCamera)) return
    label.getWorldPosition(projected).project(camera)
    // With sizeAttenuation off, a sprite of scale s spans s / tan(fov / 2) in NDC (÷ aspect horizontally).
    const width = label.scale.x / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect)
    label.center.x = anchorInsideViewport(projected.x, width)
  })

  useEffect(
    () => () => {
      sprite.material.map?.dispose()
      sprite.material.dispose()
    },
    [sprite],
  )

  return <primitive ref={placed} object={sprite} position={[position[0], position[1], position[2]]} />
}
