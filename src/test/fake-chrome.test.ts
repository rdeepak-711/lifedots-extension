import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeChrome, type FakeChrome } from './fake-chrome'

/**
 * These tests do not test LifeDots — there is nothing to test yet. They test the
 * harness that v0's stopwatch will be built against, so that when the stopwatch
 * arrives the ground under it is already known to be solid.
 */

let h: FakeChrome

beforeEach(() => {
  h = createFakeChrome()
  globalThis.chrome = h.chrome as unknown as typeof chrome
})

describe('fake chrome.storage.local', () => {
  it('round-trips a value', async () => {
    await chrome.storage.local.set({ hello: 'world' })
    const got = await chrome.storage.local.get('hello')
    expect(got).toEqual({ hello: 'world' })
  })

  it('returns nothing for a key that was never set', async () => {
    expect(await chrome.storage.local.get('missing')).toEqual({})
  })

  it('removes and clears', async () => {
    await chrome.storage.local.set({ a: 1, b: 2 })
    await chrome.storage.local.remove('a')
    expect(await chrome.storage.local.get(['a', 'b'])).toEqual({ b: 2 })
    await chrome.storage.local.clear()
    expect(await chrome.storage.local.get(null)).toEqual({})
  })
})

describe('fake tab and window events', () => {
  it('reports the active tab after a switch', async () => {
    const seen: number[] = []
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      seen.push(tabId)
    })

    await h.openTab({ id: 1, windowId: 10, url: 'https://leetcode.com/problems/two-sum', active: true })
    await h.openTab({ id: 2, windowId: 10, url: 'https://youtube.com/watch?v=x', active: true })

    expect(seen).toEqual([1, 2])
    const active = await chrome.tabs.query({ active: true, windowId: 10 })
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(2)
  })

  it('fires on navigation within a tab', async () => {
    const urls: string[] = []
    chrome.tabs.onUpdated.addListener((_id, change) => {
      if (change.url) urls.push(change.url)
    })

    await h.openTab({ id: 1, windowId: 10, url: 'https://linkedin.com/jobs', active: true })
    await h.navigate(1, 'https://linkedin.com/feed')

    expect(urls).toEqual(['https://linkedin.com/feed'])
  })

  it('signals when every window loses focus', async () => {
    const focus: number[] = []
    chrome.windows.onFocusChanged.addListener((id) => {
      focus.push(id)
    })

    await h.blurAllWindows()
    expect(focus).toEqual([chrome.windows.WINDOW_ID_NONE])
  })
})

describe('fake idle', () => {
  it('reports and announces state changes', async () => {
    const states: string[] = []
    chrome.idle.onStateChanged.addListener((s) => {
      states.push(s)
    })

    await h.setIdle('idle')
    expect(states).toEqual(['idle'])
    expect(await chrome.idle.queryState(60)).toBe('idle')
  })
})

describe('simulated service-worker death', () => {
  it('drops every listener but keeps storage — the v0 constraint', async () => {
    let ticks = 0
    chrome.tabs.onActivated.addListener(() => {
      ticks += 1
    })
    await chrome.storage.local.set({ 'lifedots:minutes': 14 })

    await h.openTab({ id: 1, windowId: 10, url: 'https://example.com', active: true })
    expect(ticks).toBe(1)

    h.killServiceWorker()
    await h.openTab({ id: 2, windowId: 10, url: 'https://example.com/2', active: true })

    // The listener is gone, exactly as it would be in a real terminated worker.
    expect(ticks).toBe(1)
    // Storage is the only thing that survived.
    expect(await chrome.storage.local.get('lifedots:minutes')).toEqual({
      'lifedots:minutes': 14,
    })
  })
})
