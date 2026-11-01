export function normalizeKenyanPhone(rawPhone: string) {
  const compact = rawPhone.replace(/[\s+()-]/g, '')
  const normalized = compact.startsWith('0') ? `254${compact.slice(1)}` : compact
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null
}

export function kesToCents(value: string | number | undefined) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

export function darajaTransactedAt(value: string | undefined) {
  if (!value || !/^\d{14}$/.test(value)) return null
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(4, 6)); const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10)); const minute = Number(value.slice(10, 12)); const second = Number(value.slice(12, 14))
  const date = new Date(Date.UTC(year, month - 1, day, hour - 3, minute, second))
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString()
}

export function darajaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}${value('month')}${value('day')}${value('hour')}${value('minute')}${value('second')}`
}
