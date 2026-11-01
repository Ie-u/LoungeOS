import { describe, expect, it } from 'vitest'
import { getSessionState } from './session-status'

describe('getSessionState', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  it('marks a session overdue using the stored end time', () => {
    expect(getSessionState('2026-11-01T11:59:59Z', now)).toBe('overdue')
  })
  it('warns when a session ends within ten minutes', () => {
    expect(getSessionState('2026-11-01T12:09:00Z', now)).toBe('ending-soon')
  })
  it('keeps a session active when it ends later', () => {
    expect(getSessionState('2026-11-01T13:00:00Z', now)).toBe('active')
  })
  it('rejects invalid timestamps', () => {
    expect(() => getSessionState('not a date', now)).toThrow('Invalid session end timestamp.')
  })
})
