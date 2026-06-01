/**
 * blocex — Sui integration tests
 *
 * Live roundtrips against Sui public RPC.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/sui.js'

// Sui system address — always has SUI balance
const SUI_SYSTEM = '0x0000000000000000000000000000000000000000000000000000000000000002'

describe('sui provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('sui')
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

  it('getBalance returns SUI balance for system address', async () => {
    const balance = await provider.getBalance(SUI_SYSTEM, 'sui')

    expect(balance.address).toBe(SUI_SYSTEM)
    expect(balance.chain).toBe('sui')
    expect(balance.symbol).toBe('SUI')
    expect(balance.balance).toMatch(/^\d+$/)
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getGasData returns reference gas price', async () => {
    const gas = await provider.getGasData!('sui')

    expect(gas.chain).toBe('sui')
    expect(gas.proposedGasPrice).toBeTruthy()
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0)
  })

  it('getBlockInfo returns checkpoint data', async () => {
    const block = await provider.getBlockInfo!(1000000, 'sui')

    expect(block.number).toBe(1000000)
    expect(block.hash).toBeTruthy()
    expect(block.timestamp).toBeTruthy()
    expect(block.txCount).toBeGreaterThanOrEqual(0)
  })

  it('getBalance throws for non-sui chain', async () => {
    await expect(
      provider.getBalance(SUI_SYSTEM, 'eth'),
    ).rejects.toThrow()
  })
})
