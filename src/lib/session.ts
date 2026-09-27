/**
 * Focus sessions.
 *
 * A session is an *intensifier*, never a gate. Minutes on the habit's sites are
 * counted whether or not one is running — forty real minutes at midnight with
 * no session still fills the dot. That distinction is the whole reason this is
 * not another Pomodoro app, and the most-quoted complaint in the research says
 * why: "it turned into an extra task I needed to do in order to do other
 * tasks." **You can never lose a day by forgetting to press start.**
 *
 * What a session adds is a timer, an honest split of where the time went, and
 * the one moment the character exists for.
 */

export type Presence = 'on-task' | 'drift' | 'away'

export interface Session {
  startedAt: number
  durationMs: number
  onTaskMs: number
  driftMs: number
  awayMs: number
  /** Set when the session finished or was stopped; null while it runs. */
  endedAt: number | null
  /** True when it ran its full length rather than being stopped early. */
  completed: boolean
}

export const DEFAULT_SESSION_MINUTES = 25

export function startSession(now: number, minutes: number): Session {
  return {
    startedAt: now,
    durationMs: Math.max(1, minutes) * 60_000,
    onTaskMs: 0,
    driftMs: 0,
    awayMs: 0,
    endedAt: null,
    completed: false,
  }
}

/**
 * Where the user was during the interval that just ended.
 *
 * The three-way split matters. "Away" is not "drift": stepping out for coffee
 * is not the same as opening YouTube, and a session that called them the same
 * thing would be lying in the direction that makes people feel judged for
 * living their lives.
 *
 * `idle` is system-wide, so it means *nobody is at the machine at all*. If the
 * user is active but Chrome is not focused, they are doing something else on
 * the computer — which is drift, not absence.
 */
export function classifyPresence(opts: {
  key: string | null
  idle: boolean
  focused: boolean
}): Presence {
  if (opts.idle) return 'away'
  if (opts.focused && opts.key !== null) return 'on-task'
  return 'drift'
}

export function addToSession(session: Session, presence: Presence, ms: number): Session {
  if (ms <= 0 || session.endedAt !== null) return session
  return {
    ...session,
    onTaskMs: session.onTaskMs + (presence === 'on-task' ? ms : 0),
    driftMs: session.driftMs + (presence === 'drift' ? ms : 0),
    awayMs: session.awayMs + (presence === 'away' ? ms : 0),
  }
}

/** Milliseconds left on the clock; never negative. */
export function remaining(session: Session, now: number): number {
  return Math.max(0, session.startedAt + session.durationMs - now)
}

export function isOver(session: Session, now: number): boolean {
  return session.endedAt === null && remaining(session, now) === 0
}

export function endSession(session: Session, now: number): Session {
  if (session.endedAt !== null) return session
  return { ...session, endedAt: now, completed: remaining(session, now) === 0 }
}

/**
 * How the session reads back to the user.
 *
 * Both numbers, always, neither hidden. A session that quietly dropped the
 * drifted minutes would be the same flattery every other tracker offers, and
 * the entire claim of this product is that the number is true.
 */
export function summarise(session: Session): {
  totalMinutes: number
  onTaskMinutes: number
  driftMinutes: number
  awayMinutes: number
} {
  const floor = (ms: number) => Math.floor(ms / 60_000)
  return {
    totalMinutes: floor(session.onTaskMs + session.driftMs + session.awayMs),
    onTaskMinutes: floor(session.onTaskMs),
    driftMinutes: floor(session.driftMs),
    awayMinutes: floor(session.awayMs),
  }
}
