import type { JSX } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import { SettingsSections, type SettingsSectionsProps } from './settings-sections.js'

export type { SettingsTab } from './settings-sections.js'

export type SettingsDialogProps = Omit<SettingsSectionsProps, 'active' | 'Title' | 'Description' | 'descriptionId'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** File → Settings: one fixed-size dialog whose tabs are the app's configuration surfaces. */
export function SettingsDialog({ open, onOpenChange, ...sections }: SettingsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" aria-describedby="settings-description" data-ui="dialog.settings">
        <SettingsSections {...sections} active={open} Title={DialogTitle} Description={DialogDescription}
          descriptionId="settings-description" />
      </DialogContent>
    </Dialog>
  )
}
