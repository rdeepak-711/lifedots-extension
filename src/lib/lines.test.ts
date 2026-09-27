import { describe, expect, it } from 'vitest'
import { LINES, lineCount, pickLine, type Trigger } from './lines'

const TRIGGERS = Object.keys(LINES) as Trigger[]

describe('the line bank', () => {
  it('has a line for every trigger', () => {
    for (const trigger of TRIGGERS) {
      expect(LINES[trigger].length).toBeGreaterThan(0)
    }
  })

  it('carries enough lines that repetition is not immediate', () => {
    // 40 is the v1 floor agreed in the build plan. Novelty decay is the biggest
    // named risk in this product, so a shrinking bank should fail the build.
    expect(lineCount()).toBeGreaterThanOrEqual(40)
  })

  it('gives the drift moment the deepest bank', () => {
    // It is the one he exists for, and the one a user sees most often.
    for (const trigger of TRIGGERS) {
      if (trigger === 'drift') continue
      expect(LINES.drift.length).toBeGreaterThanOrEqual(LINES[trigger].length)
    }
  })

  it('never contains a second person accusation', () => {
    // "Roast the situation, never the person." These are the shapes that turn a
    // witness into a warden, and they are what Routinery's 1-star reviews are
    // about: "I'm being threatened and infantilized."
    const banned = [
      /you failed/i,
      /you should have/i,
      /you always/i,
      /you never/i,
      /lazy/i,
      /disappoint/i,
      /shame/i,
      /excuse/i,
      /no wonder/i,
    ]
    for (const trigger of TRIGGERS) {
      for (const line of LINES[trigger]) {
        for (const pattern of banned) {
          expect(line, `"${line}" (${trigger})`).not.toMatch(pattern)
        }
      }
    }
  })

  it('never claims to know where the user went', () => {
    // The extension cannot see unnamed sites, so the character must not pretend
    // to. Naming a site he has no permission to read would be a lie the product
    // is specifically built not to tell.
    for (const line of LINES.drift) {
      expect(line.toLowerCase()).not.toMatch(/youtube|twitter|reddit|instagram|netflix/)
    }
  })
})

describe('pickLine', () => {
  it('returns a line from the right trigger', () => {
    expect(LINES.drift).toContain(pickLine('drift', null, 0.4))
  })

  it('never repeats the line used last time', () => {
    const last = LINES.drift[3] as string
    for (let i = 0; i < 50; i++) {
      expect(pickLine('drift', last, i / 50)).not.toBe(last)
    }
  })

  it('stays in range at the edges of the roll', () => {
    for (const roll of [0, 0.999999, 1, -0.5]) {
      expect(LINES.comeback).toContain(pickLine('comeback', null, roll))
    }
  })

  it('still returns something when the bank has a single line', () => {
    const only = LINES.comeback[0] as string
    expect(typeof pickLine('comeback', only, 0.5)).toBe('string')
  })
})
