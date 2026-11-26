/**
 * Text for a number in an editable field: plain for ordinary magnitudes and whole numbers,
 * e-notation otherwise. `plain` forces full digits (used for exact values such as frequencies).
 */
export function editableText(value: number, notation: 'auto' | 'plain' = 'auto'): string {
  if (!Number.isFinite(value)) return ''
  const magnitude = Math.abs(value)
  // Whole numbers below 10¹⁵ (seeds, frequencies in Hz, counts) are exact and read best in full.
  if (Number.isInteger(value) && magnitude < 1e9) return String(value)
  if (notation === 'plain' && magnitude < 1e21) return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 })
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) {
    return value.toExponential().replace('e+', 'e')
  }
  return String(Number(value.toPrecision(12)))
}

/**
 * Parses user input. Empty or non-numeric text yields NaN so validation reports it;
 * the value is never silently replaced with zero. Accepts thin/narrow spaces as digit
 * separators, the Unicode minus sign, and "×10^" notation.
 */
export function parseNumberInput(text: string): number {
  const cleaned = text
    .replace(/[\s\u2009\u202f]/g, '')
    .replace(/\u2212/g, '-')
    .replace(/[×x]10\^?/i, 'e')
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return Number.NaN
  return Number(cleaned)
}
