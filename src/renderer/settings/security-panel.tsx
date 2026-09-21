import { useEffect, useMemo, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { RadioGroup } from 'radix-ui'
import { Download } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Switch } from '../../components/ui/switch.js'
import type { SecuritySettings, WebPermissionPolicy } from '../../shared/security.js'
import { createSecurityController, type SecurityController } from './security-settings.js'

export type SecurityPanelProps = {
  /** The panel reads its settings only while its tab is shown. */
  active: boolean
}

const WEB_PERMISSION_CHOICES: ReadonlyArray<{ value: WebPermissionPolicy; label: string }> = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' }
]

/**
 * The Security tab of Settings: the user's manual choices about credentials and the browser,
 * plus a plain statement of what agents may do. Every default is the app's unrestricted
 * behavior; storage is the main process, reached through the controller beside this file.
 */
export function SecurityPanel({ active }: SecurityPanelProps): JSX.Element {
  const controller = useMemo<SecurityController>(() => createSecurityController(window.closedai?.security), [])
  const state = useSyncExternalStore(controller.subscribe, controller.getState)

  useEffect(() => {
    if (active) void controller.load()
  }, [active, controller])

  const set = (patch: Partial<SecuritySettings>): void => { void controller.update(patch) }
  const { settings } = state

  return (
    <div className="settings-panel security-panel" data-ui="dialog.security">
      <div className="security-sections">
        <SecuritySection title="Credentials">
          <SecuritySwitchRow
            id="security-credentials-approval"
            label="Ask me before an agent reads a credential"
            control="security.credentials-approval"
            checked={settings.credentialsRequireApproval}
            onCheckedChange={(checked) => set({ credentialsRequireApproval: checked })}
          />
          <SecuritySwitchRow
            id="security-secrets-keychain"
            label="Only save secrets when the OS keychain is available"
            control="security.secrets-keychain"
            checked={settings.secretsRequireKeychain}
            onCheckedChange={(checked) => set({ secretsRequireKeychain: checked })}
          />
          <p className="security-note">
            Each credential also has its own &ldquo;Agents can use this&rdquo; switch in the Credentials tab.
          </p>
        </SecuritySection>

        <SecuritySection title="Browser">
          <div className="security-row security-row-stacked">
            <span className="security-row-label" id="security-web-permissions-label">
              When a website asks for camera, microphone, screen, or location
            </span>
            <RadioGroup.Root
              className="security-segmented"
              aria-labelledby="security-web-permissions-label"
              value={settings.webPermissions}
              onValueChange={(value) => set({ webPermissions: value as WebPermissionPolicy })}
            >
              {WEB_PERMISSION_CHOICES.map((choice) => (
                <RadioGroup.Item
                  key={choice.value}
                  value={choice.value}
                  className="security-segment"
                  data-ui="security.web-permissions"
                  data-ui-key={choice.value}
                >
                  {choice.label}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          </div>
          <SecuritySwitchRow
            id="security-import-cookies"
            label="Use signed-in sites from Chrome"
            control="security.import-cookies"
            checked={settings.importBrowserCookies}
            onCheckedChange={(checked) => set({ importBrowserCookies: checked })}
          >
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="security-import-now"
              data-ui="security.import-now"
              disabled={state.importing}
              aria-describedby={state.importResult ? 'security-import-result' : undefined}
              onClick={() => { void controller.importCookies() }}
            >
              <Download size={14} aria-hidden="true" />
              {state.importing ? 'Importing…' : 'Import now'}
            </Button>
          </SecuritySwitchRow>
          {state.importResult ? (
            <p className="security-note security-import-result" id="security-import-result" role="status">
              {state.importResult}
            </p>
          ) : null}
        </SecuritySection>

        <SecuritySection title="Agents">
          <p className="security-note security-agents-copy">
            Agents run unrestricted: they can edit files, run commands in the project, and browse the web
            without asking. ClosedAI does not gate those actions.
          </p>
        </SecuritySection>
      </div>

      <div className="appearance-dialog-footer security-footer">
        {state.error ? (
          <span className="security-error" role="alert">{state.error}</span>
        ) : (
          <span>Changes are saved automatically</span>
        )}
      </div>
    </div>
  )
}

function SecuritySection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="security-section" aria-label={title}>
      <h3 className="security-section-title">{title}</h3>
      {children}
    </section>
  )
}

function SecuritySwitchRow({
  id,
  label,
  control,
  checked,
  onCheckedChange,
  children
}: {
  id: string
  label: string
  control: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Optional trailing control, such as a button that acts on the same subject. */
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="security-row">
      <label className="security-row-label" htmlFor={id}>{label}</label>
      <div className="security-row-controls">
        {children}
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} data-ui={control} />
      </div>
    </div>
  )
}
