/**
 * LifeDots — popup.
 *
 * Two modes: setup when there is no habit yet, and the running view when there
 * is. The popup is destroyed the moment it closes, so it keeps no state of its
 * own and reads storage each time it opens.
 *
 * One hard constraint shapes this file: `chrome.permissions.request()` only
 * works inside a real user gesture. So every permission ask happens directly in
 * a click handler — never after an `await` that could break the gesture chain.
 */

import {
  DEFAULT_TARGET_MINUTES,
  loadConfig,
  saveConfig,
  type HabitConfig,
} from '../lib/config'
import { dropPermission, hasPermission, normaliseSite, originPatterns, requestPermission } from '../lib/permissions'
import { MAX_GAP_MS, localDayKey, matchHabit, minutes, twoWeeks } from '../lib/time'
import {
  DEFAULT_SESSION_MINUTES,
  endSession,
  remaining,
  startSession,
  summarise,
  type Session,
} from '../lib/session'
import {
  clearDraft,
  clearSession,
  ignoreSite,
  loadDays,
  loadDraft,
  loadIgnored,
  loadLog,
  loadProbe,
  loadSession,
  loadState,
  saveDraft,
  saveSession,
  type LogLine,
} from '../lib/store'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** Sites being assembled in setup, before they are saved. */
let draftSites: string[] = []

/**
 * Write the half-finished form to storage.
 *
 * Called on every change rather than only on submit, because asking Chrome for
 * a site permission closes this popup and destroys everything in it.
 */
function persistDraft(): void {
  void saveDraft({
    habit: $<HTMLInputElement>('habit-input').value,
    sites: [...draftSites],
    targetMinutes: Number($<HTMLInputElement>('target-input').value) || DEFAULT_TARGET_MINUTES,
  })
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function show(mode: 'setup' | 'running'): void {
  $('setup').hidden = mode !== 'setup'
  $('running').hidden = mode !== 'running'
}

/* ------------------------------------------------------------------ setup */

async function renderSiteList(): Promise<void> {
  const list = $<HTMLUListElement>('sitelist')
  list.innerHTML = ''

  for (const site of draftSites) {
    const li = document.createElement('li')

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = site

    const granted = await hasPermission(site)
    const status = document.createElement('span')
    if (granted) {
      status.className = 'ok'
      status.textContent = 'allowed'
    } else {
      status.className = 'warn'
      status.textContent = 'allow…'
      // Direct click handler: the permission ask must be inside the gesture.
      status.addEventListener('click', () => {
        void requestPermission(site).then(() => renderSiteList())
      })
    }

    const remove = document.createElement('button')
    remove.className = 'rm'
    remove.type = 'button'
    remove.textContent = '×'
    remove.title = `Remove ${site}`
    remove.addEventListener('click', () => {
      draftSites = draftSites.filter((s) => s !== site)
      void dropPermission(site)
      persistDraft()
      void renderSiteList()
      refreshStartButton()
    })

    li.append(name, status, remove)
    list.appendChild(li)
  }

  refreshStartButton()
}

function refreshStartButton(): void {
  const habit = $<HTMLInputElement>('habit-input').value.trim()
  $<HTMLButtonElement>('start').disabled = habit.length === 0 || draftSites.length === 0
}

function addSiteFromInput(): void {
  const input = $<HTMLInputElement>('site-input')
  const hint = $('site-hint')
  const site = normaliseSite(input.value)

  if (originPatterns(site).length === 0) {
    hint.className = 'hint bad'
    hint.textContent = `"${input.value.trim()}" is not an address Chrome will accept. Try leetcode.com.`
    return
  }
  if (draftSites.includes(site)) {
    hint.className = 'hint bad'
    hint.textContent = `${site} is already on the list.`
    return
  }

  hint.className = 'hint'
  hint.innerHTML =
    'A bare address covers its subdomains. Add a path to narrow it — <code>github.com/yourname</code>.'

  draftSites.push(site)
  input.value = ''

  // The permission ask must come first: it needs the click gesture still to be
  // live, and it will close this popup. Everything typed so far is already on
  // disk by now, and persisting again here covers the site just added.
  void requestPermission(site).then(() => renderSiteList())
  persistDraft()
}

async function openSetup(existing: HabitConfig | null): Promise<void> {
  // A saved config wins; otherwise pick up whatever was being typed when the
  // permission dialog closed the popup last time.
  const draft = existing ? null : await loadDraft()

  draftSites = existing ? [...existing.sites] : (draft?.sites ?? [])
  $<HTMLInputElement>('habit-input').value = existing?.habit ?? draft?.habit ?? ''
  $<HTMLInputElement>('target-input').value = String(
    existing?.targetMinutes ?? draft?.targetMinutes ?? DEFAULT_TARGET_MINUTES,
  )
  $('setupmode').textContent = existing ? 'edit' : 'setup'
  $<HTMLButtonElement>('cancel-edit').hidden = !existing
  stopLive()
  await renderSiteList()
  show('setup')
  $<HTMLInputElement>('habit-input').focus()
}

/* ------------------------------------------------------- one-click add */

/**
 * The site in front of you, if it is not already being counted.
 *
 * This is the answer to the real hole in naming sites in advance: when you are
 * *learning*, you do not know where the work will happen — you google something
 * and land on a blog you have never seen. A list written in advance
 * structurally cannot contain it.
 *
 * `activeTab` gives the address of this one tab, only because the user just
 * clicked the icon, and **costs no install warning at all**. So the list builds
 * itself as you discover things, without the extension ever gaining the ability
 * to watch your browsing.
 */
async function suggestCurrentSite(config: HabitConfig): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = tabs[0]?.url
    if (!url) return null

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (matchHabit(url, config.sites)) return null // already counted

    const site = normaliseSite(parsed.hostname)
    if (originPatterns(site).length === 0) return null

    // Asked about once and turned down is an answer. Do not ask again.
    const ignored = await loadIgnored()
    return ignored.includes(site) ? null : site
  } catch {
    return null
  }
}

/* ------------------------------------------------------------ live clock */

let liveTimer: ReturnType<typeof setInterval> | undefined

function stopLive(): void {
  if (liveTimer !== undefined) {
    clearInterval(liveTimer)
    liveTimer = undefined
  }
}

/** `24:31` — a countdown, so it reads as time left rather than time spent. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** `1m 07s`, or just `7s` below a minute. */
function human(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/**
 * The number on screen, once a second.
 *
 * Storage holds only what has been *banked*. The background banks on events and
 * on a one-minute alarm, so between ticks the stored total is up to a minute
 * behind — which reads as a stopped clock, and a stopwatch that looks stopped
 * is a stopwatch nobody trusts.
 *
 * So the live figure is the banked total plus the interval currently in
 * progress, clamped by the same MAX_GAP_MS the banking uses. Showing a larger
 * number here than the one that will eventually be stored would be its own
 * small lie.
 */
async function paintLive(config: HabitConfig): Promise<void> {
  const now = Date.now()
  const [state, days] = await Promise.all([loadState(now), loadDays()])

  const banked = days[localDayKey(now)] ?? 0
  const counting = state.key !== null && !state.idle && state.focused
  const inProgress = counting ? Math.min(Math.max(0, now - state.since), MAX_GAP_MS) : 0
  const live = banked + inProgress

  const target = config.targetMinutes * 60_000
  $('mins').innerHTML = `<b>${human(live)}</b> <span>/ ${config.targetMinutes} min today</span>`
  $('fill').style.height = `${Math.min(100, (live / target) * 100)}%`

  const pulse = $('pulse')
  pulse.className = counting ? 'pulse on' : 'pulse'
  pulse.title = counting ? `counting ${state.key}` : 'not counting'

  await renderSession(now)
}

/* -------------------------------------------------------------- sessions */

/**
 * Three states: no session, one running, one just finished.
 *
 * Redrawn every second alongside the clock, so the countdown moves and the
 * split updates while you watch.
 */
async function renderSession(now: number): Promise<void> {
  const box = $('sessionbox')
  const session = await loadSession()

  if (!session) {
    box.innerHTML = ''
    const start = document.createElement('button')
    start.className = 'startsession'
    start.type = 'button'
    start.textContent = `\u25b6 Start a ${DEFAULT_SESSION_MINUTES}-min session`
    start.addEventListener('click', () => void beginSession())
    box.appendChild(start)
    return
  }

  if (session.endedAt === null) {
    const left = remaining(session, now)
    box.innerHTML = `
      <div class="running">
        <div class="top">
          <span class="countdown">${mmss(left)}</span>
          <button class="stop" type="button" id="stopsession">Stop</button>
        </div>
        <div class="split">
          <span>on task <b>${human(session.onTaskMs)}</b></span>
          <span class="drifted">drifted <b>${human(session.driftMs)}</b></span>
        </div>
      </div>`
    $('stopsession').addEventListener('click', () => void finishSession())
    return
  }

  // Finished — show both numbers, neither hidden.
  const out = summarise(session)
  box.innerHTML = `
    <div class="summary">
      <p class="head">${session.completed ? 'session complete' : 'session stopped'}</p>
      <p class="line">${out.totalMinutes} minutes. <b>${out.onTaskMinutes} were the thing.</b>${
        out.driftMinutes > 0 ? ` ${out.driftMinutes} drifted.` : ''
      }${out.awayMinutes > 0 ? ` ${out.awayMinutes} away.` : ''}</p>
      <button class="again" type="button" id="dismisssummary">Dismiss</button>
    </div>`
  $('dismisssummary').addEventListener('click', () => void dismissSummary())
}

async function beginSession(): Promise<void> {
  await saveSession(startSession(Date.now(), DEFAULT_SESSION_MINUTES))
  const config = await loadConfig()
  if (config) await paintLive(config)
}

async function finishSession(): Promise<void> {
  const session = await loadSession()
  if (!session) return
  await saveSession(endSession(session, Date.now()))
  const config = await loadConfig()
  if (config) await paintLive(config)
}

async function dismissSummary(): Promise<void> {
  await clearSession()
  const config = await loadConfig()
  if (config) await paintLive(config)
}

/* ---------------------------------------------------------------- running */

function renderWeeks(days: Record<string, number>, now: number, target: number): void {
  const labels = $('weekdays')
  if (labels.childElementCount === 0) {
    for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
      const s = document.createElement('span')
      s.textContent = d
      labels.appendChild(s)
    }
  }

  const grid = $('wkgrid')
  grid.innerHTML = ''
  for (const cell of twoWeeks(days, now)) {
    const i = document.createElement('i')
    const classes: string[] = []
    if (cell.isFuture) classes.push('future')
    if (cell.ms >= target * 60_000) classes.push('on')
    if (cell.isToday) classes.push('today')
    i.className = classes.join(' ')
    i.title = `${cell.day} — ${minutes(cell.ms)} min`
    grid.appendChild(i)
  }
}

function renderLog(lines: LogLine[]): void {
  const list = $<HTMLUListElement>('loglist')
  list.innerHTML = ''
  if (lines.length === 0) {
    const li = document.createElement('li')
    li.textContent = 'nothing yet'
    list.appendChild(li)
    return
  }
  for (const line of [...lines].reverse()) {
    const li = document.createElement('li')
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = clock(line.at)
    const what = document.createElement('span')
    what.textContent = line.key ?? line.reason
    li.append(t, what)
    if (line.creditedMs > 0) {
      const credit = document.createElement('span')
      credit.className = 'credit'
      credit.textContent = `+${Math.round(line.creditedMs / 1000)}s`
      li.appendChild(credit)
    }
    list.appendChild(li)
  }
}

async function renderRunning(config: HabitConfig): Promise<void> {
  const now = Date.now()
  const [state, days, probe, log] = await Promise.all([
    loadState(now),
    loadDays(),
    loadProbe(),
    loadLog(),
  ])


  $('habit').textContent = config.habit

  $('now').innerHTML = !state.focused
    ? 'Browser is in the background — <b>clock stopped</b>.'
    : state.idle
      ? 'No keyboard or mouse — <b>clock stopped</b>.'
      : state.key
        ? `Counting: <b>${state.key}</b>`
        : 'Front tab is <b>not the work</b> — nothing counting.'

  const offer = $('offer')
  const addThis = $<HTMLButtonElement>('addthis')
  const suggestion = await suggestCurrentSite(config)
  if (suggestion) {
    offer.hidden = false
    addThis.dataset['site'] = suggestion
    addThis.innerHTML = `+ also count <b>${suggestion}</b>`
  } else {
    offer.hidden = true
    delete addThis.dataset['site']
  }

  renderWeeks(days, now, config.targetMinutes)
  renderLog(log)

  // Once a second while the popup is open. It dies with the popup, so there is
  // nothing to clean up on close.
  stopLive()
  void paintLive(config)
  liveTimer = setInterval(() => void paintLive(config), 1000)

  $('counts').textContent =
    `activated ${probe.onActivated} · updated ${probe.onUpdated} · focus ${probe.onFocus} · ` +
    `idle ${probe.onIdle} · alarm ${probe.onAlarm} · address readable ${probe.urlSeen} · hidden ${probe.urlHidden}` +
    (probe.lastError ? `\nerror: ${probe.lastError}` : '')

  show('running')
}

/* ------------------------------------------------------------------ wiring */

$('add-site').addEventListener('click', addSiteFromInput)

$('site-input').addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter') addSiteFromInput()
})

$('habit-input').addEventListener('input', () => {
  refreshStartButton()
  persistDraft()
})

$('target-input').addEventListener('input', persistDraft)

$('start').addEventListener('click', () => {
  const habit = $<HTMLInputElement>('habit-input').value.trim()
  const target = Number($<HTMLInputElement>('target-input').value) || DEFAULT_TARGET_MINUTES
  if (!habit || draftSites.length === 0) return

  void (async () => {
    const existing = await loadConfig()
    const config: HabitConfig = {
      habit,
      sites: [...draftSites],
      targetMinutes: Math.max(1, Math.min(600, target)),
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await saveConfig(config)
    await clearDraft()
    await renderRunning(config)
  })()
})

$('addthis').addEventListener('click', () => {
  const site = $('addthis').dataset['site']
  if (!site) return
  // First thing in the handler, before any await: chrome.permissions.request()
  // needs the user gesture still to be live, and an await spends it.
  void requestPermission(site).then(async (granted) => {
    if (!granted) return
    const config = await loadConfig()
    if (!config) return
    if (!config.sites.includes(site)) config.sites.push(site)
    await saveConfig(config)
    await renderRunning(config)
  })
})

$('dismiss').addEventListener('click', () => {
  const site = $('addthis').dataset['site']
  if (!site) return
  void (async () => {
    await ignoreSite(site)
    const config = await loadConfig()
    if (config) await renderRunning(config)
  })()
})

$('seeyear').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/year/index.html') })
})

$('edit').addEventListener('click', () => {
  void loadConfig().then((config) => openSetup(config))
})

$('cancel-edit').addEventListener('click', () => {
  void loadConfig().then((config) => {
    if (config) void renderRunning(config)
  })
})

/**
 * Export. The largest single complaint cluster in the research is silent data
 * loss, and users explicitly reject "just export it yourself every day" as a
 * workaround — so this exists from the first version, not as a later nicety.
 */
$('export').addEventListener('click', () => {
  void (async () => {
    const [config, days, log] = await Promise.all([loadConfig(), loadDays(), loadLog()])
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      config,
      days,
      log,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lifedots-${localDayKey(Date.now())}.json`
    a.click()
    URL.revokeObjectURL(url)
  })()
})

void (async () => {
  const config = await loadConfig()
  if (config) await renderRunning(config)
  else await openSetup(null)
})()
