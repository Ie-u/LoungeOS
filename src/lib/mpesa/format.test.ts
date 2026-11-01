import { describe, expect, it } from 'vitest'
import { darajaTimestamp, darajaTransactedAt, kesToCents, normalizeKenyanPhone } from './format'

describe('M-Pesa input formatting', () => {
  it('normalizes supported Kenyan mobile formats', () => {
    expect(normalizeKenyanPhone('0712 345 678')).toBe('254712345678')
    expect(normalizeKenyanPhone('+254 112 345 678')).toBe('254112345678')
    expect(normalizeKenyanPhone('12345')).toBeNull()
  })

  it('converts KES amounts to integer cents without accepting excess precision', () => {
    expect(kesToCents('125')).toBe(12500)
    expect(kesToCents('12.5')).toBe(1250)
    expect(kesToCents('12.50')).toBe(1250)
    expect(kesToCents('12.500')).toBeNull()
    expect(kesToCents('0')).toBeNull()
  })

  it('converts Safaricom transaction time from Nairobi time to UTC', () => {
    expect(darajaTransactedAt('20261102153000')).toBe('2026-11-02T12:30:00.000Z')
    expect(darajaTransactedAt('20260230153000')).toBeNull()
    expect(darajaTransactedAt('invalid')).toBeNull()
  })

  it('formats the STK password timestamp in Nairobi time', () => {
    expect(darajaTimestamp(new Date('2026-11-02T09:15:00.000Z'))).toBe('20261102121500')
  })
})
