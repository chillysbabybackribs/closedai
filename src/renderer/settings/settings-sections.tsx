import { PerformancePanel } from './performance-panel.js'
import type { ElementType, JSX, ReactNode } from 'react'
import { Tabs } from 'radix-ui'
import { Cpu, KeyRound, ShieldCheck, Type } from 'lucide-react'
import { AppearancePanel } from './appearance-panel.js'
import { CredentialVaultPanel } from './credential-vault-panel.js'
import { SecurityPanel } from './security-panel.js'
import { ModelsPanel } from './models-panel.js'
import type { AppearanceSettings } from './appearance-settings.js'
import type { BackdropStatus } from '../backdrop/use-workspace-backdrop.js'

export type SettingsTab = 'appearance' | 'models' | 'performance' | 'credentials' | 'security'

const TABS: Array<{ id: SettingsTab; label: string; description: string; icon: JSX.Element }> = [
  { id: 'appearance', label: 'Appearance', description: 'Adjust chat readability and what shows behind the workspace.', icon: <Type size={18} /> },
  { id: 'models', label: 'Models', description: 'Choose which models from each connected provider appear in the composer menu.', icon: <Cpu size={18} /> },
  { id: 'performance', label: 'Performance', description: 'Tune responsiveness, background providers and chat naming; compare response timings.', icon: <Cpu size={18} /> },
  { id: 'credentials', label: 'Credentials', description: 'API keys and logins the app and its agents can use, encrypted by your OS keychain.', icon: <KeyRound size={18} /> },
  { id: 'security', label: 'Security', description: 'Manual choices about credentials and the browser. Defaults keep the app unrestricted.', icon: <ShieldCheck size={18} /> }
]

export type SettingsSectionsProps = {
  /** The surface is showing; panels that poll or load only do so while theirs is the open tab. */
  active: boolean
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  appearance: AppearanceSettings
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void
  backdropStatus: BackdropStatus
  onOpenWallpaper: () => void
  /** The dialog names itself with its own title and description parts; Start uses plain text. */
  Title?: ElementType<{ className?: string; children: ReactNode }>
  Description?: ElementType<{ id?: string; children: ReactNode }>
  descriptionId?: string
}

/** The app's configuration surfaces as tabs: the Settings dialog and Start's Settings view. */
export function SettingsSections({
  active, tab, onTabChange, appearance, onAppearanceChange, backdropStatus, onOpenWallpaper,
  Title = 'h2', Description = 'p', descriptionId
}: SettingsSectionsProps): JSX.Element {
  const current = TABS.find((entry) => entry.id === tab) ?? TABS[0]!
  return (
    <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value as SettingsTab)} className="settings-tabs-root">
      <div className="appearance-dialog-heading settings-heading">
        <div className="appearance-dialog-icon" aria-hidden="true">{current.icon}</div>
        <div className="settings-heading-copy">
          <Title className="appearance-dialog-title">{current.label}</Title>
          <Description id={descriptionId}>{current.description}</Description>
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
        <ModelsPanel active={active && tab === 'models'} />
      </Tabs.Content>
      <Tabs.Content value="performance" className="settings-tab-content">
        <PerformancePanel active={active && tab === 'performance'} />
      </Tabs.Content>
      <Tabs.Content value="credentials" className="settings-tab-content">
        <CredentialVaultPanel active={active && tab === 'credentials'} />
      </Tabs.Content>
      <Tabs.Content value="security" className="settings-tab-content">
        <SecurityPanel active={active && tab === 'security'} />
      </Tabs.Content>
    </Tabs.Root>
  )
}
