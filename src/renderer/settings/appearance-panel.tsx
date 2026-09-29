import type { JSX } from 'react'
import { ImageIcon, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { BackdropStatus } from '../backdrop/use-workspace-backdrop.js'
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  COMPOSER_FONT_SIZE_DEFAULT,
  COMPOSER_FONT_SIZE_MAX,
  COMPOSER_FONT_SIZE_MIN,
  DEFAULT_APPEARANCE_SETTINGS,
  WORKSPACE_BACKDROP_DEFAULT,
  type AppearanceSettings,
  type WorkspaceBackdrop
} from './appearance-settings.js'
import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  CHAT_ZOOM_STEP
} from '../chat-zoom.js'

export type AppearancePanelProps = AppearanceSettings & {
  backdropStatus: BackdropStatus
  onChange: (patch: Partial<AppearanceSettings>) => void
  /** Open the wallpaper picker; the choice itself lives there. */
  onOpenWallpaper: () => void
}

/** The Appearance tab of Settings: the workspace wallpaper, three sliders and a reset. Persistence belongs to the caller. */
export function AppearancePanel({
  chatFontSize,
  composerFontSize,
  chatZoom,
  backdrop,
  backdropStatus,
  onChange,
  onOpenWallpaper
}: AppearancePanelProps): JSX.Element {
  const isDefault = chatFontSize === CHAT_FONT_SIZE_DEFAULT
    && composerFontSize === COMPOSER_FONT_SIZE_DEFAULT
    && chatZoom === CHAT_ZOOM_DEFAULT
    && backdrop === WORKSPACE_BACKDROP_DEFAULT

  return (
    <div className="settings-panel appearance-panel">
        <div className="appearance-controls">
          <div className="appearance-control appearance-wallpaper">
            <div className="appearance-control-copy">
              <label id="workspace-backdrop">Wallpaper</label>
              <span>{backdropHint(backdropStatus, backdrop)}</span>
            </div>
            <Button type="button" variant="outline" size="sm" className="appearance-wallpaper-open"
              aria-describedby="workspace-backdrop" data-ui="settings.wallpaper" onClick={onOpenWallpaper}>
              <ImageIcon size={14} aria-hidden="true" />
              Change wallpaper…
            </Button>
          </div>
          <AppearanceControl
            id="chat-font-size"
            label="Chat text"
            hint="Messages in the transcript"
            value={chatFontSize}
            suffix="px"
            min={CHAT_FONT_SIZE_MIN}
            max={CHAT_FONT_SIZE_MAX}
            step={1}
            onChange={(value) => onChange({ chatFontSize: value })}
          />
          <AppearanceControl
            id="composer-font-size"
            label="Composer text"
            hint="The text you type"
            value={composerFontSize}
            suffix="px"
            min={COMPOSER_FONT_SIZE_MIN}
            max={COMPOSER_FONT_SIZE_MAX}
            step={1}
            onChange={(value) => onChange({ composerFontSize: value })}
          />
          <AppearanceControl
            id="chat-zoom"
            label="Chat zoom"
            hint="Text, controls, and spacing"
            value={chatZoom}
            suffix="%"
            min={CHAT_ZOOM_MIN}
            max={CHAT_ZOOM_MAX}
            step={CHAT_ZOOM_STEP}
            onChange={(value) => onChange({ chatZoom: value })}
          />
        </div>

        <div className="appearance-dialog-footer">
          <Button
            type="button"
            variant="ghost"
            className="appearance-reset"
            data-ui="settings.reset"
            disabled={isDefault}
            onClick={() => onChange(DEFAULT_APPEARANCE_SETTINGS)}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset appearance
          </Button>
          <span>Changes are saved automatically</span>
        </div>
    </div>
  )
}

function backdropHint(status: BackdropStatus, mode: WorkspaceBackdrop): string {
  switch (status.state) {
    case 'off': return 'Flat, behind every tile'
    case 'loading': return mode === 'desktop' ? 'Reading your desktop wallpaper' : 'Loading background'
    case 'ready': return status.name
    case 'unavailable': return mode === 'desktop' ? 'No desktop wallpaper found' : 'Background unavailable'
  }
}

function AppearanceControl({
  id,
  label,
  hint,
  value,
  suffix,
  min,
  max,
  step,
  onChange
}: {
  id: string
  label: string
  hint: string
  value: number
  suffix: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <div className="appearance-control">
      <div className="appearance-control-copy">
        <label htmlFor={id}>{label}</label>
        <span>{hint}</span>
      </div>
      <div className="appearance-control-inputs">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          data-ui="settings.decrease"
          data-ui-key={id}
          disabled={value <= min}
          onClick={() => onChange(value - step)}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          id={id}
          type="range"
          data-ui="settings.range"
          data-ui-key={id}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={`${value}${suffix}`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          data-ui="settings.increase"
          data-ui-key={id}
          disabled={value >= max}
          onClick={() => onChange(value + step)}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <output htmlFor={id}>{value}{suffix}</output>
      </div>
    </div>
  )
}
