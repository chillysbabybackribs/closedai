// Every screenshot is replayed to the model on every later call of the thread, and a turn of
// UI work has been observed taking 16 of them. Guidance alone did not hold the count down, so
// the tool enforces a per-turn ceiling: past it, capture actions fail with advice to verify by
// reading page state instead. The count resets when the app-server starts a new turn.

export const DEFAULT_MAX_CAPTURES_PER_TURN = 8

export type CaptureBudgetUse = {
  allowed: boolean
  /** Images already produced this turn, including this one when allowed. */
  used: number
  remaining: number
}

export class CaptureBudget {
  private turnId: string | null = null
  private used = 0

  constructor(readonly maxPerTurn = DEFAULT_MAX_CAPTURES_PER_TURN) {}

  /** Claim one image for the turn; the claim stands even if the capture then fails. */
  use(turnId: string | null): CaptureBudgetUse {
    if (turnId !== this.turnId) {
      this.turnId = turnId
      this.used = 0
    }
    if (this.used >= this.maxPerTurn) return { allowed: false, used: this.used, remaining: 0 }
    this.used += 1
    return { allowed: true, used: this.used, remaining: this.maxPerTurn - this.used }
  }
}
