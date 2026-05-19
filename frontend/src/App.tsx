import { useCallback, useEffect, useMemo, useState } from 'react'
import { StockChart } from './StockChart'
import type {
  Advice,
  AtcAlertPayload,
  ChartBar,
  ChartMeta,
  ChartResponse,
  PicksResponse,
  ScanLatest,
  ScheduleInfo,
  SnapshotItem,
  SnapshotResponse,
  TrackListResponse,
} from './types'
import { apiUrl, fetchApiJson } from './apiClient'
import './app.css'

const PERIODS = [
  { value: '6mo', label: '6 tháng' },
  { value: '1y', label: '1 năm' },
  { value: '2y', label: '2 năm' },
  { value: '5y', label: '5 năm' },
  { value: 'max', label: 'Tối đa' },
] as const

/** Gắn vào /api/picks — khớp tham số backend (minForwardWin, weakMuaMinConfluence, forwardMinSamples). */
const PICK_FILTER_PRESET_QUERY = {
  default: '',
  strict: '&minForwardWin=52&weakMuaMinConfluence=76&forwardMinSamples=12',
  relaxed: '&minForwardWin=40&weakMuaMinConfluence=64&forwardMinSamples=8',
} as const

type PickFilterPreset = keyof typeof PICK_FILTER_PRESET_QUERY

const SIGNAL_QUALITY_KEY = 'vn-stock-signal-quality'
type SignalQualityMode = 'balanced' | 'strict'
const DEFAULT_SYMBOL = 'VCB'
const DEFAULT_USER_WATCHLIST = ['VCB', 'HDB', 'TCB']

function readSignalQuality(): SignalQualityMode {
  try {
    const s = localStorage.getItem(SIGNAL_QUALITY_KEY)
    return s === 'strict' ? 'strict' : 'balanced'
  } catch {
    return 'balanced'
  }
}

const CHART_INTERVALS = [
  { value: '1d', label: 'Theo ngày' },
  { value: '1w', label: 'Theo tuần' },
  { value: '1M', label: 'Theo tháng' },
] as const

const USER_WATCH_KEY = 'vn-stock-user-watch'

function readUserWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(USER_WATCH_KEY)
    if (!raw) return DEFAULT_USER_WATCHLIST
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j) || !j.length) return DEFAULT_USER_WATCHLIST
    return [
      ...new Set(
        j
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => s.length >= 2 && s.length <= 16),
      ),
    ]
  } catch {
    return DEFAULT_USER_WATCHLIST
  }
}

function actionClass(a: string | null | undefined) {
  if (a === 'MUA') return 'buy'
  if (a === 'BÁN') return 'sell'
  return 'wait'
}

function App() {
  const [serverSymbols, setServerSymbols] = useState<string[]>([])
  const [userWatchlist, setUserWatchlist] = useState<string[]>(readUserWatchlist)
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL)
  const [symbolDraft, setSymbolDraft] = useState(DEFAULT_SYMBOL)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('2y')
  const [chartInterval, setChartInterval] = useState<
    (typeof CHART_INTERVALS)[number]['value']
  >('1d')
  const [bars, setBars] = useState<ChartBar[]>([])
  const [meta, setMeta] = useState<ChartMeta | null>(null)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [scanInfo, setScanInfo] = useState<ScanLatest | null>(null)
  const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null)
  const [symbolCheckFailed, setSymbolCheckFailed] = useState<string[] | null>(
    null,
  )
  const [picks, setPicks] = useState<PicksResponse['picks']>([])
  const [picksMeta, setPicksMeta] = useState<{
    generatedAt: string | null
    fromCache: boolean
    pickFilters?: PicksResponse['pickFilters']
  }>({ generatedAt: null, fromCache: false })
  const [pickFilterPreset, setPickFilterPreset] =
    useState<PickFilterPreset>('default')
  const [signalQuality, setSignalQuality] = useState<SignalQualityMode>(readSignalQuality)
  const [picksLoading, setPicksLoading] = useState(false)
  const [picksError, setPicksError] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [snapLoading, setSnapLoading] = useState(false)
  const [universeHint, setUniverseHint] = useState<string | null>(null)
  const [addInput, setAddInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [atcPayload, setAtcPayload] = useState<AtcAlertPayload | null>(null)
  const [trackPayload, setTrackPayload] = useState<TrackListResponse | null>(
    null,
  )
  const [trackLoading, setTrackLoading] = useState(false)
  const [trackErr, setTrackErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(apiUrl('/api/watchlist'))
        if (!r.ok) throw new Error(String(r.status))
        const j = (await r.json()) as { symbols: string[] }
        if (!cancelled && j.symbols?.length) setServerSymbols(j.symbols)
      } catch {
        if (!cancelled) setError('Không tải được watchlist — chạy backend chưa?')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(apiUrl('/api/alerts/atc/latest'))
        if (!r.ok) return
        const j = (await r.json()) as AtcAlertPayload
        if (!cancelled) setAtcPayload(j.generatedAt ? j : null)
      } catch {
        /* chưa chạy job / chưa có file */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(USER_WATCH_KEY, JSON.stringify(userWatchlist))
  }, [userWatchlist])

  useEffect(() => {
    try {
      localStorage.setItem(SIGNAL_QUALITY_KEY, signalQuality)
    } catch {
      /* ignore */
    }
  }, [signalQuality])

  useEffect(() => {
    setSymbolDraft(symbol)
  }, [symbol])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!userWatchlist.length) {
        setSnapshots([])
        return
      }
      setSnapLoading(true)
      try {
        const q = userWatchlist.map(encodeURIComponent).join(',')
        const r = await fetch(apiUrl(`/api/snapshot?symbols=${q}`))
        if (!r.ok) throw new Error(String(r.status))
        const j = (await r.json()) as SnapshotResponse
        if (!cancelled) setSnapshots(j.items ?? [])
      } catch {
        if (!cancelled) setSnapshots([])
      } finally {
        if (!cancelled) setSnapLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userWatchlist])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, sc] = await Promise.all([
          fetch(apiUrl('/api/schedule')),
          fetch(apiUrl('/api/scan/latest')),
        ])
        if (s.ok && !cancelled) {
          setScheduleInfo((await s.json()) as ScheduleInfo)
        }
        if (sc.ok && !cancelled) {
          const latest = (await sc.json()) as ScanLatest
          setScanInfo(latest.generatedAt ? latest : null)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadPicks = useCallback(async () => {
    setPicksLoading(true)
    setPicksError(null)
    try {
      const q = PICK_FILTER_PRESET_QUERY[pickFilterPreset]
      const r = await fetch(
        apiUrl(
          `/api/picks?limit=18&signalMode=${encodeURIComponent(signalQuality)}${q}`,
        ),
      )
      const j = (await r.json()) as PicksResponse & { detail?: string }
      if (!r.ok) throw new Error(j.detail ?? `Lỗi ${r.status}`)
      setPicks(j.picks ?? [])
      setPicksMeta({
        generatedAt: j.generatedAt,
        fromCache: j.universeFromCache,
        pickFilters: j.pickFilters,
      })
    } catch (e) {
      setPicks([])
      setPicksMeta({ generatedAt: null, fromCache: false })
      setPicksError(e instanceof Error ? e.message : 'Không tải được picks')
    } finally {
      setPicksLoading(false)
    }
  }, [pickFilterPreset, signalQuality])

  const loadTrack = useCallback(async () => {
    setTrackLoading(true)
    setTrackErr(null)
    try {
      const { response: r, data: j } = await fetchApiJson<
        TrackListResponse & { detail?: string }
      >('/api/track')
      if (!r.ok) throw new Error(j.detail ?? `Lỗi ${r.status}`)
      setTrackPayload(j as TrackListResponse)
    } catch (e) {
      setTrackErr(e instanceof Error ? e.message : 'Không tải danh sách theo dõi')
    } finally {
      setTrackLoading(false)
    }
  }, [])

  const addToTrack = useCallback(
    async (sym: string, act: 'MUA' | 'BÁN' | 'CHỜ') => {
      setTrackErr(null)
      try {
        const body: Record<string, unknown> = {
          symbol: sym.trim().toUpperCase(),
          action: act,
        }
        if (
          sym.trim().toUpperCase() === symbol.trim().toUpperCase() &&
          meta?.currentPrice != null
        ) {
          body.entryPrice = meta.currentPrice
        }
        const { response: r, data: j } = await fetchApiJson<{
          detail?: string
          ok?: boolean
        }>('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error(j.detail ?? 'Không lưu được')
        await loadTrack()
      } catch (e) {
        setTrackErr(e instanceof Error ? e.message : 'Lỗi lưu')
      }
    },
    [symbol, meta, loadTrack],
  )

  const removeTrack = useCallback(
    async (id: string) => {
      setTrackErr(null)
      try {
        const { response: r, data: j } = await fetchApiJson<{ detail?: string }>(
          `/api/track/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        )
        if (!r.ok) throw new Error(j.detail ?? 'Không xóa được')
        await loadTrack()
      } catch (e) {
        setTrackErr(e instanceof Error ? e.message : 'Không xóa được dòng')
      }
    },
    [loadTrack],
  )

  const loadChart = useCallback(
    async (sym: string, p: string, interval: string) => {
      setLoading(true)
      setError(null)
      try {
        const r = await fetch(
          apiUrl(
            `/api/chart?symbol=${encodeURIComponent(sym)}&period=${encodeURIComponent(p)}&interval=${encodeURIComponent(interval)}&signalMode=${encodeURIComponent(signalQuality)}`,
          ),
        )
        const j = (await r.json()) as ChartResponse & { detail?: string }
        if (!r.ok) {
          throw new Error(j.detail ?? `Lỗi ${r.status}`)
        }
        setBars(j.bars ?? [])
        setMeta(j.meta ?? null)
        setAdvice(j.advice ?? null)
      } catch (e) {
        setBars([])
        setMeta(null)
        setAdvice(null)
        setError(e instanceof Error ? e.message : 'Lỗi không xác định')
      } finally {
        setLoading(false)
      }
    },
    [signalQuality],
  )

  useEffect(() => {
    if (symbol) void loadChart(symbol, period, chartInterval)
  }, [symbol, period, chartInterval, loadChart])

  useEffect(() => {
    void loadTrack()
  }, [loadTrack])

  const lastBar = useMemo(() => bars[bars.length - 1], [bars])

  const chartLiveSignal = useMemo(() => {
    if (!meta || !lastBar) return null
    return {
      action: (advice?.action ?? 'CHỜ') as 'MUA' | 'BÁN' | 'CHỜ',
      asOf: advice?.asOf ?? meta.lastDate,
      softBear:
        (advice?.action ?? 'CHỜ') === 'CHỜ' &&
        !lastBar.trendOk &&
        lastBar.close < lastBar.ema20,
    }
  }, [meta, lastBar, advice?.action, advice?.asOf])

  const pickSymbols = useMemo(() => picks.map((p) => p.symbol), [picks])

  const symbolSuggestions = useMemo(
    () =>
      [...new Set([...pickSymbols, ...userWatchlist, ...serverSymbols])].sort(),
    [pickSymbols, userWatchlist, serverSymbols],
  )

  const commitDraftSymbol = useCallback(() => {
    const s = symbolDraft
      .trim()
      .toUpperCase()
      .replace(/\.VN$/i, '')
      .slice(0, 16)
    if (s.length < 2) return
    setSymbol(s)
  }, [symbolDraft])

  const addToWatch = useCallback(() => {
    const s = addInput.trim().toUpperCase()
    if (s.length < 2 || s.length > 16) return
    setUserWatchlist((prev) => [...new Set([...prev, s])])
    setAddInput('')
    setSymbol(s)
  }, [addInput])

  const removeFromWatch = useCallback((s: string) => {
    setUserWatchlist((prev) => prev.filter((x) => x !== s))
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>VN Stock — biểu đồ & khuyến nghị minh họa</h1>
          <p className="subtitle">
            Yahoo (.VN/.HN) → VNDirect → TCBS · Mục tiêu/stop gợi ý theo ATR · Quét 9:30 /
            12:00 / 14:00 (giờ VN)
          </p>
          {scheduleInfo && (
            <p className="schedule-strip">
              {scheduleInfo.crons.map((c) => (c.label ? `${c.time} (${c.label})` : c.time)).join(' · ')} —{' '}
              {scheduleInfo.timezone}
              {scheduleInfo.atcNote && (
                <span className="schedule-atc"> · {scheduleInfo.atcNote}</span>
              )}
            </p>
          )}
        </div>
        <div className="header-controls">
          <div className="period-row">
            <label htmlFor="period">Khung lịch sử</label>
            <select
              id="period"
              value={period}
              onChange={(e) =>
                setPeriod(e.target.value as (typeof PERIODS)[number]['value'])
              }
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="interval-row" role="group" aria-label="Khung nến biểu đồ">
            <span className="interval-label">Nến</span>
            {CHART_INTERVALS.map((iv) => (
              <button
                key={iv.value}
                type="button"
                className={`interval-chip ${chartInterval === iv.value ? 'active' : ''}`}
                onClick={() => setChartInterval(iv.value)}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="layout">
        <aside className="sidebar">
          <h2>Mã & theo dõi</h2>

          <div className="symbol-select-block">
            <label htmlFor="symbol-quick">Chọn nhanh</label>
            <select
              id="symbol-quick"
              className="symbol-quick-select"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            >
              {!symbolSuggestions.includes(symbol) && symbol ? (
                <optgroup label="Đang mở">
                  <option value={symbol}>{symbol}</option>
                </optgroup>
              ) : null}
              {pickSymbols.length > 0 && (
                <optgroup label="Gợi ý MUA (picks)">
                  {pickSymbols.map((s) => (
                    <option key={`p-${s}`} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Theo dõi của bạn">
                {userWatchlist.map((s) => (
                  <option key={`u-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Watchlist máy chủ">
                {serverSymbols.map((s) => (
                  <option key={`w-${s}`} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
            </select>
            <label htmlFor="symbol-input">Hoặc gõ mã</label>
            <div className="symbol-input-row">
              <input
                id="symbol-input"
                className="symbol-input"
                list="symbol-suggestions"
                value={symbolDraft}
                onChange={(e) =>
                  setSymbolDraft(
                    e.target.value.toUpperCase().replace(/\s+/g, ''),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDraftSymbol()
                  }
                }}
                maxLength={16}
                placeholder="Gõ mã (VD: CEO)"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="symbol-input-hint"
              />
              <datalist id="symbol-suggestions">
                {symbolSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <button
                type="button"
                className="scan-btn secondary symbol-apply"
                onClick={() => commitDraftSymbol()}
              >
                Áp dụng
              </button>
            </div>
            <p id="symbol-input-hint" className="picks-hint muted">
              <strong>Dropdown</strong> chọn nhanh; <strong>ô bên dưới</strong> gõ mã rồi Enter / Áp dụng.
              Đang xem chart: <strong>{symbol}</strong> — Yahoo → VNDirect → TCBS.
            </p>
            {picksMeta.generatedAt && (
              <p className="picks-hint muted">
                Picks cập nhật{' '}
                {new Date(picksMeta.generatedAt).toLocaleString('vi-VN', {
                  timeZone: 'Asia/Ho_Chi_Minh',
                })}
                {picksMeta.fromCache ? ' · theo universe đã quét' : ' · tập ứng viên mặc định'}
              </p>
            )}
            <div className="pick-filter-row">
              <label htmlFor="signal-quality" className="muted small pick-filter-label">
                Tín hiệu MUA/BÁN (chart + picks)
              </label>
              <select
                id="signal-quality"
                className="pick-preset-select"
                value={signalQuality}
                onChange={(e) =>
                  setSignalQuality(e.target.value as SignalQualityMode)
                }
              >
                <option value="balanced">Cân bằng — đủ tín hiệu để quan sát (mặc định)</option>
                <option value="strict">
                  Chặt — đa xác nhận + điểm hội tụ “base”; BÁN EMA20 kèm MACD
                </option>
              </select>
            </div>
            <div className="pick-filter-row">
              <label htmlFor="pick-preset" className="muted small pick-filter-label">
                Độ lọc gợi ý
              </label>
              <select
                id="pick-preset"
                className="pick-preset-select"
                value={pickFilterPreset}
                disabled={picksLoading}
                onChange={(e) =>
                  setPickFilterPreset(e.target.value as PickFilterPreset)
                }
              >
                <option value="default">Cân bằng (mặc định, khuyên dùng)</option>
                <option value="strict">Chặt hơn — ít mã hơn</option>
                <option value="relaxed">Nới hơn — nhiều mã hơn, tự cân nhắc</option>
              </select>
            </div>
            {picksMeta.pickFilters ? (
              <p className="picks-hint muted small">
                Đang dùng: tín hiệu <strong>{picksMeta.pickFilters.signalMode ?? 'balanced'}</strong>
                {' · '}
                lọc: tỷ lệ lịch sử tối thiểu{' '}
                <strong>{picksMeta.pickFilters.minForwardWin}%</strong>
                {' · '}
                giữ MUA “forward yếu” nếu điểm hội tụ ≥{' '}
                <strong>{picksMeta.pickFilters.weakMuaMinConfluence}</strong>
                {' · '}
                mỗi nhánh cần ≥ <strong>{picksMeta.pickFilters.forwardMinSamples}</strong> mẫu
                MUA trong lịch sử.
              </p>
            ) : null}
            <button
              type="button"
              className="scan-btn secondary tight"
              disabled={picksLoading}
              onClick={() => void loadPicks()}
            >
              {picksLoading ? 'Đang tải gợi ý…' : 'Làm mới gợi ý MUA'}
            </button>
            {!picksMeta.generatedAt && !picksLoading && !picksError && (
              <p className="picks-hint muted small">
                Gợi ý MUA sẽ chỉ tải khi bạn bấm nút để tránh request nặng lúc mở trang.
              </p>
            )}
            {picksError && (
              <p className="picks-error" role="alert">
                {picksError}
              </p>
            )}
          </div>

          <div className="scan-box">
            <span className="label">Quét tự động (watchlist máy chủ)</span>
            <p className="scan-time">
              {scanInfo?.generatedAt
                ? new Date(scanInfo.generatedAt).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                  })
                : 'Chưa có lần quét nào'}
            </p>
            <button
              type="button"
              className="scan-btn"
              onClick={async () => {
                try {
                  const r = await fetch(apiUrl('/api/scan/run'), { method: 'POST' })
                  if (r.ok) {
                    const j = (await r.json()) as ScanLatest & { ok?: boolean }
                    const { ok: _ignored, ...rest } = j
                    void _ignored
                    setScanInfo(rest as ScanLatest)
                  }
                } catch {
                  /* ignore */
                }
              }}
            >
              Chạy quét ngay
            </button>
            <button
              type="button"
              className="scan-btn secondary"
              onClick={async () => {
                try {
                  const r = await fetch(apiUrl('/api/symbols/validate'))
                  if (!r.ok) return
                  const j = (await r.json()) as {
                    results: Array<{ symbol: string; ok: boolean }>
                  }
                  const bad = j.results
                    .filter((x) => !x.ok)
                    .map((x) => x.symbol)
                  setSymbolCheckFailed(bad.length ? bad : [])
                } catch {
                  setSymbolCheckFailed(null)
                }
              }}
            >
              Kiểm tra nguồn dữ liệu
            </button>
            {symbolCheckFailed && symbolCheckFailed.length > 0 && (
              <p
                className="validate-warn"
                title="Các mã không tải được dữ liệu"
              >
                Lỗi dữ liệu: {symbolCheckFailed.join(', ')}
              </p>
            )}
            {symbolCheckFailed && symbolCheckFailed.length === 0 && (
              <p className="validate-ok">Tất cả mã watchlist máy chủ có dữ liệu.</p>
            )}
            <button
              type="button"
              className="scan-btn secondary tight"
              onClick={async () => {
                setUniverseHint('Đang quét universe…')
                try {
                  const pr = await fetch(apiUrl('/api/universe/refresh'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                  })
                  if (!pr.ok) {
                    setUniverseHint('Lỗi refresh universe')
                    return
                  }
                  const u = await fetch(apiUrl('/api/universe'))
                  if (u.ok) {
                    const j = (await u.json()) as { count?: number; refreshedAt?: string }
                    setUniverseHint(
                      j.refreshedAt
                        ? `Universe: ${j.count ?? 0} mã (KL TB ≥ ngưỡng) — ${new Date(j.refreshedAt).toLocaleString('vi-VN')}`
                        : null,
                    )
                  }
                } catch {
                  setUniverseHint('Lỗi mạng khi quét universe')
                }
              }}
            >
              Quét universe (thanh khoản, bỏ mã quá ế)
            </button>
            {universeHint && <p className="universe-hint">{universeHint}</p>}
          </div>

          <div className="atc-box">
            <h3>Cảnh báo khung ATC (~14:30–14:45)</h3>
            <p className="muted small">
              Job chạy <strong>14:33, 14:38, 14:43</strong> (giờ VN, T2–T6). Dữ liệu delay — chỉ
              hỗ trợ theo dõi kỹ thuật.
            </p>
            {atcPayload?.generatedAt ? (
              <>
                <p className="atc-time">
                  Lần chạy:{' '}
                  {new Date(atcPayload.generatedAt).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                  })}{' '}
                  <span className="muted">({atcPayload.trigger ?? '—'})</span>
                </p>
                <p className="atc-highlight-count">
                  Mã cần chú ý: <strong>{atcPayload.highlightedCount ?? 0}</strong> /{' '}
                  {atcPayload.count ?? 0}
                </p>
                <ul className="atc-list">
                  {(atcPayload.highlighted ?? []).slice(0, 12).map((row) => (
                    <li key={`${row.symbol}-${row.scannedAt}`}>
                      <button
                        type="button"
                        className="link-sym"
                        onClick={() => setSymbol(row.symbol)}
                      >
                        {row.symbol}
                      </button>
                      {row.action && (
                        <span className={`tag sm ${actionClass(row.action)}`}>{row.action}</span>
                      )}
                      {row.warnings?.length ? (
                        <span className="atc-warn-text"> — {row.warnings[0]}</span>
                      ) : row.error ? (
                        <span className="atc-warn-text"> — {row.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted small">Chưa có bản ghi — đợi phiên ATC hoặc chạy thử bên dưới.</p>
            )}
            <button
              type="button"
              className="scan-btn secondary tight"
              onClick={async () => {
                try {
                  const r = await fetch(apiUrl('/api/alerts/atc/run'), { method: 'POST' })
                  if (!r.ok) return
                  const j = (await r.json()) as AtcAlertPayload & { ok?: boolean }
                  const { ok: _o, ...rest } = j
                  void _o
                  setAtcPayload(rest as AtcAlertPayload)
                } catch {
                  /* ignore */
                }
              }}
            >
              Chạy cảnh báo ATC ngay (thử)
            </button>
          </div>

          <div className="user-watch-panel">
            <h3>Danh sách theo dõi của bạn</h3>
            <div className="add-row">
              <input
                type="text"
                value={addInput}
                onChange={(e) => setAddInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addToWatch()
                }}
                placeholder="Thêm mã (VD: CEO)"
                maxLength={16}
                aria-label="Mã chứng khoán thêm vào theo dõi"
              />
              <button type="button" className="scan-btn secondary" onClick={addToWatch}>
                Thêm
              </button>
            </div>
            {snapLoading && (
              <p className="muted small">Đang tải cảnh báo cho {userWatchlist.length} mã…</p>
            )}
            <div className="watch-table-wrap">
              <table className="watch-table">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Hành động</th>
                    <th>Điểm HT</th>
                    <th>Cảnh báo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {userWatchlist.map((s) => {
                    const row = snapshots.find((x) => x.symbol === s)
                    return (
                      <tr key={s}>
                        <td>
                          <button
                            type="button"
                            className="link-sym"
                            onClick={() => setSymbol(s)}
                          >
                            {s}
                          </button>
                          {row?.dataProvider && (
                            <span className="muted tiny"> · {row.dataProvider}</span>
                          )}
                        </td>
                        <td>
                          {row?.error ? (
                            <span className="tag wait">Lỗi</span>
                          ) : (
                            <span className={`tag ${actionClass(row?.action)}`}>
                              {row?.action ?? '—'}
                            </span>
                          )}
                        </td>
                        <td>
                          {row?.confluenceScore != null ? row.confluenceScore : '—'}
                        </td>
                        <td className="warn-cell">
                          {row?.warnings?.length ? (
                            <ul className="warn-list">
                              {row.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          ) : row?.error ? (
                            <span className="muted">{row.error}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-remove"
                            title={`Bỏ ${s} khỏi theo dõi`}
                            onClick={() => removeFromWatch(s)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {picks.length > 0 && (
            <div className="picks-inline">
              <h3>Mã đang “nên xem xét” (theo rule app)</h3>
              <ul className="picks-chips">
                {picks.slice(0, 12).map((p) => (
                  <li key={p.symbol} className="pick-chip-row">
                    <button
                      type="button"
                      className={`pick-chip pick-chip--${actionClass(p.action)}`}
                      onClick={() => setSymbol(p.symbol)}
                    >
                      <strong>{p.symbol}</strong>
                      <span className="muted">
                        {' '}
                        {p.confluenceScore} · {p.action}
                        {p.buyForwardOutlook?.blend2_3Sessions?.enough &&
                          p.buyForwardOutlook.blend2_3Sessions.winRatePercent != null &&
                          ` · ~${p.buyForwardOutlook.blend2_3Sessions.winRatePercent}% có lãi nhẹ sau 2–3 phiên (mẫu cũ)`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pick-track-plus"
                      title="Lưu vào bảng tổng kết (5 phiên)"
                      onClick={() => {
                        const act =
                          p.action === 'BÁN'
                            ? 'BÁN'
                            : p.action === 'CHỜ'
                              ? 'CHỜ'
                              : 'MUA'
                        void addToTrack(p.symbol, act)
                      }}
                    >
                      ＋theo dõi
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="track-panel">
            <h3>Tổng kết tín hiệu (sau 5 phiên T2–T6)</h3>
            <p className="muted small track-panel-intro">
              Mỗi dòng: ngày vào, giá vào, sau đủ 5 phiên hệ thống tính % lãi/lỗ <em>ảo</em>{' '}
              (MUA = long; BÁN = kỳ vọng giảm) và đánh dấu đúng/sai hướng. Dữ liệu lưu trên
              máy chủ (file <code>server/data/signal-track.json</code>).
            </p>
            {trackPayload && (
              <p className="track-summary-line">
                Đang lưu <strong>{trackPayload.summary.total}</strong> dòng · Đủ 5 phiên:{' '}
                <strong>{trackPayload.summary.evalReadyCount}</strong>
                {trackPayload.summary.winRatePercent != null ? (
                  <>
                    {' '}
                    · Đúng hướng:{' '}
                    <strong>
                      {trackPayload.summary.winRatePercent}% (
                      {trackPayload.summary.correctCount}/
                      {trackPayload.summary.evalReadyCount})
                    </strong>
                  </>
                ) : (
                  <span className="muted"> · chưa đủ mẫu để tỷ lệ</span>
                )}
              </p>
            )}
            <button
              type="button"
              className="scan-btn secondary tight"
              disabled={trackLoading}
              onClick={() => void loadTrack()}
            >
              {trackLoading ? 'Đang tải bảng…' : 'Làm mới bảng'}
            </button>
            {trackErr && (
              <p className="picks-error" role="alert">
                {trackErr}
              </p>
            )}
            {trackPayload && trackPayload.items.length > 0 ? (
              <div className="track-table-scroll">
                <table className="track-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Lệnh</th>
                      <th>Ngày vào</th>
                      <th>Giá vào</th>
                      <th>Chấm từ</th>
                      <th>Giá mới</th>
                      <th>% ảo</th>
                      <th>Đúng?</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {trackPayload.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className="link-sym"
                            onClick={() => setSymbol(row.symbol)}
                          >
                            {row.symbol}
                          </button>
                        </td>
                        <td>
                          <span
                            className={`tag sm ${row.action === 'BÁN' ? 'sell' : row.action === 'MUA' ? 'buy' : 'wait'}`}
                          >
                            {row.action}
                          </span>
                        </td>
                        <td>{row.entryDate}</td>
                        <td>
                          {row.entryPrice.toLocaleString('vi-VN', {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td>{row.evalDueOn}</td>
                        <td>
                          {row.markPrice != null
                            ? row.markPrice.toLocaleString('vi-VN', {
                                maximumFractionDigits: 3,
                              })
                            : '—'}
                          {row.evalReady ? null : (
                            <span className="track-cell-sub muted tiny">
                              chờ đủ phiên
                            </span>
                          )}
                        </td>
                        <td
                          className={
                            row.pnlPercent == null
                              ? ''
                              : row.pnlPercent > 0
                                ? 'delta-up'
                                : row.pnlPercent < 0
                                  ? 'delta-down'
                                  : ''
                          }
                        >
                          {row.pnlPercent != null
                            ? `${row.pnlPercent > 0 ? '+' : ''}${row.pnlPercent.toFixed(2)}%`
                            : '—'}
                        </td>
                        <td>
                          {!row.evalReady ? (
                            <span className="muted">—</span>
                          ) : row.action === 'CHỜ' ? (
                            <span
                              className="muted"
                              title="CHỜ: chỉ xem % thay đổi, không chấm đúng/sai hướng"
                            >
                              —
                            </span>
                          ) : row.signalCorrect ? (
                            <span className="ok">Đúng</span>
                          ) : (
                            <span className="no">Sai</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-remove"
                            title="Xóa dòng"
                            onClick={() => void removeTrack(row.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !trackLoading && (
                <p className="muted small">
                  Chưa có dòng nào — thêm từ picks hoặc khối khuyến nghị.
                </p>
              )
            )}
          </div>
        </aside>

        <main className="main">
          {loading && <div className="loading">Đang tải {symbol}…</div>}

          {!loading && meta && (
            <section
              className="current-signal-hero"
              aria-label="Khuyến nghị tham chiếu tại ngày gần nhất"
              aria-live="polite"
            >
              <p className="current-signal-kicker">Mã {meta.symbol}</p>
              <h2 className="current-signal-title">
                Tại thời điểm hiện tại (theo phiên gần nhất)
              </h2>
              <div
                className={`current-signal-pill ${actionClass(advice?.action ?? 'CHỜ')}`}
              >
                <span className="current-signal-verb">
                  {advice?.action === 'MUA'
                    ? 'MUA'
                    : advice?.action === 'BÁN'
                      ? 'BÁN'
                      : 'CHỜ'}
                </span>
                <span className="current-signal-caption">
                  {advice?.action === 'MUA'
                    ? ' — có tín hiệu edge MUA trên rule kỹ thuật'
                    : advice?.action === 'BÁN'
                      ? ' — có tín hiệu thoát / yếu trên rule kỹ thuật'
                      : ' — chưa có edge MUA/BÁN rõ; quan sát hoặc dùng TP/SL gợi ý'}
                </span>
              </div>
              <p className="current-signal-asof">
                Dữ liệu đến ngày{' '}
                <strong>{advice?.asOf ?? meta.lastDate ?? '—'}</strong>
                {meta.chartInterval && meta.chartInterval !== '1d' ? (
                  <span className="muted">
                    {' '}
                    · đang xem nến <strong>{meta.chartIntervalLabel ?? meta.chartInterval}</strong> (gộp từ ngày)
                  </span>
                ) : null}
                <span className="muted">
                  {' '}
                  · khớp EOD/minh họa, không phải bước giá trong phiên live.
                </span>
              </p>
              {advice?.confluence ? (
                <p className="current-signal-confluence">
                  Điểm hội tụ:{' '}
                  <strong>{advice.confluence.score}</strong>/100 —{' '}
                  {advice.confluence.bias}
                </p>
              ) : (
                <p className="current-signal-confluence muted">
                  Chưa tính đủ điểm hội tụ (thiếu lịch sử hoặc ATR).
                </p>
              )}
              {advice?.summary ? (
                <p className="current-signal-summary">{advice.summary}</p>
              ) : meta && !advice ? (
                <p className="current-signal-summary muted">
                  Chưa có tóm tắt khuyến nghị — thử khung lịch sử dài hơn hoặc kiểm tra mã có đủ dữ
                  liệu (≥ ~50 phiên).
                </p>
              ) : null}
              <p className="current-signal-disclaimer muted small">
                Đây là công cụ tham khảo kỹ thuật, không phải lệnh hay tư vấn đầu tư.
              </p>
              {meta && (
                <div className="hero-track-btns">
                  <button
                    type="button"
                    className="scan-btn secondary tight"
                    onClick={() => void addToTrack(symbol, 'MUA')}
                  >
                    Lưu theo dõi 5 phiên · <strong>MUA</strong>
                  </button>
                  <button
                    type="button"
                    className="scan-btn secondary tight"
                    onClick={() => void addToTrack(symbol, 'BÁN')}
                  >
                    Lưu theo dõi 5 phiên · <strong>BÁN</strong>
                  </button>
                  {advice?.action === 'CHỜ' && (
                    <button
                      type="button"
                      className="scan-btn secondary tight"
                      onClick={() => void addToTrack(symbol, 'CHỜ')}
                    >
                      Lưu theo dõi 5 phiên · <strong>CHỜ</strong>
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {meta && (
            <section className="meta-card">
              <div className="meta-grid">
                <div>
                  <span className="label">Mã</span>
                  <strong>
                    {meta.symbol}{' '}
                    <span className="muted">({meta.yahoo})</span>
                    {meta.dataProvider && (
                      <span className="provider-pill">{meta.dataProvider}</span>
                    )}
                  </strong>
                </div>
                <div>
                  <span className="label">Khung nến hiển thị</span>
                  <strong>
                    {meta.chartIntervalLabel ?? 'ngày'}
                    {meta.chartInterval && meta.chartInterval !== '1d' && (
                      <span className="muted"> (gộp từ ngày)</span>
                    )}
                  </strong>
                </div>
                <div>
                  <span className="label">Ngày gần nhất</span>
                  <strong>{meta.lastDate ?? '—'}</strong>
                </div>
                <div>
                  <span className="label">Đóng cửa (nến cuối)</span>
                  <strong>
                    {meta.lastClose != null
                      ? meta.lastClose.toLocaleString('vi-VN', {
                          maximumFractionDigits: 3,
                        })
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Giá hiện tại (tham chiếu)</span>
                  <strong>
                    {meta.currentPrice != null
                      ? meta.currentPrice.toLocaleString('vi-VN', {
                          maximumFractionDigits: 3,
                        })
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Tăng/giảm so tham chiếu</span>
                  <strong
                    className={
                      meta.change == null
                        ? ''
                        : meta.change > 0
                          ? 'delta-up'
                          : meta.change < 0
                            ? 'delta-down'
                            : 'delta-flat'
                    }
                  >
                    {meta.change != null && meta.changePercent != null
                      ? `${meta.change > 0 ? '+' : ''}${meta.change.toLocaleString('vi-VN', {
                          maximumFractionDigits: 2,
                        })} (${meta.changePercent > 0 ? '+' : ''}${meta.changePercent.toFixed(2)}%)`
                      : '—'}
                  </strong>
                  {meta.previousReference != null && (
                    <span className="ref-line muted">
                      Đóng tham chiếu:{' '}
                      {meta.previousReference.toLocaleString('vi-VN', {
                        maximumFractionDigits: 3,
                      })}
                    </span>
                  )}
                  {meta.changeHint && (
                    <span className="ref-line muted">{meta.changeHint}</span>
                  )}
                </div>
                <div>
                  <span className="label">RSI(14)</span>
                  <strong>
                    {meta.rsi != null ? meta.rsi.toFixed(2) : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Trend (Close &gt; EMA50)</span>
                  <strong className={meta.trendOk ? 'ok' : 'no'}>
                    {meta.trendOk ? 'Đúng' : 'Chưa'}
                  </strong>
                </div>
              </div>
              <p className="note">{meta.note}</p>
              <p className="picks-hint muted small">
                Tín hiệu đang xem: <strong>{meta.signalMode ?? 'balanced'}</strong>
                {meta.confluenceBaseScore != null && (
                  <>
                    {' '}
                    · Điểm hội tụ base (không cộng bonus rule):{' '}
                    <strong>{meta.confluenceBaseScore}</strong>
                  </>
                )}
                {meta.signalMode === 'strict' && meta.strictFilter ? (
                  <>
                    {' '}
                    — strict: MUA cần ≥{meta.strictFilter.minBranches} nhánh đồng thời, điểm base ≥{' '}
                    {meta.strictFilter.minConfluenceBase}.
                  </>
                ) : null}
              </p>
              {lastBar && (
                <div className="today">
                  <span className="label">Phiên chọn trên chart</span>
                  <p>
                    {lastBar.buy && (
                      <span className="tag buy">Tín hiệu MUA (edge)</span>
                    )}
                    {lastBar.sell && (
                      <span className="tag sell">Tín hiệu BÁN (EMA / MACD / cấu trúc)</span>
                    )}
                    {!lastBar.buy && !lastBar.sell && (
                      <span className="muted">Không có tín hiệu tại ngày cuối</span>
                    )}
                  </p>
                  {lastBar.reasons.length > 0 && (
                    <ul className="reasons">
                      {lastBar.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {advice && (
            <section className="advice-card">
              <div className="advice-head">
                <h2>Khuyến nghị minh họa (tới ngày {advice.asOf})</h2>
                <span
                  className={`advice-action ${advice.action === 'MUA' ? 'buy' : advice.action === 'BÁN' ? 'sell' : 'wait'}`}
                >
                  {advice.action}
                </span>
              </div>
              <p className="advice-summary">{advice.summary}</p>

              {(advice.action === 'MUA' || advice.action === 'CHỜ') &&
                advice.buyForwardOutlook && (
                <div className="forward-outlook-box">
                  <h3>Kỳ vọng ngắn từ mẫu lịch sử (≈ 2,5 phiên EOD)</h3>
                  <p className="confluence-hint">
                    Thống kê quá khứ cho các ngày có <strong>cùng rule tín hiệu MUA edge</strong>: sau
                    2 nến, 3 nến và trung bình hai mốc — so sánh <em>đóng cửa</em> với ngày vào.
                    Đây <strong>không phải dự báo</strong> lần hiện tại; ngày nghỉ lễ không có trong
                    chuỗi nến Yahoo.
                  </p>
                  {!advice.buyForwardOutlook.blend2_3Sessions.enough ? (
                    <p className="muted">
                      Chưa đủ mẫu (mỗi nhánh cần ≥ 10 lần tín hiệu MUA trong chuỗi). Sau 2 nến:{' '}
                      {advice.buyForwardOutlook.after2Bars.sampleCount} mẫu · Sau 3 nến:{' '}
                      {advice.buyForwardOutlook.after3Bars.sampleCount} mẫu.
                    </p>
                  ) : (
                    <ul className="factor-list">
                      <li>
                        Sau <strong>2</strong> phiên: ~{advice.buyForwardOutlook.after2Bars.winRatePercent}
                        % phiên có đóng &gt; ngày tín hiệu; lãi đóng–đóng TB ~{advice.buyForwardOutlook.after2Bars.avgReturnPercent}% (n=
                        {advice.buyForwardOutlook.after2Bars.sampleCount})
                      </li>
                      <li>
                        Sau <strong>3</strong> phiên: ~{advice.buyForwardOutlook.after3Bars.winRatePercent}
                        %; TB ~{advice.buyForwardOutlook.after3Bars.avgReturnPercent}% (n=
                        {advice.buyForwardOutlook.after3Bars.sampleCount})
                      </li>
                      <li>
                        <strong>Trung bình 2 &amp; 3 phiên:</strong> ~{advice.buyForwardOutlook.blend2_3Sessions.winRatePercent}% · TB ~{advice.buyForwardOutlook.blend2_3Sessions.avgReturnPercent}%
                      </li>
                    </ul>
                  )}
                </div>
              )}

              {advice.confluence ? (
                <div className="confluence-box">
                  <h3>Điểm hội tụ kỹ thuật (0–100)</h3>
                  <p className="confluence-score">
                    <strong>{advice.confluence.score}</strong>
                    <span className="bias"> — {advice.confluence.bias}</span>
                  </p>
                  <p className="confluence-hint">
                    Điểm cao hơn = bối cảnh thuận lợi hơn theo MA/RSI/khối lượng/MACD;{' '}
                    thẻ <strong>tham_chieu</strong> là bài học rút gọn từ tài liệu công
                    khai — không đảm bảo lợi nhuận và không thay phân tích chuyên sâu.
                  </p>
                  <ul className="factor-list">
                    {advice.confluence.factors.map((f, i) => (
                      <li key={`${f.tag}-${i}`}>
                        <span
                          className={
                            f.tag === 'tham_chieu'
                              ? 'factor-tag factor-edu'
                              : 'factor-tag'
                          }
                        >
                          {f.tag}
                        </span>{' '}
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted">Chưa có điểm hội tụ (thiếu đủ dữ liệu chỉ báo).</p>
              )}

              <div className="targets-grid">
                <div>
                  <span className="label">Mục tiêu TP1 (+~1,5×ATR)</span>
                  <strong>
                    {advice.takeProfit1 != null
                      ? advice.takeProfit1.toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Mục tiêu TP2 (+~2,5×ATR)</span>
                  <strong>
                    {advice.takeProfit2 != null
                      ? advice.takeProfit2.toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Đỉnh 20 phiên (gợi ý kháng cự)</span>
                  <strong>
                    {advice.resistanceHint != null
                      ? advice.resistanceHint.toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Stop gợi ý (ATR ∪ dưới EMA20)</span>
                  <strong>
                    {advice.stopLoss != null
                      ? advice.stopLoss.toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">ATR(14)</span>
                  <strong>
                    {advice.atr14 != null ? advice.atr14.toLocaleString('vi-VN') : '—'}
                  </strong>
                </div>
                <div>
                  <span className="label">Hỗ trợ EMA20 / EMA50</span>
                  <strong>
                    {advice.supportEma20 != null
                      ? advice.supportEma20.toLocaleString('vi-VN')
                      : '—'}
                    {' / '}
                    {advice.supportEma50 != null
                      ? advice.supportEma50.toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>
              </div>

              <div className="advice-columns">
                <div>
                  <h3>Khi nào nên xem xét MUA</h3>
                  <ul>
                    {advice.buyWhen.map((x, i) => (
                      <li key={`b-${i}`}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Khi nào nên xem xét BÁN / giảm</h3>
                  <ul>
                    {advice.sellWhen.map((x, i) => (
                      <li key={`s-${i}`}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {advice.disclaimers.map((d, i) => (
                <p key={`d-${i}`} className="disclaimer">
                  {d}
                </p>
              ))}
            </section>
          )}

          {bars.length > 0 && (
            <>
              <p className="chart-caption">
                Biểu đồ: nến <strong>{meta?.chartIntervalLabel ?? 'ngày'}</strong>
                {meta?.chartInterval !== '1d' &&
                  ' — mỗi cây là tổng hợp các phiên ngày trong tuần/tháng (đóng tại phiên cuối kỳ).'}
                <span className="chart-caption-extra">
                  {' '}
                  MUA/BÁN trên các nến trước = ngày có &quot;sự kiện&quot; kỹ thuật; nến{' '}
                  <strong>cuối cùng</strong> hiển thị trạng thái khớp ô cảnh báo phía trên (MUA / BÁN /
                  CHỜ; hoặc YẾU khi xu hướng ngắn vẫn xấu nhưng chưa tới ngày &quot;edge&quot;).
                </span>
              </p>
              <StockChart bars={bars} liveSignal={chartLiveSignal} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
