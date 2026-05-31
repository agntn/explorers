/**
 * blocex — Blockscout integration tests
 *
 * Tests are live roundtrips against public Blockscout API.
 * Expected values are derived from API responses, not hand-written.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { create } from '../../src/core/registry.js'
import '../../src/providers/blockscout.js'

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

describe('blockscout provider', () => {
  let provider: ReturnType<typeof create>

  beforeAll(() => {
    provider = create('blockscout')
  })

  it('reports capabilities', () => {
    const caps = provider.capabilities()
    expect(caps.balances).toBe(true)
    expect(caps.txHistory).toBe(true)
    expect(caps.txDetail).toBe(true)
    expect(caps.contractInfo).toBe(true)
    expect(caps.tokenBalances).toBe(true)
    expect(caps.gasData).toBe(true)
    expect(caps.blockInfo).toBe(true)
  })

  it('getBalance returns valid structure for known address', async () => {
    const balance = await provider.getBalance(VITALIK, 'eth')

    expect(balance.address).toBe(VITALIK)
    expect(balance.chain).toBe('eth')
    expect(balance.symbol).toBe('ETH')
    // Balance should be a valid wei string (digits only)
    expect(balance.balance).toMatch(/^\d+$/)
    // Formatted should look like a decimal number
    expect(balance.balanceFormatted).toMatch(/^\d+(\.\d+)?$/)
    // Vitalik should have > 0 ETH
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0)
  })

  it('getTxHistory returns array of transactions', async () => {
    const txs = await provider.getTxHistory(VITALIK, 'eth', { limit: 3 })

    expect(Array.isArray(txs)).toBe(true)
    expect(txs.length).toBeLessThanOrEqual(3)
    expect(txs.length).toBeGreaterThan(0)

    const tx = txs[0]!
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/)
    expect(tx.from).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(typeof tx.blockNumber).toBe('number')
    expect(tx.blockNumber).toBeGreaterThan(0)
    expect(['success', 'failed', 'pending']).toContain(tx.status)
  })

  it('getContractInfo returns info for known contract', async () => {
    const info = await provider.getContractInfo(USDC_BASE, 'base')

    expect(info.address).toBe(USDC_BASE)
    expect(typeof info.isVerified).toBe('boolean')
    // USDC should be verified
    expect(info.isVerified).toBe(true)
    // Should have a name
    expect(info.name).toBeTruthy()
  })

  it('getGasData returns gas prices', async () => {
    const gas = await provider.getGasData!('eth')

    expect(gas.chain).toBe('eth')
    // At least one gas price field should be present
    const hasPrice = gas.safeGasPrice || gas.proposedGasPrice || gas.fastGasPrice
    expect(hasPrice).toBeTruthy()
    // Gas price should be a valid number string
    if (gas.proposedGasPrice) {
      expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0)
    }
  })

  it('getBalance throws on invalid address gracefully', async () => {
    // Blockscout returns 400 for invalid addresses
    await expect(
      provider.getBalance('not-an-address', 'eth'),
    ).rejects.toThrow()
  })
})
