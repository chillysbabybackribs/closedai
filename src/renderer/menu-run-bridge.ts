import { useEffect, useRef } from 'react'
import { APP_MENU_RUN_EVENT, type AppMenuRunDetail } from '../shared/app-menu-run.js'
import { runMenuKey, type TitlebarMenuProps } from './application-menu-model.js'

/**
 * `closedai_app.menu`: the main-process ui host dispatches the row key as a CustomEvent and
 * reads the result back from its detail, so a model runs the row through the menu's own handler
 * and eligibility without opening the menu.
 */
export function useMenuRunBridge(menu: TitlebarMenuProps, selectedPaneId: string | null, closeTarget: () => string | null): void {
  const latest = useRef({ menu, selectedPaneId, closeTarget })
  latest.current = { menu, selectedPaneId, closeTarget }
  useEffect(() => {
    const onRun = (event: Event): void => {
      const detail = (event as CustomEvent<AppMenuRunDetail>).detail
      const { menu, selectedPaneId, closeTarget } = latest.current
      detail.result = runMenuKey(detail.key, menu, { selectedPaneId, closeTargetId: closeTarget(), callerPaneId: detail.callerPaneId })
    }
    window.addEventListener(APP_MENU_RUN_EVENT, onRun)
    return () => window.removeEventListener(APP_MENU_RUN_EVENT, onRun)
  }, [])
}
