import { describe, expect, it } from 'vitest'
import { getDefaultBundlerUrls } from './bundlers'

describe('getDefaultBundlerUrls', () => {
  it('returns Pimlico and Candide for mainnets', () => {
    const ethereum = getDefaultBundlerUrls(1)
    const base = getDefaultBundlerUrls(8453)

    expect(ethereum.some((url) => url.includes('pimlico'))).toBe(true)
    expect(ethereum.some((url) => url.includes('candide'))).toBe(true)
    expect(base.some((url) => url.includes('pimlico'))).toBe(true)
    expect(base.some((url) => url.includes('candide'))).toBe(true)
  })

  it('returns Pimlico-only for testnets', () => {
    const sepolia = getDefaultBundlerUrls(11155111)
    const baseSepolia = getDefaultBundlerUrls(84532)

    expect(sepolia.length).toBe(1)
    expect(sepolia[0]).toContain('pimlico')
    expect(baseSepolia.length).toBe(1)
    expect(baseSepolia[0]).toContain('pimlico')
  })

  it('returns empty list for unknown chains', () => {
    expect(getDefaultBundlerUrls(31337)).toEqual([])
  })
})
