/** DOM id for a configuration field path, e.g. "bodies.0.depth_m" → "field-bodies-0-depth_m". */
export function fieldId(path: string): string {
  return `field-${path.replace(/\./g, '-')}`
}
