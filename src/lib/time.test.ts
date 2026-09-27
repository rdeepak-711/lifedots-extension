import { describe, expect, it } from 'vitest'
import {
  accrue,
  fillState,
  localDayKey,
  matchHabit,
  minutes,
  startOfNextLocalDay,
  twoWeeks,
  yearGrid,
  MAX_GAP_MS,
  type DayMillis,
  type TrackerState,
} from './time'

const MIN = 60_000
const at = (iso: string) => new Date(iso).getTime()
const working = (since: number, key = 'leetcode.com'): TrackerState => ({ key, since, idle: false })

describe('localDayKey', () => {
  it('uses the local calendar day, not UTC', () => {
    // Constructed without a Z, so this is 23:30 wherever the test runs.
    const lateNight = at('2026-09-23T23:30:00')
    expect(localDayKey(lateNight)).toBe('2026-09-23')
  })

  it('pads months and days', () => {
    expect(localDayKey(at('2026-01-05T09:00:00'))).toBe('2026-01-05')
  })
})

describe('startOfNextLocalDay', () => {
  it('lands exactly on the following midnight', () => {
    const boundary = startOfNextLocalDay(at('2026-09-23T14:00:00'))
    expect(localDayKey(boundary)).toBe('2026-09-24')
    expect(new Date(boundary).getHours()).toBe(0)
    expect(new Date(boundary).getMinutes()).toBe(0)
  })

  it('always moves forward, even at midnight itself', () => {
    const midnight = at('2026-09-23T00:00:00')
    expect(startOfNextLocalDay(midnight)).toBeGreaterThan(midnight)
  })
})

describe('matchHabit', () => {
  const patterns = ['leetcode.com', 'github.com/donnemartin', 'bytebytego.com']

  it('matches a bare host', () => {
    expect(matchHabit('https://leetcode.com/problems/two-sum', patterns)).toBe('leetcode.com')
  })

  it('matches subdomains of a bare host', () => {
    expect(matchHabit('https://www.leetcode.com/', patterns)).toBe('leetcode.com')
    expect(matchHabit('https://blog.bytebytego.com/p/x', patterns)).toBe('bytebytego.com')
  })

  it('respects a path prefix', () => {
    expect(matchHabit('https://github.com/donnemartin/system-design-primer', patterns))
      .toBe('github.com/donnemartin')
    // Same host, different path — this is the "looking, not working" case.
    expect(matchHabit('https://github.com/explore', patterns)).toBeNull()
  })

  it('returns null for a site that is not the work', () => {
    expect(matchHabit('https://youtube.com/watch?v=x', patterns)).toBeNull()
  })

  it('treats a missing url as "not the work", not as an error', () => {
    // This is the normal case for any site we hold no host permission for.
    expect(matchHabit(undefined, patterns)).toBeNull()
  })

  it('ignores chrome:// and extension pages', () => {
    expect(matchHabit('chrome://extensions', patterns)).toBeNull()
    expect(matchHabit('chrome-extension://abc/popup.html', patterns)).toBeNull()
  })

  it('is not fooled by a lookalike host', () => {
    expect(matchHabit('https://notleetcode.com/problems', patterns)).toBeNull()
    expect(matchHabit('https://leetcode.com.evil.test/', patterns)).toBeNull()
  })
})

describe('accrue', () => {
  it('credits time spent on the work', () => {
    // One tick's worth — the real shape, since the alarm fires every minute.
    const start = at('2026-09-23T10:00:00')
    const { days, creditedMs } = accrue(working(start), {}, start + MIN)
    expect(creditedMs).toBe(MIN)
    expect(days['2026-09-23']).toBe(MIN)
  })

  it('adds to a day that already has time on it', () => {
    const start = at('2026-09-23T10:00:00')
    const { days } = accrue(working(start), { '2026-09-23': 5 * MIN }, start + 3 * MIN)
    expect(days['2026-09-23']).toBe(8 * MIN)
  })

  it('absorbs ordinary alarm jitter rather than discarding real work', () => {
    // Chrome delayed the tick to four minutes. The user was working the whole
    // time. Under-counting here is the failure the research calls fatal, so
    // all four minutes are credited.
    const start = at('2026-09-23T10:00:00')
    const { creditedMs, discardedMs } = accrue(working(start), {}, start + 4 * MIN)
    expect(creditedMs).toBe(4 * MIN)
    expect(discardedMs).toBe(0)
  })

  it('counts nothing when the front tab is not the work', () => {
    const start = at('2026-09-23T10:00:00')
    const state: TrackerState = { key: null, since: start, idle: false }
    const { days, creditedMs } = accrue(state, {}, start + 30 * MIN)
    expect(creditedMs).toBe(0)
    expect(days).toEqual({})
  })

  it('counts nothing while the user is idle', () => {
    const start = at('2026-09-23T10:00:00')
    const state: TrackerState = { key: 'leetcode.com', since: start, idle: true }
    const { creditedMs } = accrue(state, {}, start + 30 * MIN)
    expect(creditedMs).toBe(0)
  })

  it('splits a stretch that crosses midnight across both days', () => {
    const start = at('2026-09-23T23:50:00')
    const end = at('2026-09-24T00:10:00')
    // Widen the cap here so this test is about the midnight split itself
    // rather than about clamping, which has its own test below.
    const { days, creditedMs } = accrue(working(start), {}, end, 60 * MIN)
    expect(days['2026-09-23']).toBe(10 * MIN)
    expect(days['2026-09-24']).toBe(10 * MIN)
    expect(creditedMs).toBe(20 * MIN)
  })

  it('discards a gap too long to trust, instead of inventing minutes', () => {
    // The laptop slept for six hours with LeetCode in front.
    const start = at('2026-09-23T02:00:00')
    const { days, creditedMs, discardedMs } = accrue(working(start), {}, start + 6 * 60 * MIN)
    expect(creditedMs).toBe(MAX_GAP_MS)
    expect(discardedMs).toBe(6 * 60 * MIN - MAX_GAP_MS)
    expect(days['2026-09-23']).toBe(MAX_GAP_MS)
    // The bias is deliberate: a few minutes of sleep credited once on wake is
    // invisible, whereas discarding a real minute is what makes people quit.
    expect(MAX_GAP_MS).toBeGreaterThan(2 * MIN)
  })

  it('never credits time running backwards', () => {
    const start = at('2026-09-23T10:00:00')
    const { creditedMs } = accrue(working(start), {}, start - 5 * MIN)
    expect(creditedMs).toBe(0)
  })

  it('does not mutate the days it was given', () => {
    const start = at('2026-09-23T10:00:00')
    const original = { '2026-09-23': 5 * MIN }
    accrue(working(start), original, start + MIN)
    expect(original['2026-09-23']).toBe(5 * MIN)
  })

  it('adds up correctly across many small ticks, as the alarm will produce', () => {
    // The real shape: a tick a minute rather than one long stretch.
    let days: DayMillis = {}
    let cursor = at('2026-09-23T09:00:00')
    for (let i = 0; i < 30; i++) {
      const next = cursor + MIN
      days = accrue(working(cursor), days, next).days
      cursor = next
    }
    expect(days['2026-09-23']).toBe(30 * MIN)
  })
})

describe('fillState', () => {
  it('walks through the five icon states', () => {
    expect(fillState(0, 25)).toBe(0)
    expect(fillState(6 * MIN, 25)).toBe(0) // 24% — not yet
    expect(fillState(6.25 * MIN, 25)).toBe(25)
    expect(fillState(13 * MIN, 25)).toBe(50)
    expect(fillState(19 * MIN, 25)).toBe(75)
    expect(fillState(25 * MIN, 25)).toBe(100)
  })

  it('stays full once the day is done', () => {
    expect(fillState(90 * MIN, 25)).toBe(100)
  })
})

describe('minutes', () => {
  it('rounds down, so 25/25 never shows before the dot fills', () => {
    expect(minutes(24.9 * MIN)).toBe(24)
    expect(minutes(25 * MIN)).toBe(25)
  })
})

describe('twoWeeks', () => {
  it('returns fourteen cells, Monday first', () => {
    const cells = twoWeeks({}, at('2026-09-23T12:00:00')) // a Wednesday
    expect(cells).toHaveLength(14)
    expect(new Date(cells[0]!.day + 'T00:00:00').getDay()).toBe(1) // Monday
  })

  it('puts today in the second week and marks it', () => {
    const cells = twoWeeks({}, at('2026-09-23T12:00:00'))
    const todayIndex = cells.findIndex((c) => c.isToday)
    expect(todayIndex).toBeGreaterThanOrEqual(7)
    expect(cells[todayIndex]!.day).toBe('2026-09-23')
  })

  it('marks the rest of this week as still to come', () => {
    const cells = twoWeeks({}, at('2026-09-23T12:00:00')) // Wednesday
    const future = cells.filter((c) => c.isFuture)
    // Thursday, Friday, Saturday, Sunday.
    expect(future).toHaveLength(4)
    expect(future.every((c) => c.ms === 0)).toBe(true)
  })

  it('carries the minutes recorded against each day', () => {
    const cells = twoWeeks({ '2026-09-22': 30 * MIN }, at('2026-09-23T12:00:00'))
    const monday = cells.find((c) => c.day === '2026-09-22')
    expect(monday?.ms).toBe(30 * MIN)
  })

  it('shows a full previous week regardless of which day it is run on', () => {
    for (const day of ['2026-09-21', '2026-09-24', '2026-09-27']) {
      const cells = twoWeeks({}, at(`${day}T12:00:00`))
      expect(cells).toHaveLength(14)
      expect(cells.filter((c) => c.isToday)).toHaveLength(1)
    }
  })
})

describe('yearGrid', () => {
  const MID_YEAR = at('2026-09-23T12:00:00')

  it('covers every day of the year in whole weeks', () => {
    const g = yearGrid({}, MID_YEAR, 25)
    const real = g.weeks.flat().filter((c) => c.day !== null)
    expect(real).toHaveLength(365) // 2026 is not a leap year
    for (const w of g.weeks) expect(w).toHaveLength(7)
  })

  it('starts each week on a Monday', () => {
    const g = yearGrid({}, MID_YEAR, 25)
    const firstReal = g.weeks[0]!.find((c) => c.day !== null)!
    const jan1 = g.weeks.flat().find((c) => c.day === '2026-01-01')
    expect(jan1).toBeDefined()
    expect(firstReal).toBeDefined()
  })

  it('marks today exactly once', () => {
    const g = yearGrid({}, MID_YEAR, 25)
    const todays = g.weeks.flat().filter((c) => c.isToday)
    expect(todays).toHaveLength(1)
    expect(todays[0]!.day).toBe('2026-09-23')
  })

  it('counts only days that reached the target as filled', () => {
    const days = {
      '2026-09-21': 25 * MIN, // exactly the target
      '2026-09-22': 40 * MIN, // over
      '2026-09-20': 12 * MIN, // under — real work, but not a filled dot
    }
    const g = yearGrid(days, MID_YEAR, 25)
    expect(g.filled).toBe(2)
    expect(g.totalMs).toBe(77 * MIN)
  })

  it('counts the days still ahead, excluding today', () => {
    const g = yearGrid({}, MID_YEAR, 25)
    // 23 Sep is day 266 of 365, so 99 days follow it.
    expect(g.remaining).toBe(99)
  })

  it('handles the first and last days of the year', () => {
    for (const when of ['2026-01-01T09:00:00', '2026-12-31T23:00:00']) {
      const g = yearGrid({}, at(when), 25)
      expect(g.weeks.flat().filter((c) => c.day !== null)).toHaveLength(365)
      expect(g.weeks.flat().filter((c) => c.isToday)).toHaveLength(1)
    }
  })

  it('pads the edges rather than inventing days', () => {
    const g = yearGrid({}, MID_YEAR, 25)
    const padding = g.weeks.flat().filter((c) => c.day === null)
    expect(padding.every((c) => c.ms === 0 && !c.isToday)).toBe(true)
  })
})
