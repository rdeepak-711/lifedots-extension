/**
 * The counting rules. Pure functions, no chrome APIs, no clock of their own —
 * every one takes `now` as an argument so the tests can be about behaviour
 * rather than about timing.
 *
 * This file is where the product actually lives. Everything else is wiring.
 */

/** A local calendar day, `YYYY-MM-DD`. Local on purpose — see below. */
export type DayKey = string

/** Milliseconds counted against each local day. */
export type DayMillis = Record<DayKey, number>

/**
 * Never credit more than this for a single gap between events.
 *
 * The service worker can be terminated, the laptop can sleep, and a window can
 * sit unfocused for hours. When the next event finally arrives the naive
 * elapsed time might be six hours, none of which was work.
 *
 * The number is deliberately generous. A tick alarm runs every minute, so a
 * healthy gap is about 60 seconds — but Chrome throttles alarms for background
 * work and a legitimate gap can stretch. The two errors are not equal:
 *
 *   - Crediting five minutes of sleep, once, on wake: invisible.
 *   - Discarding a real minute the user worked: the single most rage-inducing
 *     failure in the whole review corpus — "it reset although I did the habit".
 *
 * So the cap is set well above normal jitter and errs toward believing the
 * user. Idle detection, not this number, is the real defence against counting
 * time nobody spent.
 */
export const MAX_GAP_MS = 5 * 60 * 1000

export interface TrackerState {
  /** The habit site pattern currently in front, or null when it isn't. */
  key: string | null
  /** When that started — the timestamp the next accrual measures from. */
  since: number
  /** True when the user has stopped touching the keyboard and mouse. */
  idle: boolean
}

/**
 * The day a moment belongs to, in the user's own timezone.
 *
 * Deliberately local rather than UTC. A dot is a claim about the user's day,
 * and someone in Chennai finishing at 11pm has not earned tomorrow's dot. The
 * research has a one-star review titled "Discouraging report" caused by exactly
 * this class of bug, and another from someone whose streak died because a
 * timezone shifted while they travelled.
 */
export function localDayKey(ms: number): DayKey {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** The next local midnight strictly after `ms`. */
export function startOfNextLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/**
 * Does this address belong to the habit? Returns the pattern that matched, so
 * the caller can record *which* site the time went to, or null.
 *
 * A pattern is either a bare host (`leetcode.com`, which also matches its
 * subdomains) or a host with a path prefix (`github.com/donnemartin`).
 *
 * A url of `undefined` returns null, and that is the normal case rather than an
 * error: on any site the extension has no host permission for, Chrome simply
 * does not populate the address. "Not on the work" is all we ever need to know.
 */
export function matchHabit(url: string | undefined, patterns: readonly string[]): string | null {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.replace(/^www\./, '')
  const hostAndPath = host + parsed.pathname

  for (const raw of patterns) {
    const pattern = raw.replace(/^www\./, '').replace(/\/$/, '')
    if (!pattern) continue
    if (pattern.includes('/')) {
      if (hostAndPath.startsWith(pattern)) return raw
    } else if (host === pattern || host.endsWith('.' + pattern)) {
      return raw
    }
  }
  return null
}

export interface AccrualResult {
  days: DayMillis
  /** How much was actually credited, after clamping. */
  creditedMs: number
  /** How much was thrown away because the gap was too long to trust. */
  discardedMs: number
}

/**
 * Add the time between `state.since` and `now` to the right day.
 *
 * Two things make this less trivial than it looks:
 *
 *  1. A stretch of time can cross local midnight, and the minutes on each side
 *     belong to different dots. So it is split at the boundary rather than
 *     dumped into whichever day happens to be current.
 *  2. Gaps longer than MAX_GAP_MS are not trusted, and the excess is discarded.
 */
export function accrue(
  state: TrackerState,
  days: DayMillis,
  now: number,
  maxGapMs: number = MAX_GAP_MS,
): AccrualResult {
  const out: DayMillis = { ...days }

  const counting = state.key !== null && !state.idle
  if (!counting || now <= state.since) {
    return { days: out, creditedMs: 0, discardedMs: 0 }
  }

  const elapsed = now - state.since
  const discarded = Math.max(0, elapsed - maxGapMs)
  let cursor = now - Math.min(elapsed, maxGapMs)
  let credited = 0

  while (cursor < now) {
    const boundary = Math.min(startOfNextLocalDay(cursor), now)
    if (boundary <= cursor) break // guard: never loop without advancing
    const key = localDayKey(cursor)
    out[key] = (out[key] ?? 0) + (boundary - cursor)
    credited += boundary - cursor
    cursor = boundary
  }

  return { days: out, creditedMs: credited, discardedMs: discarded }
}

/** Which of the five icon states the day has reached. */
export type FillState = 0 | 25 | 50 | 75 | 100

export function fillState(msToday: number, targetMinutes: number): FillState {
  if (targetMinutes <= 0) return 100
  const ratio = msToday / (targetMinutes * 60_000)
  if (ratio >= 1) return 100
  if (ratio >= 0.75) return 75
  if (ratio >= 0.5) return 50
  if (ratio >= 0.25) return 25
  return 0
}

/** Whole minutes, rounded down — never show 25/25 before the dot has filled. */
export function minutes(ms: number): number {
  return Math.floor(ms / 60_000)
}

export interface WeekCell {
  day: DayKey
  ms: number
  isToday: boolean
  isFuture: boolean
}

/**
 * Last week and this week, laid out Monday to Sunday.
 *
 * Weekday-aligned rather than a rolling fortnight, for a specific reason from
 * the research: someone who rests every Sunday should see a *pattern*, not a
 * failure. The loudest version of that complaint —
 *
 *   "streaks only work for everyday habits. As I take Sundays off, my maximum
 *    streak is capped at 6, even if I do everything perfectly all year… my
 *    perfect week always appears to end in failure."
 *
 * — is impossible to express in a rolling window and obvious in this one. It
 * also shows the current week as partly unwritten rather than as a fixed run of
 * dots, which is a truer picture of a week you are still in.
 */
export function twoWeeks(days: DayMillis, now: number): WeekCell[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  // getDay() is 0 for Sunday; we want 0 for Monday.
  const mondayOffset = (today.getDay() + 6) % 7

  const start = new Date(today)
  start.setDate(start.getDate() - mondayOffset - 7)

  const todayKey = localDayKey(now)
  const cells: WeekCell[] = []

  for (let i = 0; i < 14; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = localDayKey(d.getTime())
    cells.push({
      day: key,
      ms: days[key] ?? 0,
      isToday: key === todayKey,
      isFuture: d.getTime() > today.getTime(),
    })
  }
  return cells
}

export interface YearCell {
  /** null for the padding cells that sit outside the year. */
  day: DayKey | null
  ms: number
  isToday: boolean
  isFuture: boolean
}

export interface YearGrid {
  year: number
  /** Weeks running Monday to Sunday, left to right across the year. */
  weeks: YearCell[][]
  /** Days that reached the target. */
  filled: number
  /** Days of the year still ahead, today excluded. */
  remaining: number
  totalMs: number
}

/**
 * The whole year, as weeks of seven.
 *
 * This is the view the product is named after. It exists to make one thing
 * visible that no other tracker shows: **the filled days are permanent.** A bad
 * fortnight is a gap in a long run, not a counter at zero — and you can only
 * see that if you can see the run.
 *
 * Deliberately no streak anywhere in here. The longest-run number is the single
 * most abandonment-inducing statistic in the research, and computing it would
 * be one line away from displaying it.
 */
export function yearGrid(days: DayMillis, now: number, targetMinutes: number): YearGrid {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const year = today.getFullYear()
  const todayKey = localDayKey(now)
  const targetMs = targetMinutes * 60_000

  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)

  // Back up to the Monday on or before 1 January, so every column is a week.
  const cursor = new Date(jan1)
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))

  const weeks: YearCell[][] = []
  let filled = 0
  let totalMs = 0
  let remaining = 0

  while (cursor <= dec31 || weeks.length === 0 || weeks[weeks.length - 1]!.length < 7) {
    if (weeks.length === 0 || weeks[weeks.length - 1]!.length === 7) weeks.push([])
    const week = weeks[weeks.length - 1]!

    const inYear = cursor.getFullYear() === year
    if (!inYear) {
      week.push({ day: null, ms: 0, isToday: false, isFuture: false })
    } else {
      const key = localDayKey(cursor.getTime())
      const ms = days[key] ?? 0
      const isFuture = cursor.getTime() > today.getTime()
      if (ms >= targetMs) filled += 1
      totalMs += ms
      if (isFuture) remaining += 1
      week.push({ day: key, ms, isToday: key === todayKey, isFuture })
    }

    cursor.setDate(cursor.getDate() + 1)
    if (cursor > dec31 && weeks[weeks.length - 1]!.length === 7) break
  }

  return { year, weeks, filled, remaining, totalMs }
}
