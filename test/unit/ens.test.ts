/**
 * blocex — ENS resolution tests
 *
 * Live roundtrips against public ENS APIs.
 */
import { describe, it, expect } from 'vitest'
import { isEnsName, isAddress, resolveEns } from '../../src/core/ens.js'

describe('ens helpers', () => {
  it('isEnsName recognizes .eth names', () => {
    expect(isEnsName('vitalik.eth')).toBe(true)
    expect(isEnsName('oritwoen.eth')).toBe(true)
    expect(isEnsName('sub.domain.eth')).toBe(true)
    expect(isEnsName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false)
    expect(isEnsName('notens')).toBe(false)
    expect(isEnsName('.eth')).toBe(false)
  })

  it('isAddress recognizes 0x addresses', () => {
    expect(isAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(true)
    expect(isAddress('0x0000000000000000000000000000000000000000')).toBe(true)
    expect(isAddress('vitalik.eth')).toBe(false)
    expect(isAddress('not-an-address')).toBe(false)
  })

  it('resolveEns resolves vitalik.eth to known address', async () => {
    const addr = await resolveEns('vitalik.eth')
    expect(addr).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
  })

  it('resolveEns returns null for non-existent name', async () => {
    const addr = await resolveEns('this-name-definitely-does-not-exist-12345678.eth')
    expect(addr).toBeNull()
  }, 15000)
})
