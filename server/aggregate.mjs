/**
 * Gộp chuỗi OHLCV ngày → nến tuần / tháng (đóng tại phiên cuối cùng của kỳ).
 * Tuần: ISO, thứ Hai là đầu tuần (khớp lịch giao dịch VN thường dùng).
 */

/** @param {string} iso YYYY-MM-DD */
function weekBucketKey(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d)
  const dow = new Date(utc).getUTCDay()
  const mondayDist = (dow + 6) % 7
  const mon = new Date(utc - mondayDist * 86400000)
  return mon.toISOString().slice(0, 10)
}

/** @param {string} iso */
function monthBucketKey(iso) {
  return iso.slice(0, 7)
}

/**
 * @param {{ dates: string[], o: number[], h: number[], l: number[], c: number[], v: number[] }} raw
 * @param {'1d' | '1w' | '1M'} interval
 */
export function aggregateRawOHLCV(raw, interval) {
  if (interval === '1d' || interval === 'd') return raw
  const { dates, o, h, l, c, v } = raw
  const n = dates.length
  if (!n) return raw

  const buckets = new Map()
  for (let i = 0; i < n; i++) {
    const key =
      interval === '1w' || interval === 'w'
        ? weekBucketKey(dates[i])
        : monthBucketKey(dates[i])
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(i)
  }

  const sortedKeys = [...buckets.keys()].sort()
  const out = { dates: [], o: [], h: [], l: [], c: [], v: [] }

  for (const key of sortedKeys) {
    const idxs = buckets.get(key).slice().sort((a, b) => a - b)
    const firstI = idxs[0]
    const lastI = idxs[idxs.length - 1]
    out.dates.push(dates[lastI])
    out.o.push(o[firstI])
    let hi = h[firstI]
    let lo = l[firstI]
    let vol = 0
    for (const ii of idxs) {
      hi = Math.max(hi, h[ii])
      lo = Math.min(lo, l[ii])
      vol += v[ii]
    }
    out.h.push(hi)
    out.l.push(lo)
    out.c.push(c[lastI])
    out.v.push(vol)
  }

  return out
}

export function normalizeChartInterval(q) {
  const s = String(q ?? '1d').trim().toLowerCase()
  if (s === '1d' || s === 'd' || s === 'day' || s === 'ngay') return '1d'
  if (s === '1w' || s === 'w' || s === 'week' || s === 'tuan') return '1w'
  if (s === '1m' || s === 'm' || s === 'month' || s === 'thang') return '1M'
  return null
}
