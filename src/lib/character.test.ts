import { describe, expect, it } from 'vitest'
import {
  MAX_UNPROMPTED_PER_WEEK,
  WEEK_MS,
  canSpeak,
  pruneHistory,
  type Appearance,
} from './character'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-23T21:30:00').getTime()
const SESSION = NOW - 10 * 60_000

const speak = (
  trigger: Parameters<typeof canSpeak>[0]['trigger'],
  history: Appearance[] = [],
  sessionStartedAt: number | null = SESSION,
  now = NOW,
) => canSpeak({ trigger, history, now, sessionStartedAt })

describe('asked-for triggers — inside a session', () => {
  it('lets him speak once', () => {
    expect(speak('drift')).toBe(true)
  })

  it('will not let him say it twice in one session', () => {
    // Five wanders in one session should get one remark, not five.
    const history: Appearance[] = [{ at: SESSION + 60_000, trigger: 'drift' }]
    expect(speak('drift', history)).toBe(false)
  })

  it('resets for the next session', () => {
    const history: Appearance[] = [{ at: SESSION - DAY, trigger: 'drift' }]
    expect(speak('drift', history)).toBe(true)
  })

  it('stays silent when no session is running', () => {
    // Nobody asked to be watched, so he has no standing to comment.
    expect(speak('drift', [], null)).toBe(false)
  })

  it('treats the end-of-session remarks the same way', () => {
    expect(speak('session-clean')).toBe(true)
    expect(speak('session-mixed', [{ at: SESSION + 1, trigger: 'session-mixed' }])).toBe(false)
  })
})

describe('unprompted triggers — nobody asked', () => {
  it('allows one a day', () => {
    expect(speak('day-nearly-gone', [], null)).toBe(true)
  })

  it('refuses a second on the same day, even for a different reason', () => {
    const history: Appearance[] = [{ at: NOW - 60 * 60_000, trigger: 'comeback' }]
    expect(speak('day-nearly-gone', history, null)).toBe(false)
  })

  it('enforces a hard weekly ceiling', () => {
    const history: Appearance[] = [
      { at: NOW - 2 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 3 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 4 * DAY, trigger: 'comeback' },
    ]
    expect(history).toHaveLength(MAX_UNPROMPTED_PER_WEEK)
    expect(speak('day-nearly-gone', history, null)).toBe(false)
  })

  it('lets the ceiling roll off after a week', () => {
    const history: Appearance[] = [
      { at: NOW - 8 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 9 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 10 * DAY, trigger: 'comeback' },
    ]
    expect(speak('day-nearly-gone', history, null)).toBe(true)
  })

  it('does not let a session make him chattier when unprompted', () => {
    const history: Appearance[] = [{ at: NOW - 60 * 60_000, trigger: 'day-nearly-gone' }]
    expect(speak('comeback', history, SESSION)).toBe(false)
  })
})

describe('dot-filled', () => {
  it('is allowed once a day', () => {
    expect(speak('dot-filled', [], null)).toBe(true)
  })

  it('is not repeated the same day', () => {
    const history: Appearance[] = [{ at: NOW - 60_000, trigger: 'dot-filled' }]
    expect(speak('dot-filled', history, null)).toBe(false)
  })

  it('is not blocked by the unprompted ceiling — it was earned', () => {
    const history: Appearance[] = [
      { at: NOW - 2 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 3 * DAY, trigger: 'day-nearly-gone' },
      { at: NOW - 4 * DAY, trigger: 'comeback' },
    ]
    expect(speak('dot-filled', history, null)).toBe(true)
  })
})

describe('pruneHistory', () => {
  it('keeps only what can still affect a decision', () => {
    const history: Appearance[] = [
      { at: NOW - 1 * DAY, trigger: 'drift' },
      { at: NOW - 8 * DAY, trigger: 'drift' },
    ]
    const kept = pruneHistory(history, NOW)
    expect(kept).toHaveLength(1)
    expect(NOW - (kept[0] as Appearance).at).toBeLessThan(WEEK_MS)
  })
})
