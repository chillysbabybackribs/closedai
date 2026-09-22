import type { ToolCallRequest } from '../registry.js'
import type { JsonObject } from '../tool.js'

/** Verbs that only observe a page; they never claim a tab and take no resource lock. */
export const BROWSER_OBSERVING: Record<string, readonly string[]> = {
  'embedded_browser.page': ['read_page', 'wait_for'],
  'embedded_browser.script': ['query', 'extract', 'console'],
  'embedded_browser.session': ['cookies'],
  'embedded_browser.network': ['requests', 'wait', 'rules'],
  'closedai_ui.capture': ['browser_page'],
  'browser_cdp.page': ['inspect_page'],
  'browser_cdp.profile': ['metrics'],
  'browser_cdp.protocol': ['capabilities', 'targets', 'events', 'requests', 'body'],
  'browser_cdp.instrument': ['recording']
}

export function isBrowserObservingCall(request: ToolCallRequest, input: JsonObject): boolean {
  const action = String(input.action ?? '')
  const { namespace, tool } = request
  if (namespace === 'closedai_app' && tool === 'command' && action === 'browser_tab') {
    return ['select', 'release', 'release_all', 'claim'].includes(String(input.op))
  }
  if (namespace === 'embedded_browser' && tool === 'session' && action === 'fetch') {
    return ['GET', 'HEAD'].includes(String(input.method ?? 'GET').toUpperCase())
  }
  if (namespace === 'embedded_browser' && tool === 'network' && action === 'add_rule' && input.tab_id) {
    return false
  }
  return BROWSER_OBSERVING[`${namespace}.${tool}`]?.includes(action) === true
}

function tabKey(input: JsonObject): string | null {
  const tab = typeof input.tab_id === 'string' && input.tab_id.length > 0 ? input.tab_id : null
  return tab ? `browser:tab:${tab}` : null
}

/** Serialize only the surface that actually contends; never block unrelated tabs or reads. */
export function browserResourceLockKey(request: ToolCallRequest, input: JsonObject): string | null {
  if (isBrowserObservingCall(request, input)) return null
  const action = String(input.action ?? '')
  const { namespace, tool } = request

  if (namespace === 'closedai_app' && tool === 'ui' && ['click', 'type', 'press_key', 'scroll'].includes(action)) {
    return 'browser:app-input'
  }
  if (namespace === 'closedai_app' && tool === 'command' && action === 'browser_tab') {
    const op = String(input.op)
    if (['release', 'release_all', 'claim'].includes(op)) return null
    if (['new', 'new_right'].includes(op)) return 'browser:strip'
    if (['close_others', 'close_right'].includes(op)) return 'browser:strip'
    return tabKey(input) ?? 'browser:strip'
  }
  if (namespace === 'embedded_browser') {
    if (tool === 'session') return 'browser:session'
    if (tool === 'network') {
      if (action === 'add_rule' && input.tab_id) return tabKey(input)
      if (['add_rule', 'remove_rule', 'clear'].includes(action)) return 'browser:session'
    }
    if (['page', 'script'].includes(tool)) {
      if (tool === 'page' && action === 'navigate' && input.new_tab === true) return 'browser:strip'
      return tabKey(input) ?? 'browser:strip'
    }
  }
  if (namespace === 'closedai_ui' && tool === 'capture') return null
  if (namespace === 'browser_cdp') {
    if (tool === 'page' && ['click', 'click_at', 'type', 'press_key', 'scroll', 'dismiss_overlay'].includes(action)) {
      return 'browser:page-input'
    }
    if (tool === 'protocol') {
      if (action === 'target') return 'browser:session'
      if (action === 'command') {
        const method = String(input.method ?? '')
        if (/^Input\./.test(method)) return 'browser:page-input'
        if (method.startsWith('Target.') && !['Target.getTargets', 'Target.getTargetInfo'].includes(method)) {
          return 'browser:session'
        }
        if (/^(Browser|Storage)\./.test(method) && !/\.(get|can)/.test(method)) return 'browser:session'
        if (/^Network\.(setCookie|setCookies|deleteCookies|clearBrowserCookies|clearBrowserCache)$/.test(method)) {
          return 'browser:session'
        }
      }
    }
    if (['profile', 'instrument', 'emulate'].includes(tool)) return tabKey(input) ?? 'browser:strip'
    return tabKey(input)
  }
  return null
}

export function browserResourceLocksConflict(left: string, right: string): boolean {
  if (left === right) return true
  if (left === 'browser:strip' && right.startsWith('browser:tab:')) return true
  if (right === 'browser:strip' && left.startsWith('browser:tab:')) return true
  return false
}

export function describeBrowserResource(key: string): string {
  if (key === 'browser:strip') return 'the browser tab strip'
  if (key === 'browser:session') return 'the shared browser session'
  if (key === 'browser:app-input') return 'ClosedAI app input'
  if (key === 'browser:page-input') return 'browser page input (foreground)'
  if (key.startsWith('browser:tab:')) return `browser tab ${key.slice('browser:tab:'.length)}`
  return key
}
