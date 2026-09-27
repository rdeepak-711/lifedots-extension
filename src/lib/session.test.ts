import { describe, expect, it } from 'vitest'
import {
  addToSession,
  classifyPresence,
  endSession,
  isOver,
  remaining,
  startSession,
  summarise,
} from './session'

const MIN = 60_000
const T0 = new Date('2026-09-23T21:30:00').getTime()

describe('classifyPresence', () => {
  it('is on-task only when focused and on a habit site', () => {
    expect(classifyPresence({ key: 'leetcode.com', idle: false, focused: true })).toBe('on-task')
  })

  it('is drift when focused but somewhere else', () => {
    expect(classifyPresence({ key: null, idle: false, focused: true })).toBe('drift')
  })

  it('is drift when active in another application', () => {
    // Chrome unfocused but the user is still typing somewhere — they are doing
    // something else on the computer, which is drift rather than absence.
    expect(classifyPresence({ key: 'leetcode.com', idle: false, focused: false })).toBe('drift')
  })

  it('is away when nobody is at the machine, whatever is on screen', () => {
    expect(classifyPresence({ key: 'leetcode.com', idle: true, focused: true })).toBe('away')
    expect(classifyPresence({ key: null, idle: true, focused: false })).toBe('away')
  })
})

describe('a session', () => {
  it('starts empty with the requested length', () => {
    const s = startSession(T0, 25)
    expect(s.durationMs).toBe(25 * MIN)
    expect(s.onTaskMs).toBe(0)
    expect(s.endedAt).toBeNull()
    expect(remaining(s, T0)).toBe(25 * MIN)
  })

  it('counts time into the right bucket', () => {
    let s = startSession(T0, 25)
    s = addToSession(s, 'on-task', 11 * MIN)
    s = addToSession(s, 'drift', 2 * MIN)
    s = addToSession(s, 'away', 1 * MIN)
    expect(s.onTaskMs).toBe(11 * MIN)
    expect(s.driftMs).toBe(2 * MIN)
    expect(s.awayMs).toBe(1 * MIN)
  })

  it('keeps drift and away apart', () => {
    // Stepping out is not the same as opening YouTube, and a summary that
    // merged them would be judging someone for living their life.
    let s = startSession(T0, 25)
    s = addToSession(s, 'away', 5 * MIN)
    expect(s.driftMs).toBe(0)
    expect(summarise(s).driftMinutes).toBe(0)
    expect(summarise(s).awayMinutes).toBe(5)
  })

  it('runs down and reports when it is over', () => {
    const s = startSession(T0, 25)
    expect(isOver(s, T0 + 24 * MIN)).toBe(false)
    expect(remaining(s, T0 + 24 * MIN)).toBe(MIN)
    expect(isOver(s, T0 + 25 * MIN)).toBe(true)
    expect(remaining(s, T0 + 30 * MIN)).toBe(0)
  })

  it('marks a full run as completed and an early stop as not', () => {
    const full = endSession(startSession(T0, 25), T0 + 25 * MIN)
    expect(full.completed).toBe(true)

    const early = endSession(startSession(T0, 25), T0 + 9 * MIN)
    expect(early.completed).toBe(false)
    expect(early.endedAt).toBe(T0 + 9 * MIN)
  })

  it('stops counting once it has ended', () => {
    let s = endSession(startSession(T0, 25), T0 + 25 * MIN)
    s = addToSession(s, 'on-task', 10 * MIN)
    expect(s.onTaskMs).toBe(0)
  })

  it('cannot be ended twice', () => {
    const first = endSession(startSession(T0, 25), T0 + 9 * MIN)
    const second = endSession(first, T0 + 20 * MIN)
    expect(second.endedAt).toBe(T0 + 9 * MIN)
  })

  it('reports both numbers, neither hidden', () => {
    let s = startSession(T0, 25)
    s = addToSession(s, 'on-task', 20 * MIN)
    s = addToSession(s, 'drift', 5 * MIN)
    const out = summarise(s)
    expect(out.onTaskMinutes).toBe(20)
    expect(out.driftMinutes).toBe(5)
    expect(out.totalMinutes).toBe(25)
  })

  it('ignores nonsense intervals', () => {
    let s = startSession(T0, 25)
    s = addToSession(s, 'on-task', 0)
    s = addToSession(s, 'on-task', -5 * MIN)
    expect(s.onTaskMs).toBe(0)
  })
})
