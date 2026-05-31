/**
 * blocex — Solana public RPC integration tests
 *
 * Live roundtrips against Solana mainnet-beta public RPC.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/solana.js'

const KNOWN_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('solana provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('solana')
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

  it('getBalance returns SOL balance for known address', async () => {
    const balance = await provider.getBalance(KNOWN_SOL, 'solana')

    expect(balance.address).toBe(KNOWN_SOL)
    expect(balance.chain).toBe('solana')
    expect(balance.symbol).toBe('SOL')
    expect(balance.balance).toMatch(/^\d+$/)
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getTxHistory returns Solana transactions', async () => {
    const txs = await provider.getTxHistory(KNOWN_SOL, 'solana', { limit: 3 })

    expect(Array.isArray(txs)).toBe(true)
    expect(txs.length).toBeGreaterThan(0)
    expect(txs.length).toBeLessThanOrEqual(3)

    const tx = txs[0]!
    // Solana signatures are base58, 64-88 chars
    expect(tx.hash.length).toBeGreaterThanOrEqual(64)
    expect(tx.status).toBe('success')
    expect(tx.blockNumber).toBeGreaterThan(0)
  })

  it('getGasData returns fee data', async () => {
    const gas = await provider.getGasData!('solana')

    expect(gas.chain).toBe('solana')
    // May be 0 if no prioritization fees — that's valid
    expect(gas.safeGasPrice).toBeDefined()
  })

  it('getBalance throws for non-solana chain', async () => {
    await expect(
      provider.getBalance(KNOWN_SOL, 'eth'),
    ).rejects.toThrow()
  })
})
