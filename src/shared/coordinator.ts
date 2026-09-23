/** Links a coordinator pane with up to two worker panes in one mission group. */
export type CoordinatorGroup = {
  id: string
  role: 'coordinator' | 'worker'
  /** Worker slot; null on the coordinator pane. */
  slot: 'a' | 'b' | null
}

export type EnableCoordinatorResult = {
  groupId: string
  coordinatorPaneId: string
  workerPaneIds: [string, string]
}

/** Coordinator + Worker chat ids for the dedicated crew pair; layout is ordinary pane docking. */
export type OpenCoordinatorWorkspaceResult = {
  groupId: string
  coordinatorPaneId: string
  workerPaneId: string
}
