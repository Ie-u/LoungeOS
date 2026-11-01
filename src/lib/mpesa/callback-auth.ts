import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedC2bCallbackToken(candidate: string) {
  const configured = process.env.MPESA_C2B_CALLBACK_TOKEN ?? ''
  if (!/^[a-f0-9]{64,128}$/i.test(configured) || configured.length !== candidate.length) return false
  return timingSafeEqual(Buffer.from(configured, 'utf8'), Buffer.from(candidate, 'utf8'))
}
