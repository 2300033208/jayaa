import { describe, expect, it } from 'vitest'
import { anchorInsideViewport } from './sceneMath'

describe('label placement', () => {
  it('centres labels that fit and slides edge labels inside the viewport', () => {
    expect(anchorInsideViewport(0, 0.3)).toBe(0.5)
    // Anchor near the left edge: the label must start at or right of −1 + margin.
    const left = anchorInsideViewport(-0.95, 0.3)
    expect(-0.95 - left * 0.3).toBeGreaterThanOrEqual(-0.98 - 1e-12)
    // Anchor near the right edge: the label must end at or left of 1 − margin.
    const right = anchorInsideViewport(0.95, 0.3)
    expect(0.95 + (1 - right) * 0.3).toBeLessThanOrEqual(0.98 + 1e-12)
    // Anchor off-screen: clamped to a full shift, never beyond.
    expect(anchorInsideViewport(-1.5, 0.3)).toBe(0)
    expect(anchorInsideViewport(1.5, 0.3)).toBe(1)
  })
})
