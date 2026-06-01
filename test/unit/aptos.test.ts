/**
 * blocex — Aptos integration tests
 *
 * Live roundtrips against Aptos Labs public API.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/aptos.js'

// Aptos framework address — always has APT balance
const APTOS_FRAMEWORK = '0x1'

describe('aptos provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('aptos')
  })

  it('reports capabilities', () => {
    const caps = provider.capabilities()
    expect(caps.balances).toBe(true)
    expect(caps.txHistory).toBe(true)
    expect(caps.txDetail).toBe(true)
    expect(caps.blockInfo).toBe(true)
    expect(caps.contractInfo).toBe(false)
    expect(caps.tokenBalances).toBe(false)
  })

  it('getBalance returns APT balance for framework address', async () => {
    const balance = await provider.getBalance(APTOS_FRAMEWORK, 'aptos')

    expect(balance.address).toBe(APTOS_FRAMEWORK)
    expect(balance.chain).toBe('aptos')
    expect(balance.symbol).toBe('APT')
    expect(balance.balance).toMatch(/^\d+$/)
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getTxHistory returns Aptos transactions', async () => {
    const txs = await provider.getTxHistory(APTOS_FRAMEWORK, 'aptos', { limit: 3 })

    expect(Array.isArray(txs)).toBe(true)
    // 0x1 might have very old txs or none in recent range
    if (txs.length > 0) {
      const tx = txs[0]!
      expect(tx.hash).toMatch(/^0x[0-9a-f]+$/)
      expect(tx.timestamp).toBeTruthy()
      expect(['success', 'failed']).toContain(tx.status)
    }
  })

  it('getBalance throws for non-aptos chain', async () => {
    await expect(
      provider.getBalance(APTOS_FRAMEWORK, 'eth'),
    ).rejects.toThrow()
  })
})
