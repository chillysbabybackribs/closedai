import type { JSX } from 'react'
import { Tabs } from 'radix-ui'
import { Cpu, KeyRound, ShieldCheck, Type } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import { AppearancePanel } from './appearance-panel.js'
import { CredentialVaultPanel } from './credential-vault-panel.js'
import { SecurityPanel } from './security-panel.js'
import { ModelsPanel } from './models-panel.js'
import type { AppearanceSettings } from './appearance-settings.js'
import type { BackdropStatus } from '../backdrop/use-workspace-backdrop.js'

export type SettingsTab = 'appearance' | 'models' | 'credentials' | 'security'

const TABS: Array<{ id: SettingsTab; label: string; description: string; icon: JSX.Element }> = [
  { id: 'appearance', label: 'Appearance', description: 'Adjust chat readability and what shows behind the workspace.', icon: <Type size={18} /> },
  { id: 'models', label: 'Models', description: 'Choose which models from each connected provider appear in the composer menu.', icon: <Cpu size={18} /> },
  { id: 'credentials', label: 'Credentials', description: 'API keys and logins the app and its agents can use, encrypted by your OS keychain.', icon: <KeyRound size={18} /> },
  { id: 'security', label: 'Security', description: 'Manual choices about credentials and the browser. Defaults keep the app unrestricted.', icon: <ShieldCheck size={18} /> }
]

export type SettingsDialogProps = {
  open: boolean
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onOpenChange: (open: boolean) => void
  appearance: AppearanceSettings
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void
  backdropStatus: BackdropStatus
  onOpenWallpaper: () => void
}

/** File → Settings: one fixed-size dialog whose tabs are the app's configuration surfaces. */
export function SettingsDialog({
  open,
  tab,
  onTabChange,
  onOpenChange,
  appearance,
  onAppearanceChange,
  backdropStatus,
  onOpenWallpaper
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
            <AppearancePanel {...appearance} backdropStatus={backdropStatus} onChange={onAppearanceChange}
              onOpenWallpaper={onOpenWallpaper} />
          </Tabs.Content>
          <Tabs.Content value="models" className="settings-tab-content">
            <ModelsPanel active={open && tab === 'models'} />
          </Tabs.Content>
          <Tabs.Content value="credentials" className="settings-tab-content">
            <CredentialVaultPanel active={open && tab === 'credentials'} />
          </Tabs.Content>
          <Tabs.Content value="security" className="settings-tab-content">
            <SecurityPanel active={open && tab === 'security'} />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
