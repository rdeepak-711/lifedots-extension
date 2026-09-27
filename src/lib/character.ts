/**
 * When the character is allowed to speak.
 *
 * Rationing is the product, not a setting. The research is unambiguous that an
 * interruption people cannot escape is the top cause of one-star reviews on
 * free extensions, and that novelty decays fastest for whatever appears most.
 * So he appears rarely, and only when something is actually true.
 *
 * The distinction that makes the rules coherent:
 *
 *   **Asked-for** — you started a session, which is an explicit request to be
 *   watched. Him speaking during one is the thing you asked for, so it is
 *   capped per session rather than per week.
 *
 *   **Unprompted** — he decided to speak. Nobody asked. Held to a hard weekly
 *   ceiling, because this is the category of thing people uninstall to escape.
 */

import type { Trigger } from './lines'
import { localDayKey } from './time'

export interface Appearance {
  at: number
  trigger: Trigger
}

/** Triggers that only fire because the user opened a session. */
const ASKED_FOR: ReadonlySet<Trigger> = new Set<Trigger>([
  'drift',
  'session-clean',
  'session-mixed',
])

/** Nobody asked for these. They are the ones that can become a nuisance. */
const UNPROMPTED: ReadonlySet<Trigger> = new Set<Trigger>(['day-nearly-gone', 'comeback'])

export const MAX_UNPROMPTED_PER_WEEK = 3
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Drifted this long inside a session before he says anything. */
export const DRIFT_GRACE_MS = 45_000

export function canSpeak(opts: {
  trigger: Trigger
  history: readonly Appearance[]
  now: number
  sessionStartedAt: number | null
}): boolean {
  const { trigger, history, now, sessionStartedAt } = opts

  if (ASKED_FOR.has(trigger)) {
    // Once per session, so a session with five wanders gets one remark, not five.
    if (sessionStartedAt === null) return false
    return !history.some((a) => a.trigger === trigger && a.at >= sessionStartedAt)
  }

  const today = localDayKey(now)
  const spokeToday = history.filter((a) => localDayKey(a.at) === today)

  if (trigger === 'dot-filled') {
    // Earned, and only possible once a day anyway.
    return !spokeToday.some((a) => a.trigger === 'dot-filled')
  }

  if (UNPROMPTED.has(trigger)) {
    // At most one unprompted remark a day…
    if (spokeToday.some((a) => UNPROMPTED.has(a.trigger))) return false
    // …and a hard ceiling across the week.
    const thisWeek = history.filter((a) => UNPROMPTED.has(a.trigger) && now - a.at < WEEK_MS)
    return thisWeek.length < MAX_UNPROMPTED_PER_WEEK
  }

  return false
}

/** Keep the history small; only the last week can affect any decision. */
export function pruneHistory(history: readonly Appearance[], now: number): Appearance[] {
  return history.filter((a) => now - a.at < WEEK_MS)
}
