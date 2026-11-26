import type { Playback } from '../../types/config'
import { PLAYBACKS } from '../../types/config'
import { isRecord } from '../../api/parse'

/** Router state that asks the Simulation page to start a run once (not stored in the URL). */
export interface AutostartState {
  autostart: { key: string; playback: Playback }
}

export function readAutostart(state: unknown): AutostartState['autostart'] | null {
  if (!isRecord(state)) return null
  const auto = state.autostart
  if (!isRecord(auto)) return null
  const key = auto.key
  const playback = auto.playback
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) return null
  if (typeof playback !== 'string' || !(PLAYBACKS as readonly string[]).includes(playback)) return null
  return { key, playback: playback as Playback }
}
