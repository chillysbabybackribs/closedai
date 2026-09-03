import type { JSX } from 'react'
import { Minus, Plus, RotateCcw, Type } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  COMPOSER_FONT_SIZE_DEFAULT,
  COMPOSER_FONT_SIZE_MAX,
  COMPOSER_FONT_SIZE_MIN,
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearanceSettings
} from './appearance-settings.js'
import {
  CHAT_ZOOM_DEFAULT,
  CHAT_ZOOM_MAX,
  CHAT_ZOOM_MIN,
  CHAT_ZOOM_STEP
} from '../chat-zoom.js'

export type AppearanceSettingsDialogProps = AppearanceSettings & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<AppearanceSettings>) => void
}

export function AppearanceSettingsDialog({
  open,
  chatFontSize,
  composerFontSize,
  chatZoom,
  onOpenChange,
  onChange
}: AppearanceSettingsDialogProps): JSX.Element {
  const isDefault = chatFontSize === CHAT_FONT_SIZE_DEFAULT
    && composerFontSize === COMPOSER_FONT_SIZE_DEFAULT
    && chatZoom === CHAT_ZOOM_DEFAULT

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="appearance-dialog" aria-describedby="appearance-description" data-ui="dialog.settings">
        <div className="appearance-dialog-heading">
          <div className="appearance-dialog-icon" aria-hidden="true"><Type size={18} /></div>
          <div>
            <DialogTitle className="appearance-dialog-title">Appearance</DialogTitle>
            <DialogDescription id="appearance-description">
              Adjust chat readability without changing the browser pane.
            </DialogDescription>
          </div>
        </div>

        <div className="appearance-controls">
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
      </DialogContent>
    </Dialog>
  )
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
