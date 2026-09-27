import { describe, expect, it } from 'vitest'
import { normaliseSite, originPatterns } from './permissions'

describe('normaliseSite', () => {
  it('strips the things people paste', () => {
    expect(normaliseSite('  https://www.LeetCode.com/  ')).toBe('leetcode.com')
    expect(normaliseSite('http://bytebytego.com')).toBe('bytebytego.com')
  })

  it('keeps a path', () => {
    expect(normaliseSite('https://github.com/donnemartin/')).toBe('github.com/donnemartin')
  })
})

describe('originPatterns', () => {
  it('covers a bare host and its subdomains', () => {
    expect(originPatterns('leetcode.com')).toEqual([
      '*://leetcode.com/*',
      '*://*.leetcode.com/*',
    ])
  })

  it('covers a path onward, so the same host can be split', () => {
    expect(originPatterns('github.com/donnemartin')).toEqual([
      '*://github.com/donnemartin*',
      '*://*.github.com/donnemartin*',
    ])
  })

  it('accepts what a person actually types', () => {
    expect(originPatterns('https://www.Leetcode.com/')).toEqual([
      '*://leetcode.com/*',
      '*://*.leetcode.com/*',
    ])
  })

  it('refuses input Chrome would reject', () => {
    expect(originPatterns('')).toEqual([])
    expect(originPatterns('   ')).toEqual([])
    expect(originPatterns('not a domain')).toEqual([])
    // No dot: would be a hostname like "localhost", which we do not support
    // and which would produce a pattern Chrome rejects.
    expect(originPatterns('leetcode')).toEqual([])
  })
})
