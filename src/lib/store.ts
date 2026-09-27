/**
 * Everything that must survive the service worker being killed.
 *
 * MV3 terminates the worker whenever it likes, so no counted time may live in
 * a module variable. Every handler reads from here, computes, and writes back
 * before it can be shut down. This file is the only place that talks to
 * chrome.storage, so that rule is enforceable by reading one file.
 */

import type { Appearance } from './character'
import type { Session } from './session'
import type { DayMillis, TrackerState } from './time'

const KEY = {
  state: 'ld:state',
  days: 'ld:days',
  probe: 'ld:probe',
  log: 'ld:log',
  painted: 'ld:painted',
  ignored: 'ld:ignored',
  draft: 'ld:draft',
  session: 'ld:session',
  appearances: 'ld:appearances',
  lastLine: 'ld:lastline',
} as const

/** Tracker state plus whether the browser itself has focus. */
export interface StoredState extends TrackerState {
  focused: boolean
}

/**
 * Counters that answer the question step 05 left open: does
 * chrome.tabs.onActivated fire when the extension has no `tabs` permission?
 *
 * The whole one-line install dialog rests on the answer, so v0 records it
 * rather than assuming it, and the popup shows the verdict.
 */
export interface Probe {
  onActivated: number
  onUpdated: number
  onFocus: number
  onIdle: number
  onAlarm: number
  /** Times the active tab's address was readable — i.e. a site we may see. */
  urlSeen: number
  /** Times it was not. On an unnamed site this is the expected, correct case. */
  urlHidden: number
  lastError: string | null
}

export interface LogLine {
  at: number
  reason: string
  key: string | null
  creditedMs: number
}

const EMPTY_PROBE: Probe = {
  onActivated: 0,
  onUpdated: 0,
  onFocus: 0,
  onIdle: 0,
  onAlarm: 0,
  urlSeen: 0,
  urlHidden: 0,
  lastError: null,
}

const LOG_LIMIT = 40

export async function loadState(now: number): Promise<StoredState> {
  const got = await chrome.storage.local.get(KEY.state)
  const stored = got[KEY.state] as Partial<StoredState> | undefined
  return {
    key: stored?.key ?? null,
    since: typeof stored?.since === 'number' ? stored.since : now,
    idle: stored?.idle ?? false,
    focused: stored?.focused ?? true,
  }
}

export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [KEY.state]: state })
}

export async function loadDays(): Promise<DayMillis> {
  const got = await chrome.storage.local.get(KEY.days)
  return (got[KEY.days] as DayMillis | undefined) ?? {}
}

export async function saveDays(days: DayMillis): Promise<void> {
  await chrome.storage.local.set({ [KEY.days]: days })
}

export async function loadProbe(): Promise<Probe> {
  const got = await chrome.storage.local.get(KEY.probe)
  return { ...EMPTY_PROBE, ...((got[KEY.probe] as Partial<Probe> | undefined) ?? {}) }
}

export async function bumpProbe(patch: Partial<Probe>): Promise<void> {
  const current = await loadProbe()
  const next: Probe = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'number') {
      next[k as keyof Probe] = ((current[k as keyof Probe] as number) + v) as never
    } else {
      next[k as keyof Probe] = v as never
    }
  }
  await chrome.storage.local.set({ [KEY.probe]: next })
}

export async function loadLog(): Promise<LogLine[]> {
  const got = await chrome.storage.local.get(KEY.log)
  return (got[KEY.log] as LogLine[] | undefined) ?? []
}

/** Keeps only the most recent lines — this is a debugging aid, not a record. */
export async function appendLog(line: LogLine): Promise<void> {
  const log = await loadLog()
  log.push(line)
  await chrome.storage.local.set({ [KEY.log]: log.slice(-LOG_LIMIT) })
}

/**
 * What the toolbar icon is currently showing.
 *
 * Kept so the icon is only repainted when it would actually change. Calling
 * chrome.action.setIcon() while the user is clicking the icon can swallow the
 * click and stop the popup opening — so a repaint on every tick is not merely
 * wasteful, it makes the extension feel broken.
 */
export interface Painted {
  fill: number
  minutes: number
}

export async function loadPainted(): Promise<Painted | null> {
  const got = await chrome.storage.local.get(KEY.painted)
  return (got[KEY.painted] as Painted | undefined) ?? null
}

export async function savePainted(painted: Painted): Promise<void> {
  await chrome.storage.local.set({ [KEY.painted]: painted })
}

/**
 * Sites the user has said no to.
 *
 * Without this, the popup offers to count Gmail as system-design work every
 * time you check your progress from a Gmail tab. Once dismissed, a site is
 * never suggested again — so the offer decays to silence for everything you
 * normally browse, and only appears for somewhere genuinely new.
 */
export async function loadIgnored(): Promise<string[]> {
  const got = await chrome.storage.local.get(KEY.ignored)
  const list = got[KEY.ignored] as unknown
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
}

export async function ignoreSite(site: string): Promise<void> {
  const list = await loadIgnored()
  if (!list.includes(site)) list.push(site)
  await chrome.storage.local.set({ [KEY.ignored]: list })
}

/**
 * A half-finished setup, saved as it is typed.
 *
 * This is not a nicety. `chrome.permissions.request()` opens a dialog that
 * takes focus, and **a popup is destroyed the moment it loses focus** — so
 * adding the very first site tears down the page the user is filling in. With
 * the draft only in a variable, the habit name and every site added so far
 * vanished, and reopening showed an empty form. It looked like the extension
 * had forgotten everything, because it had.
 */
export interface Draft {
  habit: string
  sites: string[]
  targetMinutes: number
}

export async function loadDraft(): Promise<Draft | null> {
  const got = await chrome.storage.local.get(KEY.draft)
  const raw = got[KEY.draft] as Partial<Draft> | undefined
  if (!raw) return null
  return {
    habit: typeof raw.habit === 'string' ? raw.habit : '',
    sites: Array.isArray(raw.sites) ? raw.sites.filter((s): s is string => typeof s === 'string') : [],
    targetMinutes: typeof raw.targetMinutes === 'number' ? raw.targetMinutes : 25,
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  await chrome.storage.local.set({ [KEY.draft]: draft })
}

export async function clearDraft(): Promise<void> {
  await chrome.storage.local.remove(KEY.draft)
}

/** The session in progress, or the last one that finished. */
export async function loadSession(): Promise<Session | null> {
  const got = await chrome.storage.local.get(KEY.session)
  return (got[KEY.session] as Session | undefined) ?? null
}

export async function saveSession(session: Session): Promise<void> {
  await chrome.storage.local.set({ [KEY.session]: session })
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(KEY.session)
}

/** When the character last spoke, and about what. Drives the rationing. */
export async function loadAppearances(): Promise<Appearance[]> {
  const got = await chrome.storage.local.get(KEY.appearances)
  const list = got[KEY.appearances] as Appearance[] | undefined
  return Array.isArray(list) ? list : []
}

export async function saveAppearances(list: readonly Appearance[]): Promise<void> {
  await chrome.storage.local.set({ [KEY.appearances]: list })
}

/** The last thing he said, so he does not say it twice running. */
export async function loadLastLine(): Promise<string | null> {
  const got = await chrome.storage.local.get(KEY.lastLine)
  const line = got[KEY.lastLine]
  return typeof line === 'string' ? line : null
}

export async function saveLastLine(line: string): Promise<void> {
  await chrome.storage.local.set({ [KEY.lastLine]: line })
}

export const STORAGE_KEYS = KEY
