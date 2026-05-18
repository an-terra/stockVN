/**
 * Nguồn giá: Yahoo (.VN/.HN) → VNDirect finfo-api → TCBS (fallback, dễ bị chặn geo).
 */

async function fetchWithTimeout(url, options = {}, ms = 22000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

export const RANGE_MAP = {
  '6mo': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
  '2y': { range: '2y', interval: '1d' },
  '5y': { range: '5y', interval: '1d' },
  max: { range: 'max', interval: '1d' },
}

const COUNTBACK = {
  '6mo': 160,
  '1y': 300,
  '2y': 560,
  '5y': 1300,
  max: 3000,
}

export function yahooTicker(symbol) {
  const s = symbol.trim().toUpperCase().replace(/\.VN$/i, '')
  return `${s}.VN`
}

export async function fetchYahooChart(ticker, rangeKey) {
  const params = new URLSearchParams(RANGE_MAP[rangeKey] ?? RANGE_MAP['2y'])
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`
  const r = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; vn-stock-web/0.1)' },
  })
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
  const data = await r.json()
  const chart = data.chart
  const results = chart?.result
  if (!results?.length) {
    const msg = chart?.error?.description ?? 'Không có result Yahoo'
    throw new Error(msg)
  }

  const res0 = results[0]
  const chartMeta = res0.meta ?? {}
  const yahooQuote = {
    regularMarketPrice:
      chartMeta.regularMarketPrice != null
        ? +chartMeta.regularMarketPrice
        : null,
    previousClose:
      chartMeta.previousClose != null ? +chartMeta.previousClose : null,
    chartPreviousClose:
      chartMeta.chartPreviousClose != null
        ? +chartMeta.chartPreviousClose
        : null,
  }
  const hasYahooQuote =
    (yahooQuote.regularMarketPrice != null &&
      Number.isFinite(yahooQuote.regularMarketPrice)) ||
    (yahooQuote.previousClose != null &&
      Number.isFinite(yahooQuote.previousClose)) ||
    (yahooQuote.chartPreviousClose != null &&
      Number.isFinite(yahooQuote.chartPreviousClose))

  const tsList = res0.timestamp ?? []
  const quote = res0.indicators?.quote?.[0] ?? {}
  const oRaw = quote.open ?? []
  const hRaw = quote.high ?? []
  const lRaw = quote.low ?? []
  const cRaw = quote.close ?? []
  const vRaw = quote.volume ?? []

  const dates = []
  const o = []
  const h = []
  const l = []
  const c = []
  const v = []

  for (let i = 0; i < tsList.length; i++) {
    const ov = oRaw[i]
    const hv = hRaw[i]
    const lv = lRaw[i]
    const cv = cRaw[i]
    let vv = vRaw[i]
    if (vv == null || Number.isNaN(+vv)) vv = 0
    if (
      ov == null ||
      hv == null ||
      lv == null ||
      cv == null ||
      Number.isNaN(+ov)
    )
      continue
    const d = new Date(tsList[i] * 1000)
    const iso = d.toISOString().slice(0, 10)
    dates.push(iso)
    o.push(+ov)
    h.push(+hv)
    l.push(+lv)
    c.push(+cv)
    v.push(+vv)
  }
  const base = { dates, o, h, l, c, v }
  return hasYahooQuote ? { ...base, yahooQuote } : base
}

function tcbsRowsToRaw(rows) {
  const dates = []
  const o = []
  const h = []
  const l = []
  const c = []
  const v = []
  for (const row of rows) {
    const ti =
      row.t ??
      row.time ??
      row.Time ??
      row.TradingDate ??
      row.tradingDate ??
      row.date
    let sec
    if (typeof ti === 'number') sec = ti > 1e12 ? Math.floor(ti / 1000) : ti
    else if (typeof ti === 'string') {
      const x = Date.parse(ti)
      if (Number.isNaN(x)) continue
      sec = Math.floor(x / 1000)
    } else continue

    const open = row.open ?? row.o ?? row.Open
    const high = row.high ?? row.h ?? row.High ?? row.max
    const low = row.low ?? row.l ?? row.Low ?? row.min
    const close = row.close ?? row.c ?? row.Close
    let vol = row.volume ?? row.v ?? row.Volume ?? row.accumulatedVolume
    if (vol == null || Number.isNaN(+vol)) vol = 0
    if (open == null || high == null || low == null || close == null)
      continue
    dates.push(new Date(sec * 1000).toISOString().slice(0, 10))
    o.push(+open)
    h.push(+high)
    l.push(+low)
    c.push(+close)
    v.push(+vol)
  }
  return { dates, o, h, l, c, v }
}

function extractTcbsRows(json) {
  if (Array.isArray(json)) return json
  if (Array.isArray(json?.data)) return json.data
  if (Array.isArray(json?.results)) return json.results
  if (Array.isArray(json?.result)) return json.result
  if (Array.isArray(json?.values)) return json.values
  if (Array.isArray(json?.series)) return json.series
  return []
}

export async function fetchTcbsChart(symbol, rangeKey) {
  const sym = symbol.trim().toUpperCase().replace(/\.VN$/i, '')
  const countBack = COUNTBACK[rangeKey] ?? COUNTBACK['2y']
  const to = Math.floor(Date.now() / 1000)
  const from = to - countBack * 86400
  const qs = (res) =>
    `symbol=${encodeURIComponent(sym)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${to}&countBack=${countBack}`
  const urls = [
    `https://apipubaws.tcbs.com.vn/stock-insight/v1/technical/history?${qs('D')}`,
    `https://apipubaws.tcbs.com.vn/stock-insight/v1/technical/history?${qs('1D')}`,
    `https://apipubaws.tcbs.com.vn/stock-insight/v1/technical/history?${qs('1440')}`,
  ]
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://tcinvest.tcbs.com.vn/',
    Origin: 'https://tcinvest.tcbs.com.vn',
  }

  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url, { headers })
      if (!r.ok) continue
      const j = await r.json()
      const rows = extractTcbsRows(j)
      const raw = tcbsRowsToRaw(rows)
      if (raw.c.length > 12) return raw
    } catch {
      /* thử URL khác */
    }
  }
  throw new Error('TCBS không trả dữ liệu (mạng/Geo/IP hoặc API thay đổi)')
}

export async function fetchVndirectChart(symbol, rangeKey) {
  const sym = symbol.trim().toUpperCase().replace(/\.VN$/i, '')
  const n = COUNTBACK[rangeKey] ?? COUNTBACK['2y']
  const end = new Date()
  const start = new Date(end.getTime() - (n + 120) * 86400000)
  const toStr = end.toISOString().slice(0, 10)
  const fromStr = start.toISOString().slice(0, 10)
  const q = `code:${sym}~date:gte:${fromStr}~date:lte:${toStr}`
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
  }

  const pageSize = 500
  async function pullFrom(startPage) {
    const rows = []
    for (let page = startPage; page < startPage + 40; page++) {
      const params = new URLSearchParams({
        sort: 'date',
        size: String(pageSize),
        page: String(page),
        q,
      })
      const url = `https://finfo-api.vndirect.com.vn/v4/stock_prices/?${params}`
      const r = await fetchWithTimeout(url, { headers })
      if (!r.ok) throw new Error(`VNDirect HTTP ${r.status}`)
      const j = await r.json()
      const chunk = Array.isArray(j?.data) ? j.data : []
      if (!chunk.length) break
      rows.push(...chunk)
      if (chunk.length < pageSize) break
      if (rows.length >= n + 80) break
    }
    return rows
  }

  let allRows = await pullFrom(0)
  if (!allRows.length) allRows = await pullFrom(1)

  if (!allRows.length) throw new Error('VNDirect không có dữ liệu (rỗng)')

  const items = allRows
    .map((row) => {
      const d = row.date ?? row.tradingDate ?? row.trading_date
      const day = d != null ? String(d).slice(0, 10) : null
      const open = row.open ?? row.o
      const high = row.high ?? row.h ?? row.ceiling
      const low = row.low ?? row.l ?? row.floor
      const close = row.close ?? row.c
      let vol =
        row.dealVolume ??
        row.nmVolume ??
        row.nmTotalTradedQty ??
        row.volume ??
        row.totalVolume ??
        row.vol
      if (vol == null || Number.isNaN(+vol)) vol = 0
      if (!day || open == null || high == null || low == null || close == null)
        return null
      return {
        day,
        open: +open,
        high: +high,
        low: +low,
        close: +close,
        vol: +vol,
      }
    })
    .filter(Boolean)

  const byDay = new Map()
  for (const it of items) {
    byDay.set(it.day, it)
  }
  const uniqueSorted = [...byDay.values()].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  )

  const dates = []
  const o = []
  const h = []
  const l = []
  const c = []
  const v = []
  for (const it of uniqueSorted) {
    dates.push(it.day)
    o.push(it.open)
    h.push(it.high)
    l.push(it.low)
    c.push(it.close)
    v.push(it.vol)
  }

  if (c.length < 12) throw new Error('VNDirect thiếu số phiên đủ dài')
  return { dates, o, h, l, c, v }
}

/** Thử thêm hậu tố Yahoo (một số mã HNX/UPCOM từng dùng .HN). */
const YAHOO_TICKER_TRY = (s) => {
  const u = s.trim().toUpperCase().replace(/\.VN$/i, '')
  return [`${u}.VN`, `${u}.HN`]
}

export async function fetchUnifiedChart(displaySymbol, rangeKey) {
  const base = displaySymbol.trim().toUpperCase().replace(/\.VN$/i, '')
  const failures = []

  for (const yTicker of YAHOO_TICKER_TRY(base)) {
    try {
      const raw = await fetchYahooChart(yTicker, rangeKey)
      if (raw.c.length > 15) return { raw, provider: 'yahoo' }
    } catch (e) {
      failures.push(`${yTicker}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  try {
    const raw = await fetchVndirectChart(base, rangeKey)
    if (raw.c.length >= 12) return { raw, provider: 'vndirect' }
  } catch (e) {
    failures.push(
      `VNDirect: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  try {
    const raw = await fetchTcbsChart(base, rangeKey)
    return { raw, provider: 'tcbs' }
  } catch (e) {
    failures.push(`TCBS: ${e instanceof Error ? e.message : String(e)}`)
  }

  throw new Error(
    `Không lấy được giá cho ${base}. Đã thử Yahoo (.VN/.HN), VNDirect, TCBS. ${failures.join(' | ')}`,
  )
}