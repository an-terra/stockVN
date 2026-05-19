// Server — Yahoo → VNDirect → TCBS, quét lịch VN

import cors from 'cors'
import express from 'express'
import cron from 'node-cron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fetchUnifiedChart, yahooTicker } from './providers.mjs'
import {
  DEFAULT_MIN_AVG_VOLUME,
  LIQUID_CANDIDATES,
  avgVolumeLast,
} from './universe.mjs'
import { aggregateRawOHLCV, normalizeChartInterval } from './aggregate.mjs'
import {
  addTrackItem,
  deleteTrackItem,
  readTrackList,
  todayVN,
  canEvaluateRecord,
  pnlVsSignal,
} from './trackStore.mjs'
import {
  computePayload,
  buildWarnings,
  buildQuoteSnapshot,
  normalizeSignalMode,
} from './signalPayload.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Khi có `frontend/dist` (Docker / production), Express phục vụ SPA cùng cổng với `/api`. */
const WEB_DIST = join(__dirname, '..', 'frontend', 'dist')
const HAS_WEB_DIST = existsSync(join(WEB_DIST, 'index.html'))
const SCAN_DIR = join(__dirname, 'data')
const SCAN_FILE = join(SCAN_DIR, 'latest-scan.json')
const UNIVERSE_CACHE_FILE = join(SCAN_DIR, 'universe-cache.json')
const ATC_ALERT_FILE = join(SCAN_DIR, 'atc-alerts-latest.json')

const DEFAULT_WATCHLIST = [
  'VCB',
  'HDB',
  'TCB',
  'BID',
  'CTG',
  'VPB',
  'STB',
  'MSN',
  'VHM',
  'VIC',
  'VRE',
  'HPG',
  'FPT',
  'MWG',
  'PLX',
  'GAS',
  'POW',
  'SAB',
  'VNM',
  'PNJ',
  'GMD',
  'DIG',
  'CEO',
  'SSI',
  'VND',
  'HCM',
  'KDH',
  'NLG',
  'PHR',
  'DGC',
]

const CRON_TZ = 'Asia/Ho_Chi_Minh'

async function fetchMarkForTrack(symDisplay) {
  const { raw, provider } = await fetchUnifiedChart(symDisplay, '1mo')
  if (!raw.c.length) return null
  const agg = aggregateRawOHLCV(raw, '1d')
  if (raw.yahooQuote) agg.yahooQuote = raw.yahooQuote
  const lastI = agg.c.length - 1
  const snap = buildQuoteSnapshot(agg, provider, '1d')
  return {
    markPrice: snap.currentPrice ?? agg.c[lastI],
    markDate: agg.dates[lastI],
    dataProvider: provider,
  }
}

function readUniverseCache() {
  try {
    if (!existsSync(UNIVERSE_CACHE_FILE)) return null
    return JSON.parse(readFileSync(UNIVERSE_CACHE_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function refreshUniverseCache(minVol = DEFAULT_MIN_AVG_VOLUME) {
  ensureScanDir()
  const entries = []
  const batchSize = 4
  for (let i = 0; i < LIQUID_CANDIDATES.length; i += batchSize) {
    const chunk = LIQUID_CANDIDATES.slice(i, i + batchSize)
    const part = await Promise.all(
      chunk.map(async (sym) => {
        try {
          const { raw, provider } = await fetchUnifiedChart(sym, '1y')
          if (raw.c.length < 25) return null
          const avg = avgVolumeLast(raw, 20)
          if (avg < minVol) return null
          return {
            symbol: sym,
            avgVolume20: Math.round(avg),
            dataProvider: provider,
          }
        } catch {
          return null
        }
      }),
    )
    for (const p of part) if (p) entries.push(p)
    await new Promise((r) => setTimeout(r, 320))
  }
  entries.sort((a, b) => b.avgVolume20 - a.avgVolume20)
  const out = {
    refreshedAt: new Date().toISOString(),
    minAvgVolume: minVol,
    count: entries.length,
    symbols: entries,
  }
  writeFileSync(UNIVERSE_CACHE_FILE, JSON.stringify(out, null, 2), 'utf8')
  return out
}

/** Giới hạn tham số query /api/picks (tránh giá trị vô lý / spam). */
function clampPickQueryParam(value, lo, hi, fallback) {
  const x = Number(value)
  if (!Number.isFinite(x)) return fallback
  return Math.min(hi, Math.max(lo, x))
}

/** Query signalMode=strict | balanced (mặc định). */
function parseSignalModeQuery(q) {
  return normalizeSignalMode(q?.signalMode ?? q?.mode)
}

/** Query: minForwardWin, weakMuaMinConfluence (alias minConfluenceKeepWeakMua), forwardMinSamples */
function parsePicksFilterQuery(query) {
  const minForwardWin = clampPickQueryParam(query.minForwardWin, 35, 62, 45)
  const conflRaw = query.weakMuaMinConfluence ?? query.minConfluenceKeepWeakMua
  const weakMuaMinConfluence = clampPickQueryParam(conflRaw, 55, 88, 70)
  const forwardMinSamples = Math.round(
    clampPickQueryParam(query.forwardMinSamples, 5, 35, 10),
  )
  return { minForwardWin, weakMuaMinConfluence, forwardMinSamples }
}

async function snapshotSymbolCompact(sym) {
  const d = sym.trim().toUpperCase()
  const y = yahooTicker(d)
  try {
    const { raw, provider } = await fetchUnifiedChart(d, '2y')
    if (!raw.c.length) {
      return {
        symbol: d,
        error: 'Không có dữ liệu',
        warnings: ['Không tải được chuỗi giá.'],
      }
    }
    const payload = computePayload(raw, d, y, provider)
    const adv = payload.advice
    return {
      symbol: d,
      action: adv?.action ?? null,
      confluenceScore: adv?.confluence?.score ?? null,
      confluenceBias: adv?.confluence?.bias ?? null,
      warnings: buildWarnings(adv, payload.meta),
      dataProvider: payload.meta.dataProvider,
      lastDate: payload.meta.lastDate,
      lastClose: payload.meta.lastClose,
      trendOk: payload.meta.trendOk,
      rsi: payload.meta.rsi,
    }
  } catch (e) {
    return {
      symbol: d,
      error: e instanceof Error ? e.message : String(e),
      warnings: [
        e instanceof Error ? e.message : String(e),
      ],
    }
  }
}

function ensureScanDir() {
  if (!existsSync(SCAN_DIR)) mkdirSync(SCAN_DIR, { recursive: true })
}

async function runScheduledScan(trigger = 'cron') {
  const now = new Date().toISOString()
  const results = []
  for (const sym of DEFAULT_WATCHLIST) {
    try {
      const y = yahooTicker(sym)
      const { raw, provider } = await fetchUnifiedChart(sym, '2y')
      if (!raw.c.length) {
        results.push({
          symbol: sym,
          error: 'Không có dữ liệu',
          scannedAt: now,
        })
        continue
      }
      const payload = computePayload(raw, sym, y, provider)
      results.push({
        symbol: sym,
        advice: payload.advice,
        meta: payload.meta,
        warnings: buildWarnings(payload.advice, payload.meta),
        scannedAt: now,
      })
    } catch (e) {
      results.push({
        symbol: sym,
        error: e instanceof Error ? e.message : String(e),
        scannedAt: now,
      })
    }
  }
  ensureScanDir()
  const out = {
    generatedAt: now,
    timezone: CRON_TZ,
    trigger,
    count: results.length,
    scheduleNote:
      'Tự động 9:30, 12:00, 14:00 Thứ 2–Thứ 6 (Asia/Ho_Chi_Minh). Ngày nghỉ lễ VN không loại trừ.',
    results,
  }
  writeFileSync(SCAN_FILE, JSON.stringify(out, null, 2), 'utf8')
  console.log(
    `[scan:${trigger}] ${now} — ${results.length} mã → ${SCAN_FILE}`,
  )
  return out
}

/** Cảnh báo snapshot trong khung ATC (~14:30–14:45 giờ VN): thanh khoản/lệnh thường khác ngày thường. */
async function runAtcWindowScan(trigger = 'cron-atc') {
  ensureScanDir()
  const now = new Date().toISOString()
  const batchSize = 4
  const items = []
  for (let i = 0; i < DEFAULT_WATCHLIST.length; i += batchSize) {
    const chunk = DEFAULT_WATCHLIST.slice(i, i + batchSize)
    const part = await Promise.all(
      chunk.map(async (sym) => {
        try {
          const row = await snapshotSymbolCompact(sym)
          const alertLevel = row.error
            ? 'error'
            : row.warnings?.length
              ? 'warn'
              : 'info'
          return { ...row, alertLevel, scannedAt: now }
        } catch (e) {
          return {
            symbol: sym,
            error: e instanceof Error ? e.message : String(e),
            alertLevel: 'error',
            warnings: ['Lỗi quét'],
            scannedAt: now,
          }
        }
      }),
    )
    items.push(...part)
    await new Promise((r) => setTimeout(r, 280))
  }
  const highlighted = items.filter(
    (x) =>
      x.alertLevel === 'error' ||
      x.alertLevel === 'warn' ||
      x.action === 'BÁN' ||
      (x.rsi != null && x.rsi >= 70),
  )
  const out = {
    generatedAt: now,
    timezone: CRON_TZ,
    trigger,
    windowLabel: 'ATC ~14:30–14:45 (Asia/Ho_Chi_Minh)',
    disclaimer:
      'Khớp ATC: dòng tiền và giá có thể bất thường. Cảnh báo chỉ từ rule kỹ thuật — không phải khuyến nghị đặt/hủy lệnh.',
    count: items.length,
    items,
    highlightedCount: highlighted.length,
    highlighted,
  }
  writeFileSync(ATC_ALERT_FILE, JSON.stringify(out, null, 2), 'utf8')
  console.log(`[atc:${trigger}] ${now} — ${items.length} mã → ${ATC_ALERT_FILE}`)
  return out
}

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]
const EXTRA_CORS = (process.env.CORS_ORIGINS ?? '')
  .split(/[,]/)
  .map((s) => s.trim())
  .filter(Boolean)

const app = express()
app.use(
  cors({
    origin: [...DEFAULT_CORS_ORIGINS, ...EXTRA_CORS],
  }),
)
app.use(express.json())

app.get('/api/watchlist', (req, res) => {
  res.json({ symbols: DEFAULT_WATCHLIST })
})

/** Danh sách mã thanh khoản (đã lọc KL) sau khi refresh cache. */
app.get('/api/universe', (req, res) => {
  const cached = readUniverseCache()
  if (!cached) {
    return res.json({
      refreshedAt: null,
      minAvgVolume: DEFAULT_MIN_AVG_VOLUME,
      count: 0,
      symbols: [],
      liquidCandidatesCount: LIQUID_CANDIDATES.length,
      hint: `Chưa có cache. Gọi POST /api/universe/refresh để quét ${LIQUID_CANDIDATES.length} mã ứng viên (KL TB 20 phiên ≥ ${DEFAULT_MIN_AVG_VOLUME}).`,
    })
  }
  res.json({
    ...cached,
    liquidCandidatesCount: LIQUID_CANDIDATES.length,
  })
})

app.post('/api/universe/refresh', async (req, res) => {
  try {
    const minV = Number(req.body?.minAvgVolume)
    const minVol = Number.isFinite(minV) && minV > 0 ? minV : DEFAULT_MIN_AVG_VOLUME
    const out = await refreshUniverseCache(minVol)
    res.json({ ok: true, ...out })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

/**
 * Gợi ý mã xem xét MUA (rule + điểm hội tụ). Có thể chậm (~vài chục request).
 * Ưu tiên universe đã refresh; không có cache thì quét tập ứng viên đầu danh sách.
 */
app.get('/api/picks', async (req, res) => {
  try {
    const limit = Math.min(25, Math.max(5, Number(req.query.limit) || 15))
    const { minForwardWin, weakMuaMinConfluence, forwardMinSamples } =
      parsePicksFilterQuery(req.query)
    const pickSignalMode = parseSignalModeQuery(req.query)
    const cached = readUniverseCache()
    const pool = cached?.symbols?.length
      ? cached.symbols.map((x) => x.symbol)
      : LIQUID_CANDIDATES.slice(0, 44)
    const batchSize = 3
    const scored = []
    for (let i = 0; i < pool.length; i += batchSize) {
      const chunk = pool.slice(i, i + batchSize)
      const part = await Promise.all(
        chunk.map(async (sym) => {
          try {
            const { raw, provider } = await fetchUnifiedChart(sym, '2y')
            if (raw.c.length < 40) return null
            const y = yahooTicker(sym)
            const payload = computePayload(raw, sym, y, provider, '1d', {
              muaForwardMinSamples: forwardMinSamples,
              signalMode: pickSignalMode,
            })
            const adv = payload.advice
            if (!adv) return null
            const sc = adv.confluence.score
            const pick =
              adv.action === 'MUA' ||
              sc >= 63 ||
              (sc >= 58 && adv.action === 'CHỜ' && payload.meta.trendOk)
            if (!pick) return null
            const blend = adv.buyForwardOutlook?.blend2_3Sessions
            if (
              adv.action === 'MUA' &&
              blend?.enough &&
              blend.winRatePercent != null &&
              blend.winRatePercent < minForwardWin &&
              sc < weakMuaMinConfluence
            ) {
              return null
            }
            return {
              symbol: sym,
              action: adv.action,
              confluenceScore: sc,
              confluenceBias: adv.confluence.bias,
              summary: adv.summary.slice(0, 200),
              warnings: buildWarnings(adv, payload.meta, {
                forwardWinWeakBelow: minForwardWin,
              }),
              dataProvider: payload.meta.dataProvider,
              buyForwardOutlook: adv.buyForwardOutlook ?? undefined,
            }
          } catch {
            return null
          }
        }),
      )
      for (const p of part) if (p) scored.push(p)
      await new Promise((r) => setTimeout(r, 280))
    }
    scored.sort((a, b) => b.confluenceScore - a.confluenceScore)
    res.json({
      generatedAt: new Date().toISOString(),
      universeFromCache: Boolean(cached?.symbols?.length),
      pickFilters: {
        signalMode: pickSignalMode,
        minForwardWin,
        weakMuaMinConfluence,
        forwardMinSamples,
        queryHintVi:
          'signalMode: balanced (mặc định) hoặc strict — lọc MUA/BÁN chặt hơn (đa xác nhận, điểm base, MACD khi cắt EMA20). minForwardWin: lọc MUA khi lịch sử ~2–3 phiên có tỷ lệ “đóng > đóng vào” thấp (mặc định 45%). weakMuaMinConfluence: điểm hội tụ tối thiểu để vẫn giữ MUA “forward yếu” (mặc định 70). forwardMinSamples: số lần tín hiệu MUA tối thiểu mỗi nhánh 2 nến/3 nến (mặc định 10).',
      },
      picks: scored.slice(0, limit),
    })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

/** Snapshot gọn: action, điểm, cảnh báo — cho watchlist phía client. */
app.get('/api/snapshot', async (req, res) => {
  const raw = String(req.query.symbols ?? '').trim()
  if (!raw) {
    return res.status(400).json({ detail: 'Thiếu tham số symbols' })
  }
  const symbols = [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length >= 2 && s.length <= 16),
    ),
  ].slice(0, 24)
  if (!symbols.length) {
    return res.status(400).json({ detail: 'Không có mã hợp lệ' })
  }
  try {
    const batchSize = 4
    const items = []
    for (let i = 0; i < symbols.length; i += batchSize) {
      const chunk = symbols.slice(i, i + batchSize)
      const part = await Promise.all(chunk.map((s) => snapshotSymbolCompact(s)))
      items.push(...part)
      await new Promise((r) => setTimeout(r, 260))
    }
    res.json({ generatedAt: new Date().toISOString(), items })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/chart', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').trim()
  const period = String(req.query.period ?? '2y')
  const intervalRaw = normalizeChartInterval(req.query.interval)
  if (!intervalRaw) {
    return res.status(400).json({
      detail:
        'interval không hợp lệ (dùng 1d|1w|1M hoặc ngay|tuan|thang).',
    })
  }
  if (!/^(6mo|1y|2y|5y|max)$/.test(period)) {
    return res.status(400).json({ detail: 'period không hợp lệ' })
  }
  if (symbol.length < 2 || symbol.length > 16) {
    return res.status(400).json({ detail: 'symbol không hợp lệ' })
  }

  const symDisplay = symbol.toUpperCase()
  const sym = yahooTicker(symbol)

  try {
    const { raw, provider } = await fetchUnifiedChart(symDisplay, period)
    if (!raw.c.length) {
      return res.status(404).json({ detail: `Không có dữ liệu cho mã ${symDisplay}` })
    }
    const agg = aggregateRawOHLCV(raw, intervalRaw)
    if (raw.yahooQuote) agg.yahooQuote = raw.yahooQuote
    if (!agg.c.length) {
      return res.status(404).json({ detail: 'Không đủ dữ liệu sau khi gộp nến' })
    }
    res.json(
      computePayload(agg, symDisplay, sym, provider, intervalRaw, {
        signalMode: parseSignalModeQuery(req.query),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Not Found') || msg.includes('404'))
      return res.status(404).json({ detail: msg })
    res.status(502).json({ detail: `Lỗi tải dữ liệu: ${msg}` })
  }
})

app.get('/api/alerts/atc/latest', (req, res) => {
  try {
    if (!existsSync(ATC_ALERT_FILE)) {
      return res.json({
        generatedAt: null,
        timezone: CRON_TZ,
        trigger: null,
        windowLabel: 'ATC',
        disclaimer:
          'Chưa có lần quét ATC. Chờ phiên 14:30–14:45 (T2–T6) hoặc POST /api/alerts/atc/run.',
        count: 0,
        highlightedCount: 0,
        highlighted: [],
        items: [],
      })
    }
    const raw = readFileSync(ATC_ALERT_FILE, 'utf8')
    res.json(JSON.parse(raw))
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/alerts/atc/run', async (req, res) => {
  try {
    const out = await runAtcWindowScan('manual')
    res.json({ ok: true, ...out })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/scan/latest', (req, res) => {
  try {
    if (!existsSync(SCAN_FILE)) {
      return res.json({
        generatedAt: null,
        timezone: CRON_TZ,
        trigger: null,
        scheduleNote: 'Chưa có file quét. Chờ lịch cron hoặc gọi POST /api/scan/run.',
        count: 0,
        results: [],
      })
    }
    const raw = readFileSync(SCAN_FILE, 'utf8')
    res.json(JSON.parse(raw))
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/scan/run', async (req, res) => {
  try {
    const out = await runScheduledScan('manual')
    res.json({ ok: true, ...out })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/schedule', (req, res) => {
  res.json({
    timezone: CRON_TZ,
    crons: [
      { time: '09:30', days: 'Thứ 2–Thứ 6', expr: '30 9 * * 1-5', label: 'Quét watchlist' },
      { time: '12:00', days: 'Thứ 2–Thứ 6', expr: '0 12 * * 1-5', label: 'Quét watchlist' },
      { time: '14:00', days: 'Thứ 2–Thứ 6', expr: '0 14 * * 1-5', label: 'Quét watchlist' },
      {
        time: '14:33, 14:38, 14:43',
        days: 'Thứ 2–Thứ 6',
        expr: '33,38,43 14 * * 1-5',
        label: 'Cảnh báo ATC (khoảng 14:30–14:45)',
      },
    ],
    note:
      'Giờ Asia/Ho_Chi_Minh. Giá: Yahoo → VNDirect → TCBS. Biểu đồ tuần/tháng = gộp từ nến ngày.',
    atcNote:
      'Phiên khớp ATC: khối lượng/giá có thể khác phiên liên tục — job cảnh báo chỉ mang tính kỹ thuật.',
  })
})

async function probeSymbol(displayCode) {
  const d = displayCode.toUpperCase()
  const y = yahooTicker(d)
  try {
    const { raw, provider } = await fetchUnifiedChart(d, '1y')
    return {
      symbol: d,
      yahoo: y,
      dataProvider: provider,
      ok: raw.c.length > 5,
      barCount: raw.c.length,
    }
  } catch (e) {
    return {
      symbol: d,
      yahoo: y,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Kiểm tra từng mã trong watchlist (Yahoo → VNDirect → TCBS). */
app.get('/api/symbols/validate', async (req, res) => {
  const batchSize = 4
  const results = []
  try {
    for (let i = 0; i < DEFAULT_WATCHLIST.length; i += batchSize) {
      const chunk = DEFAULT_WATCHLIST.slice(i, i + batchSize)
      const part = await Promise.all(chunk.map((s) => probeSymbol(s)))
      results.push(...part)
      await new Promise((r) => setTimeout(r, 400))
    }
    const failed = results.filter((r) => !r.ok)
    res.json({
      checkedAt: new Date().toISOString(),
      total: results.length,
      failedCount: failed.length,
      hint: 'Ưu tiên Yahoo; nếu không đủ dữ liệu thì VNDirect rồi TCBS (TCBS dễ lỗi nếu IP ngoài VN).',
      results,
    })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/track', async (req, res) => {
  try {
    const items = readTrackList()
    const tday = todayVN()
    const out = []
    for (const rec of items) {
      let mark = null
      try {
        mark = await fetchMarkForTrack(rec.symbol)
      } catch {
        mark = null
      }
      const { pnlPercent, signalCorrect } = pnlVsSignal(
        rec.action,
        rec.entryPrice,
        mark?.markPrice,
      )
      const evalReady = canEvaluateRecord(rec, tday)
      out.push({
        ...rec,
        markPrice: mark?.markPrice ?? null,
        markDate: mark?.markDate ?? null,
        markProvider: mark?.dataProvider ?? null,
        pnlPercent: evalReady ? pnlPercent : null,
        signalCorrect: evalReady ? signalCorrect : null,
        evalReady,
        todayVN: tday,
      })
      await new Promise((r) => setTimeout(r, 320))
    }
    const withPnl = out.filter((x) => x.evalReady && x.pnlPercent != null)
    const directional = withPnl.filter((x) => x.action !== 'CHỜ')
    const correct = directional.filter((x) => x.signalCorrect).length
    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        total: out.length,
        evalReadyCount: withPnl.length,
        correctCount: correct,
        winRatePercent:
          directional.length > 0
            ? Math.round((correct / directional.length) * 1000) / 10
            : null,
      },
      items: out,
    })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/track', async (req, res) => {
  try {
    const body = req.body ?? {}
    const sym = String(body.symbol ?? '')
      .trim()
      .toUpperCase()
      .replace(/\.VN$/i, '')
    const rawAct = String(body.action ?? 'MUA').trim().toUpperCase()
    const action =
      rawAct === 'BÁN' ? 'BÁN' : rawAct === 'CHỜ' ? 'CHỜ' : 'MUA'
    if (sym.length < 2 || sym.length > 16) {
      return res.status(400).json({ detail: 'Mã không hợp lệ' })
    }
    let entryDate = String(body.entryDate ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      entryDate = todayVN()
    }
    let entryPrice = body.entryPrice != null ? Number(body.entryPrice) : NaN
    if (!Number.isFinite(entryPrice)) {
      const m = await fetchMarkForTrack(sym)
      if (!m?.markPrice) {
        return res.status(502).json({ detail: 'Không lấy được giá vào' })
      }
      entryPrice = m.markPrice
    }
    const rec = addTrackItem({
      symbol: sym,
      action,
      entryDate,
      entryPrice,
      note: body.note,
    })
    res.json({ ok: true, item: rec })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.delete('/api/track/:id', (req, res) => {
  try {
    const before = readTrackList().length
    deleteTrackItem(String(req.params.id ?? ''))
    const after = readTrackList().length
    res.json({ ok: true, removed: before > after ? 1 : 0 })
  } catch (e) {
    res.status(500).json({
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

if (HAS_WEB_DIST) {
  app.use(express.static(WEB_DIST, { index: false }))
}

/** Tránh Express trả HTML 404 cho /api — frontend parse JSON dễ đọc lỗi. */
app.use((req, res) => {
  const pathOnly = String(req.originalUrl ?? req.url).split('?')[0]
  if (
    HAS_WEB_DIST &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    !pathOnly.startsWith('/api')
  ) {
    return res.sendFile(join(WEB_DIST, 'index.html'))
  }
  if (String(req.originalUrl ?? req.url).startsWith('/api')) {
    return res.status(404).json({
      detail: `Không có API: ${req.method} ${req.originalUrl}. Kiểm tra bạn đã cập nhật code server và chạy lại npm start (có route /api/track).`,
    })
  }
  res.status(404).type('text').send(`Not found: ${req.originalUrl}`)
})

const PORT = Number(process.env.PORT) || 8000

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VN Stock API: http://127.0.0.1:${PORT}`)
  if (HAS_WEB_DIST) {
    console.log(`Web (static): ${WEB_DIST}`)
  }
  console.log(
    `[cron] Quét watchlist: 9:30, 12:00, 14:00 — ${CRON_TZ} (T2–T6)`,
  )
  console.log(
    `[cron] Cảnh báo ATC: 14:33, 14:38, 14:43 — ${CRON_TZ} (T2–T6)`,
  )

  cron.schedule(
    '30 9 * * 1-5',
    () => {
      void runScheduledScan('cron-09:30')
    },
    { timezone: CRON_TZ },
  )
  cron.schedule(
    '0 12 * * 1-5',
    () => {
      void runScheduledScan('cron-12:00')
    },
    { timezone: CRON_TZ },
  )
  cron.schedule(
    '0 14 * * 1-5',
    () => {
      void runScheduledScan('cron-14:00')
    },
    { timezone: CRON_TZ },
  )
  cron.schedule(
    '33,38,43 14 * * 1-5',
    () => {
      void runAtcWindowScan('cron-atc')
    },
    { timezone: CRON_TZ },
  )
})
