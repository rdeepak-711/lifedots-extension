/**
 * LifeDots — the stopwatch.
 *
 * The rule the whole file obeys: **nothing important lives in a variable.**
 * MV3 terminates this worker whenever it likes, often seconds after it wakes,
 * so every handler reads state from storage, computes, and writes it back
 * before it can be shut down. A module-level `let minutesToday` would silently
 * lose time and the loss would be invisible until someone noticed their dot
 * was wrong — which, per the research, is the failure people never forgive.
 *
 * How time is counted: storage holds *what is happening now* (`key`, `since`),
 * not a running total. On every event the interval that just ended is banked
 * against the correct local day, then a new interval begins. A one-minute
 * alarm guarantees the interval never grows large even if the user sits
 * perfectly still on one page.
 */

import { DEFAULT_TARGET_MINUTES, IDLE_SECONDS, TICK_MINUTES, loadConfig } from './lib/config'
import {
  MAX_GAP_MS,
  accrue,
  fillState,
  localDayKey,
  matchHabit,
  minutes,
  type DayMillis,
} from './lib/time'
import { addToSession, classifyPresence, endSession, isOver } from './lib/session'
import { DRIFT_GRACE_MS, canSpeak, pruneHistory, type Appearance } from './lib/character'
import { pickLine, type Trigger } from './lib/lines'
import {
  appendLog,
  bumpProbe,
  loadAppearances,
  loadDays,
  loadLastLine,
  loadPainted,
  loadSession,
  loadState,
  saveAppearances,
  saveDays,
  saveLastLine,
  savePainted,
  saveSession,
  saveState,
  type StoredState,
} from './lib/store'

const TICK_ALARM = 'ld:tick'

/**
 * What is in front of the user right now.
 *
 * `tab.url` is populated only for sites we hold a host permission for. On
 * anything else it comes back undefined — which is not an error and not a
 * problem: "not on the work" is the only fact the stopwatch needs, and being
 * unable to see the rest of someone's browsing is the point.
 */
async function readActiveTab(
  sites: readonly string[],
): Promise<{ key: string | null; sawUrl: boolean }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const url = tabs[0]?.url
    return { key: matchHabit(url, sites), sawUrl: typeof url === 'string' && url.length > 0 }
  } catch (err) {
    await bumpProbe({ lastError: String(err) })
    return { key: null, sawUrl: false }
  }
}

/**
 * Repaint the toolbar icon — but only when it would actually look different.
 *
 * This ran on every tick in the first version, and that was a real bug with a
 * misleading symptom: the popup needed several clicks to open. Opening the
 * popup blurs the window, the blur fires a tick, the tick called setIcon, and
 * **a setIcon call landing while the user is clicking the action can swallow
 * the click**. So the extension felt broken in a way that had nothing to do
 * with the thing it appeared to be about.
 *
 * Painting only on change takes it from every tick to a handful a day.
 */
async function paintIcon(days: DayMillis, now: number, target: number, habit: string): Promise<void> {
  const today = days[localDayKey(now)] ?? 0
  const fill = fillState(today, target)
  const mins = minutes(today)

  const painted = await loadPainted()
  if (painted && painted.fill === fill && painted.minutes === mins) return

  if (!painted || painted.fill !== fill) {
    await chrome.action.setIcon({
      path: {
        16: `icons/dot-${fill}-16.png`,
        32: `icons/dot-${fill}-32.png`,
        48: `icons/dot-${fill}-48.png`,
        128: `icons/dot-${fill}-128.png`,
      },
    })
  }
  await chrome.action.setTitle({ title: `${habit} — ${mins}/${target} min today` })
  await savePainted({ fill, minutes: mins })
}

/**
 * Bank the interval that just ended, then start a new one.
 *
 * `overrides` carry the fact the triggering event knows and storage does not
 * yet — that the window just lost focus, or that the user just went idle.
 */
async function tick(
  reason: string,
  overrides: Partial<Pick<StoredState, 'focused' | 'idle'>> = {},
): Promise<void> {
  const now = Date.now()

  const config = await loadConfig()
  const previous = await loadState(now)
  const days = await loadDays()

  // Bank using the state as it was *during* the interval, not as it is now.
  const banked = accrue(previous, days, now)

  const focused = overrides.focused ?? previous.focused
  const idle = overrides.idle ?? previous.idle

  // No habit yet means nothing to count — setup has not happened.
  let key: string | null = null
  if (config && focused && !idle) {
    const active = await readActiveTab(config.sites)
    key = active.key
    await bumpProbe(active.sawUrl ? { urlSeen: 1 } : { urlHidden: 1 })
  }

  await saveDays(banked.days)
  await saveState({ key, since: now, idle, focused })
  await updateSession(previous, now)
  await paintIcon(
    banked.days,
    now,
    config?.targetMinutes ?? DEFAULT_TARGET_MINUTES,
    config?.habit ?? 'LifeDots',
  )

  // Crossing the day's target, once, the moment it happens.
  if (config) {
    const target = config.targetMinutes * 60_000
    const before = days[localDayKey(now)] ?? 0
    const after = banked.days[localDayKey(now)] ?? 0
    if (before < target && after >= target) {
      const session = await loadSession()
      await speak('dot-filled', session && session.endedAt === null ? session.startedAt : null)
    }
  }

  if (banked.creditedMs > 0 || previous.key !== key) {
    await appendLog({ at: now, reason, key, creditedMs: banked.creditedMs })
  }
}

/**
 * Say one thing, if the rationing allows it.
 *
 * Delivered as a system notification rather than drawn on the page, because the
 * extension holds no permission for wherever the user drifted to — and cannot
 * even see which site it is. That constraint turns out to be a feature: he says
 * "you're not on the work" because that is genuinely all he knows.
 */
async function speak(trigger: Trigger, sessionStartedAt: number | null): Promise<void> {
  const now = Date.now()
  const history = await loadAppearances()

  if (!canSpeak({ trigger, history, now, sessionStartedAt })) return

  const lastLine = await loadLastLine()
  const line = pickLine(trigger, lastLine, Math.random())

  try {
    await chrome.notifications.create(`ld:${trigger}:${now}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/dot-100-128.png'),
      title: 'LifeDots',
      message: line,
      priority: 0,
      silent: true,
    })
  } catch (err) {
    await bumpProbe({ lastError: String(err) })
    return
  }

  const next: Appearance[] = pruneHistory([...history, { at: now, trigger }], now)
  await saveAppearances(next)
  await saveLastLine(line)
}

/**
 * Move a running session forward by the interval that just ended.
 *
 * Uses the state as it was *during* the interval, same as the day's accrual —
 * and clamps to the session's own start, so a tick that straddles the moment
 * the user pressed start cannot credit time from before the session existed.
 */
async function updateSession(previous: StoredState, now: number): Promise<void> {
  const session = await loadSession()
  if (!session || session.endedAt !== null) return

  const elapsed = Math.max(0, now - previous.since)
  const sinceStart = Math.max(0, now - session.startedAt)
  const effective = Math.min(elapsed, MAX_GAP_MS, sinceStart)

  const presence = classifyPresence({
    key: previous.key,
    idle: previous.idle,
    focused: previous.focused,
  })

  let next = addToSession(session, presence, effective)

  const justFinished = isOver(next, now)
  if (justFinished) next = endSession(next, now)
  await saveSession(next)

  if (justFinished) {
    // Clean means every counted minute was the work — away time is not a sin.
    await speak(next.driftMs === 0 ? 'session-clean' : 'session-mixed', next.startedAt)
    return
  }

  // A grace period, so glancing at another tab for five seconds does not summon
  // him. He is a witness, not a hair trigger.
  if (presence === 'drift' && next.driftMs >= DRIFT_GRACE_MS) {
    await speak('drift', next.startedAt)
  }
}

async function ensureSchedule(): Promise<void> {
  chrome.idle.setDetectionInterval(IDLE_SECONDS)
  const existing = await chrome.alarms.get(TICK_ALARM)
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES })
  }
}

/**
 * Run on *every* worker start, not only on install.
 *
 * The first version of this called ensureSchedule() from onInstalled and
 * onStartup alone — which is wrong, and in a way that fails silently. MV3
 * restarts this worker constantly while those two events fire almost never, so
 * if the alarm were ever missing nothing would recreate it. Time would then
 * accrue only on tab switches, and sitting still on one page would count
 * nothing at all: the stopwatch would appear to work and quietly undercount,
 * which is the exact failure this product cannot afford.
 *
 * Alarms survive worker death, so this is usually a no-op. It costs nothing and
 * removes a whole class of invisible breakage.
 */
void ensureSchedule()

/* ---------------------------------------------------------------------------
 * Listeners. These must be registered synchronously at the top level: the
 * worker is woken *by* an event, so a listener added inside an async callback
 * would not exist yet when the event that woke it is delivered.
 * ------------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureSchedule()
    await tick('installed')
  })()
})

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureSchedule()
    await tick('startup')
  })()
})

chrome.tabs.onActivated.addListener(() => {
  void (async () => {
    await bumpProbe({ onActivated: 1 })
    await tick('tab-activated')
  })()
})

chrome.tabs.onUpdated.addListener((_tabId, change) => {
  // Only when the address actually changed — onUpdated also fires for favicons,
  // titles and loading states, none of which move the stopwatch.
  if (!change.url) return
  void (async () => {
    await bumpProbe({ onUpdated: 1 })
    await tick('tab-updated')
  })()
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  const focused = windowId !== chrome.windows.WINDOW_ID_NONE
  void (async () => {
    await bumpProbe({ onFocus: 1 })
    await tick(focused ? 'window-focused' : 'window-blurred', { focused })
  })()
})

chrome.idle.onStateChanged.addListener((state) => {
  // 'idle' and 'locked' both mean nobody is there.
  const idle = state !== 'active'
  void (async () => {
    await bumpProbe({ onIdle: 1 })
    await tick(idle ? 'went-idle' : 'came-back', { idle })
  })()
})

chrome.permissions.onAdded.addListener(() => {
  void tick('permission-granted')
})

chrome.permissions.onRemoved.addListener(() => {
  void tick('permission-removed')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return
  void (async () => {
    await bumpProbe({ onAlarm: 1 })
    await tick('alarm')
  })()
})

export {}
