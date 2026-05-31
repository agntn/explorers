/**
 * blocex — Mempool.space integration tests (Bitcoin)
 *
 * Live roundtrips against public mempool.space API.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/mempool.js'

// A known Bitcoin address with history
const KNOWN_BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'

describe('mempool provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('mempool')
  })

  it('reports capabilities', () => {
    const caps = provider.capabilities()
    expect(caps.balances).toBe(true)
    expect(caps.txHistory).toBe(true)
    expect(caps.txDetail).toBe(true)
    expect(caps.gasData).toBe(true)
    expect(caps.blockInfo).toBe(true)
    expect(caps.contractInfo).toBe(false)
    expect(caps.tokenBalances).toBe(false)
  })

  it('getBalance returns BTC balance for known address', async () => {
    const balance = await provider.getBalance(KNOWN_BTC, 'bitcoin')

    expect(balance.address).toBe(KNOWN_BTC)
    expect(balance.chain).toBe('bitcoin')
    expect(balance.symbol).toBe('BTC')
    expect(balance.balance).toMatch(/^-?\d+$/)
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getTxHistory returns BTC transactions', async () => {
    const txs = await provider.getTxHistory(KNOWN_BTC, 'bitcoin', { limit: 3 })

    expect(Array.isArray(txs)).toBe(true)
    expect(txs.length).toBeGreaterThan(0)
    expect(txs.length).toBeLessThanOrEqual(3)

    const tx = txs[0]!
    expect(tx.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(tx.status).toBe('success')
    expect(tx.blockNumber).toBeGreaterThan(0)
  })

  it('getGasData returns fee estimates', async () => {
    const gas = await provider.getGasData!('bitcoin')

    expect(gas.chain).toBe('bitcoin')
    expect(gas.proposedGasPrice).toBeTruthy()
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0)
  })

  it('getBalance throws for non-bitcoin chain', async () => {
    await expect(
      provider.getBalance(KNOWN_BTC, 'eth'),
    ).rejects.toThrow()
  })
})
