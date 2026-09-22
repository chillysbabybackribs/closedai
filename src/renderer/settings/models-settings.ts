import { useCallback, useEffect, useState } from 'react'
import type { ModelManifest, ModelSwitch, ModelsEvent } from '../../shared/model-settings.js'
import { errorMessage } from '../error-message.js'

export type ModelsApi = {
  manifest: () => Promise<ModelManifest>
  setEnabled: (modelId: string, enabled: boolean) => Promise<void>
  setEnabledMany: (switches: ModelSwitch[]) => Promise<void>
  onEvent: (listener: (event: ModelsEvent) => void) => () => void
}

export type ModelsController = {
  manifest: ModelManifest | null
  error: string | null
  refresh: () => Promise<void>
  setEnabled: (modelId: string, enabled: boolean) => Promise<void>
  setEnabledMany: (switches: ModelSwitch[]) => Promise<void>
}

function withModelEnabled(manifest: ModelManifest, modelId: string, enabled: boolean): ModelManifest {
  let enabledCount = manifest.enabledCount + (enabled ? 1 : -1)
  const providers = manifest.providers.map((section) => ({
    ...section,
    models: section.models.map((row) => {
      if (row.model.id !== modelId) return row
      if (row.enabled === enabled) return row
      return { ...row, enabled }
    })
  }))
  enabledCount = providers.reduce((sum, section) => sum + section.models.filter((row) => row.enabled).length, 0)
  return { ...manifest, providers, enabledCount }
}

/** Loads the model manifest while the Models tab is active and keeps it in sync with main-process events. */
export function useModelsController(active: boolean, api: ModelsApi | null | undefined): ModelsController {
  const [manifest, setManifest] = useState<ModelManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!api) {
      setError('Model settings are unavailable in this window.')
      return
    }
    try {
      setManifest(await api.manifest())
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught, 'Model settings could not be read.'))
    }
  }, [api])

  useEffect(() => {
    if (!active || !api) return
    let live = true
    void refresh()
    const unsubscribeModels = api.onEvent((event) => {
      if (!live) return
      if (event.type === 'enabled') {
        setManifest((current) => current ? withModelEnabled(current, event.modelId, event.enabled) : current)
        return
      }
      void refresh()
    })
    const unsubscribeChat = window.closedai?.chat.onEvent((event) => {
      if (!live) return
      if (event.type === 'pane' && event.event.type === 'connection') void refresh()
    })
    return () => {
      live = false
      unsubscribeModels()
      unsubscribeChat?.()
    }
  }, [active, api, refresh])

  const setEnabled = useCallback(async (modelId: string, enabled: boolean) => {
    if (!api) return
    setManifest((current) => current ? withModelEnabled(current, modelId, enabled) : current)
    try {
      await api.setEnabled(modelId, enabled)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
    }
  }, [api, refresh])

  const setEnabledMany = useCallback(async (switches: ModelSwitch[]) => {
    if (!api) return
    try {
      await api.setEnabledMany(switches)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
      return
    }
    await refresh()
  }, [api, refresh])

  return { manifest, error, refresh, setEnabled, setEnabledMany }
}
