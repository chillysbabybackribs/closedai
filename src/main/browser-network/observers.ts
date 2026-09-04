import type { Session, WebContents } from 'electron'
import { installRequestHeaderPipeline } from '../browser-auth-client-hints.js'
import { BROWSER_ZOOM_MESSAGE_PREFIX } from '../../shared/browser-zoom.js'
import { ConsoleLog } from './console-log.js'
import { NetworkLog } from './network-log.js'
import { installNetworkObserver, requestHeaderInjector } from './network-observer.js'
import { NetworkRules } from './network-rules.js'

/**
 * Everything the app records about the browser without a debugger, composed in one place so
 * BrowserService installs it with two calls: once on the session, once per tab.
 */
export class BrowserObservers {
  readonly network = new NetworkLog()
  readonly rules = new NetworkRules()
  readonly console = new ConsoleLog((message) => message.startsWith(BROWSER_ZOOM_MESSAGE_PREFIX))

  constructor(private readonly tabIdOf: (webContentsId: number | undefined) => string | null) {}

  /** Session hooks: the request-header stage is shared with identity normalisation. */
  install(browserSession: Session, applicationName: string): void {
    installRequestHeaderPipeline(browserSession, applicationName, requestHeaderInjector(this.rules, this.tabIdOf))
    installNetworkObserver(browserSession, { log: this.network, rules: this.rules, tabIdOf: this.tabIdOf })
  }

  watchTab(tabId: string, contents: WebContents): void {
    this.console.attach(tabId, contents)
  }
}
