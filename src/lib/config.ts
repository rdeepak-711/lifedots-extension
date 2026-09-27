/**
 * The one habit, and where it lives.
 *
 * v0 hard-coded this. v1 asks the user, because the v0 gate — "does counting
 * minutes on sites named in advance capture the work that really happened?" —
 * can only be answered against a *real* habit on *real* sites. A test run
 * against three sites someone else chose answers a different question.
 */

export interface HabitConfig {
  /** What the user is doing every day, in their own words. */
  habit: string
  /**
   * Where it happens. A bare host (`leetcode.com`) matches that host and its
   * subdomains; a host with a path (`github.com/donnemartin`) matches only
   * under that path.
   */
  sites: string[]
  /** Minutes of real, present, on-site time that fill today's dot. */
  targetMinutes: number
  createdAt: number
}

export const DEFAULT_TARGET_MINUTES = 25

/** How often the worker wakes to bank the time in progress. */
export const TICK_MINUTES = 1

/** Seconds of no keyboard or mouse before the clock stops. */
export const IDLE_SECONDS = 60

const CONFIG_KEY = 'ld:config'

export async function loadConfig(): Promise<HabitConfig | null> {
  const got = await chrome.storage.local.get(CONFIG_KEY)
  const raw = got[CONFIG_KEY] as Partial<HabitConfig> | undefined
  if (!raw || typeof raw.habit !== 'string' || !Array.isArray(raw.sites)) return null
  return {
    habit: raw.habit,
    sites: raw.sites.filter((s): s is string => typeof s === 'string'),
    targetMinutes:
      typeof raw.targetMinutes === 'number' && raw.targetMinutes > 0
        ? raw.targetMinutes
        : DEFAULT_TARGET_MINUTES,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  }
}

export async function saveConfig(config: HabitConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config })
}

export const CONFIG_STORAGE_KEY = CONFIG_KEY
