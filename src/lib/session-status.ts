export type SessionState = 'active' | 'ending-soon' | 'overdue' | 'ended'

export function getSessionState(endsAt: string, now = Date.now(), warningMinutes = 10): SessionState {
  const end = Date.parse(endsAt)
  if (!Number.isFinite(end)) throw new Error('Invalid session end timestamp.')
  if (end <= now) return 'overdue'
  if (end - now <= warningMinutes * 60_000) return 'ending-soon'
  return 'active'
}
