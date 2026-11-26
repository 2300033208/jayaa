import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom does not implement layout-dependent APIs used for scrolling to invalid fields.
Element.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})
