export type PokerAction = { label: string; x: number; y: number; w: number; h: number }

export type TableSnapshot = {
  heroTurn: boolean
  actions: PokerAction[]
  holeCards: string[]
  board: string[]
  pot: string | number | null
  stack: string | number | null
  handId: string | null
}

export type PokerDecision = { action: 'fold' | 'check' | 'call' | 'raise'; reason: string }

const RANK = '23456789TJQKA'

function rank(card: string): number {
  const normalized = card.replace(/10/, 'T').replace(/[♣♦♥♠]/gi, '').trim().toUpperCase()
  const r = normalized.charAt(0)
  const index = RANK.indexOf(r)
  return index >= 0 ? index : -1
}

function suited(cards: string[]): boolean {
  if (cards.length < 2) return false
  const suits = cards.map((c) => c.slice(-1).toLowerCase())
  return suits[0] === suits[1]
}

function pairStrength(cards: string[]): number {
  if (cards.length < 2) return 0
  const a = rank(cards[0]!)
  const b = rank(cards[1]!)
  if (a < 0 || b < 0) return 0
  if (a === b) return a
  return -1
}

function pickAction(actions: PokerAction[], kind: PokerDecision['action']): PokerAction | null {
  const matchers: Record<PokerDecision['action'], RegExp> = {
    fold: /^Fold/i,
    check: /^Check/i,
    call: /^Call/i,
    raise: /^Raise|^Bet/i
  }
  return actions.find((action) => matchers[kind].test(action.label)) ?? null
}

/** ABC micro-stakes policy: tight preflop, fold weak made hands to pressure on scary boards. */
export function decide(snapshot: TableSnapshot): PokerDecision | null {
  if (!snapshot.heroTurn || snapshot.actions.length === 0) return null
  const fold = pickAction(snapshot.actions, 'fold')
  const check = pickAction(snapshot.actions, 'check')
  const call = pickAction(snapshot.actions, 'call')
  const raise = pickAction(snapshot.actions, 'raise')
  const hole = snapshot.holeCards
  const board = snapshot.board
  const preflop = board.length === 0
  const pair = pairStrength(hole)
  const premiumPair = pair >= RANK.indexOf('9')
  const suitedAce = hole.some((c) => rank(c) === RANK.indexOf('A')) && suited(hole)
  const broadway =
    hole.length === 2 &&
    hole.every((c) => rank(c) >= RANK.indexOf('T')) &&
    rank(hole[0]!) >= RANK.indexOf('J')

  if (preflop) {
    if (premiumPair || suitedAce || broadway) {
      if (raise) return { action: 'raise', reason: 'Premium preflop — raise for value' }
      if (call) return { action: 'call', reason: 'Premium preflop — call' }
      if (check) return { action: 'check', reason: 'Premium preflop — check' }
    }
    if (pair >= 0 && pair < RANK.indexOf('7')) {
      if (fold) return { action: 'fold', reason: 'Small pocket pair vs action — fold' }
    }
    if (call && !raise) {
      if (fold) return { action: 'fold', reason: 'Unknown/weak hand facing raise — fold' }
    }
    if (check) return { action: 'check', reason: 'Free check preflop' }
    if (fold) return { action: 'fold', reason: 'Default preflop fold' }
    return null
  }

  const monotoneClub =
    board.length >= 3 &&
    board.filter((c) => /[c♣]/i.test(c)).length >= 3
  const highCardOnly = pair < 0

  if (highCardOnly && monotoneClub) {
    if (fold) return { action: 'fold', reason: 'High card on monotone board — fold' }
  }
  if (highCardOnly && call) {
    if (fold) return { action: 'fold', reason: 'High card facing bet — fold' }
  }
  if (pair >= RANK.indexOf('T') && call) return { action: 'call', reason: 'Top pair+ — call' }
  if (check) return { action: 'check', reason: 'Take free card' }
  if (fold) return { action: 'fold', reason: 'Default postflop fold' }
  return null
}

export function actionTarget(snapshot: TableSnapshot, decision: PokerDecision): PokerAction | null {
  return pickAction(snapshot.actions, decision.action)
}
