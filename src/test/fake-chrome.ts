/**
 * A fake of the parts of the `chrome.*` API that LifeDots actually uses, so the
 * stopwatch can be tested without a browser.
 *
 * This exists because of the single hardest thing in v0: the MV3 service worker
 * gets terminated whenever Chrome likes, and every counted second has to survive
 * that. Tests need to drive tab switches, focus changes and idle transitions
 * deterministically — and then simulate the worker dying — which is what
 * `emit()` and `resetRuntimeState()` are for.
 */

export type Listener<A extends unknown[]> = (...args: A) => void

/** Minimal stand-in for chrome's `Event` objects. */
export class FakeEvent<A extends unknown[]> {
  private listeners: Listener<A>[] = []

  addListener = (fn: Listener<A>): void => {
    this.listeners.push(fn)
  }

  removeListener = (fn: Listener<A>): void => {
    this.listeners = this.listeners.filter((l) => l !== fn)
  }

  hasListener = (fn: Listener<A>): boolean => this.listeners.includes(fn)

  /** Fire the event. Awaits listeners so async handlers finish before assertions. */
  emit = async (...args: A): Promise<void> => {
    for (const fn of [...this.listeners]) await fn(...args)
  }

  get listenerCount(): number {
    return this.listeners.length
  }
}

export interface FakeTab {
  id: number
  windowId: number
  url: string
  active: boolean
}

export function createFakeChrome() {
  /** The only thing that survives a simulated worker death. */
  const local = new Map<string, unknown>()

  const onActivated = new FakeEvent<[{ tabId: number; windowId: number }]>()
  const onUpdated = new FakeEvent<[number, { url?: string }, FakeTab]>()
  const onRemoved = new FakeEvent<[number]>()
  const onFocusChanged = new FakeEvent<[number]>()
  const onIdleStateChanged = new FakeEvent<['active' | 'idle' | 'locked']>()
  const onAlarm = new FakeEvent<[{ name: string }]>()
  const onInstalled = new FakeEvent<[{ reason: string }]>()
  const onStartup = new FakeEvent<[]>()

  const tabs = new Map<number, FakeTab>()
  const alarms = new Map<string, { name: string; periodInMinutes?: number; when?: number }>()
  const notifications: { id: string; options: Record<string, unknown> }[] = []
  let icon: unknown = null
  let idleState: 'active' | 'idle' | 'locked' = 'active'

  const chrome = {
    storage: {
      local: {
        async get(keys?: string | string[] | null) {
          if (keys == null) return Object.fromEntries(local)
          const list = typeof keys === 'string' ? [keys] : keys
          const out: Record<string, unknown> = {}
          for (const k of list) if (local.has(k)) out[k] = local.get(k)
          return out
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) local.set(k, v)
        },
        async remove(keys: string | string[]) {
          for (const k of typeof keys === 'string' ? [keys] : keys) local.delete(k)
        },
        async clear() {
          local.clear()
        },
      },
    },

    tabs: {
      onActivated,
      onUpdated,
      onRemoved,
      async get(tabId: number) {
        const tab = tabs.get(tabId)
        if (!tab) throw new Error(`no such tab: ${tabId}`)
        return tab
      },
      async query({ active, windowId }: { active?: boolean; windowId?: number }) {
        return [...tabs.values()].filter(
          (t) =>
            (active === undefined || t.active === active) &&
            (windowId === undefined || t.windowId === windowId),
        )
      },
    },

    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged,
    },

    idle: {
      onStateChanged: onIdleStateChanged,
      async queryState() {
        return idleState
      },
      setDetectionInterval(_seconds: number) {},
    },

    alarms: {
      onAlarm,
      async create(name: string, info: { periodInMinutes?: number; when?: number }) {
        alarms.set(name, { name, ...info })
      },
      async clear(name: string) {
        return alarms.delete(name)
      },
      async getAll() {
        return [...alarms.values()]
      },
    },

    action: {
      async setIcon(details: unknown) {
        icon = details
      },
      async setTitle(_details: unknown) {},
    },

    notifications: {
      async create(id: string, options: Record<string, unknown>) {
        notifications.push({ id, options })
        return id
      },
    },

    runtime: {
      onInstalled,
      onStartup,
      lastError: undefined as { message: string } | undefined,
    },
  }

  /** Test helpers — not part of the real chrome API. */
  const harness = {
    chrome,

    /** Put a tab in the world and make it the active one. */
    async openTab(tab: FakeTab) {
      for (const t of tabs.values()) if (t.windowId === tab.windowId) t.active = false
      tabs.set(tab.id, { ...tab, active: true })
      await onActivated.emit({ tabId: tab.id, windowId: tab.windowId })
    },

    /** Navigate an existing tab. */
    async navigate(tabId: number, url: string) {
      const tab = tabs.get(tabId)
      if (!tab) throw new Error(`no such tab: ${tabId}`)
      tab.url = url
      await onUpdated.emit(tabId, { url }, tab)
    },

    async focusWindow(windowId: number) {
      await onFocusChanged.emit(windowId)
    },

    async blurAllWindows() {
      await onFocusChanged.emit(chrome.windows.WINDOW_ID_NONE)
    },

    async setIdle(state: 'active' | 'idle' | 'locked') {
      idleState = state
      await onIdleStateChanged.emit(state)
    },

    async fireAlarm(name: string) {
      await onAlarm.emit({ name })
    },

    /**
     * Simulate MV3 terminating the service worker: every listener and every
     * in-memory variable disappears; only chrome.storage survives. Re-register
     * your worker after calling this and assert the counts are still right.
     */
    killServiceWorker() {
      for (const ev of [
        onActivated,
        onUpdated,
        onRemoved,
        onFocusChanged,
        onIdleStateChanged,
        onAlarm,
        onInstalled,
        onStartup,
      ]) {
        // @ts-expect-error — reaching into the fake on purpose
        ev.listeners = []
      }
    },

    /** Read what the code wrote, without going through the async API. */
    peekStorage: () => Object.fromEntries(local),
    lastIcon: () => icon,
    sentNotifications: () => notifications,
    scheduledAlarms: () => [...alarms.values()],
  }

  return harness
}

export type FakeChrome = ReturnType<typeof createFakeChrome>
