/**
 * blocex — TON (The Open Network) integration tests
 *
 * Live roundtrips against tonapi.io public API.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/ton.js'

// A known TON address with balance
const KNOWN_TON = 'EQD__________________________________________0voM'

describe('ton provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('ton')
  })

  it('reports capabilities', () => {
    const caps = provider.capabilities()
    expect(caps.balances).toBe(true)
    expect(caps.txHistory).toBe(true)
    expect(caps.blockInfo).toBe(true)
    expect(caps.txDetail).toBe(false)
    expect(caps.contractInfo).toBe(false)
    expect(caps.tokenBalances).toBe(false)
  })

  it('getBalance returns TON balance for known address', async () => {
    const balance = await provider.getBalance(KNOWN_TON, 'ton')

    expect(balance.address).toBe(KNOWN_TON)
    expect(balance.chain).toBe('ton')
    expect(balance.symbol).toBe('TON')
    expect(balance.balance).toMatch(/^\d+$/)
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getTxHistory returns TON events', async () => {
    const txs = await provider.getTxHistory(KNOWN_TON, 'ton', { limit: 3 })

    expect(Array.isArray(txs)).toBe(true)
    expect(txs.length).toBeGreaterThan(0)
    expect(txs.length).toBeLessThanOrEqual(3)

    const tx = txs[0]!
    expect(tx.hash).toBeTruthy()
    expect(tx.timestamp).toBeTruthy()
    expect(['success', 'failed']).toContain(tx.status)
  })

  it('getBalance throws for non-ton chain', async () => {
    await expect(
      provider.getBalance(KNOWN_TON, 'eth'),
    ).rejects.toThrow()
  })
})
