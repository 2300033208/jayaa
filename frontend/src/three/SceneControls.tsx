import { RotateCcw } from 'lucide-react'
import { Button } from '../components/controls/Button'
import { Segmented, Toggle } from '../components/controls/Choice'
import { formatQuantity } from '../utils/units'
import type { SceneOptions } from './sceneOptions'
import styles from './scene.module.css'

interface Props {
  options: SceneOptions
  onChange: (options: SceneOptions) => void
  maxDepth: number
  mode: 'live' | 'reconstruction'
}

const VIEW_OPTIONS = [
  { value: 'perspective', label: '3D' },
  { value: 'top', label: 'Plan' },
  { value: 'side', label: 'Section' },
] as const

export function SceneControls({ options, onChange, maxDepth, mode }: Props) {
  const set = (patch: Partial<SceneOptions>) => {
    onChange({ ...options, ...patch })
  }
  const sliceOn = options.sliceDepth !== null
  return (
    <div className={styles.controls} role="group" aria-label="3D view controls">
      <Segmented
        name={`scene-view-${mode}`}
        ariaLabel="Camera view"
        value={options.view}
        options={VIEW_OPTIONS}
        onChange={(view) => {
          set({ view, resetToken: options.resetToken + 1 })
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<RotateCcw />}
        onClick={() => {
          set({ resetToken: options.resetToken + 1 })
        }}
      >
        Reset view
      </Button>
      <label className={styles.sliderControl}>
        <span>Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={options.opacity}
          aria-valuetext={`${Math.round(options.opacity * 100)} percent`}
          onChange={(e) => {
            set({ opacity: Number(e.target.value) })
          }}
        />
      </label>
      <Toggle
        label="Depth slice"
        checked={sliceOn}
        onChange={(on) => {
          set({ sliceDepth: on ? Math.round(maxDepth / 2) : null })
        }}
      />
      {sliceOn && (
        <label className={styles.sliderControl}>
          <span className="visually-hidden">Slice depth</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(maxDepth))}
            step={Math.max(1, Math.round(maxDepth / 200))}
            value={options.sliceDepth ?? 0}
            aria-valuetext={formatQuantity(options.sliceDepth, 'length')}
            onChange={(e) => {
              set({ sliceDepth: Number(e.target.value) })
            }}
          />
          <span className={styles.sliderValue}>{formatQuantity(options.sliceDepth, 'length')}</span>
        </label>
      )}
      <Toggle
        label="Isolate anomaly"
        checked={options.isolate}
        onChange={(isolate) => {
          set({ isolate })
        }}
      />
      {mode === 'live' && (
        <Toggle
          label="Sensor"
          checked={options.showSensor}
          onChange={(showSensor) => {
            set({ showSensor })
          }}
        />
      )}
      <Toggle
        label="Survey path"
        checked={options.showPath}
        onChange={(showPath) => {
          set({ showPath })
        }}
      />
      {mode === 'reconstruction' && (
        <Toggle
          label="Ground truth"
          checked={options.showTruth}
          onChange={(showTruth) => {
            set({ showTruth })
          }}
        />
      )}
    </div>
  )
}
