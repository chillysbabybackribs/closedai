import type { JSX } from 'react'
import { Tabs } from 'radix-ui'
import { KeyRound, Type } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import { AppearancePanel } from './appearance-panel.js'
import { CredentialVaultPanel } from './credential-vault-panel.js'
import type { AppearanceSettings } from './appearance-settings.js'

export type SettingsTab = 'appearance' | 'credentials'

const TABS: Array<{ id: SettingsTab; label: string; description: string; icon: JSX.Element }> = [
  { id: 'appearance', label: 'Appearance', description: 'Adjust chat readability without changing the browser pane.', icon: <Type size={18} /> },
  { id: 'credentials', label: 'Credentials', description: 'API keys and logins the app and its agents can use, encrypted by your OS keychain.', icon: <KeyRound size={18} /> }
]

export type SettingsDialogProps = {
  open: boolean
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onOpenChange: (open: boolean) => void
  appearance: AppearanceSettings
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void
}

/** File → Settings: one fixed-size dialog whose tabs are the app's configuration surfaces. */
export function SettingsDialog({
  open,
  tab,
  onTabChange,
  onOpenChange,
  appearance,
  onAppearanceChange
}: SettingsDialogProps): JSX.Element {
  const current = TABS.find((entry) => entry.id === tab) ?? TABS[0]!
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" aria-describedby="settings-description" data-ui="dialog.settings">
        <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value as SettingsTab)} className="settings-tabs-root">
          <div className="appearance-dialog-heading settings-heading">
            <div className="appearance-dialog-icon" aria-hidden="true">{current.icon}</div>
            <div className="settings-heading-copy">
              <DialogTitle className="appearance-dialog-title">{current.label}</DialogTitle>
              <DialogDescription id="settings-description">{current.description}</DialogDescription>
            </div>
            <Tabs.List className="settings-tabs" aria-label="Settings sections">
              {TABS.map((entry) => (
                <Tabs.Trigger key={entry.id} value={entry.id} className="settings-tab" data-ui="settings.tab" data-ui-key={entry.id}>
                  {entry.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>
          <Tabs.Content value="appearance" className="settings-tab-content">
            <AppearancePanel {...appearance} onChange={onAppearanceChange} />
          </Tabs.Content>
          <Tabs.Content value="credentials" className="settings-tab-content">
            <CredentialVaultPanel active={open && tab === 'credentials'} />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
