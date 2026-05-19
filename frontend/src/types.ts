import type { User } from '@auth0/auth0-react'

export type ChartBar = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  ema20: number
  ema50: number
  rsi: number | null
  buy: boolean
  sell: boolean
  trendOk: boolean
  reasons: string[]
}

export type ChartMeta = {
  symbol: string
  yahoo: string
  dataProvider?: 'yahoo' | 'tcbs' | 'vndirect'
  chartInterval?: '1d' | '1w' | '1M'
  chartIntervalLabel?: string
  lastDate: string | null
  lastClose: number | null
  /** Giá xem hiện tại (Yahoo regularMarket khi có; ngược lại = đóng cửa nến cuối) */
  currentPrice?: number | null
  previousReference?: number | null
  change?: number | null
  changePercent?: number | null
  changeHint?: string | null
  trendOk: boolean
  rsi: number | null
  note: string
  /** balanced (mặc định) | strict — rule MUA/BÁN chặt hơn */
  signalMode?: 'balanced' | 'strict'
  strictFilter?: {
    minBranches: number
    minConfluenceBase: number
  } | null
  /** Điểm hội tụ không cộng bonus buyRaw (ngày cuối) */
  confluenceBaseScore?: number | null
}

export type MuaForwardBarStat = {
  enough: boolean
  barsAhead: number
  sampleCount: number
  winRatePercent: number | null
  avgReturnPercent: number | null
}

export type BuyForwardOutlook = {
  after2Bars: MuaForwardBarStat
  after3Bars: MuaForwardBarStat
  blend2_3Sessions: {
    enough: boolean
    winRatePercent: number | null
    avgReturnPercent: number | null
    label: string
  }
}

export type Advice = {
  action: 'MUA' | 'BÁN' | 'CHỜ'
  summary: string
  asOf: string
  takeProfit1: number | null
  takeProfit2: number | null
  takeProfitSwing: number | null
  stopLoss: number | null
  atr14: number | null
  resistanceHint: number | null
  supportEma20: number | null
  supportEma50: number | null
  buyWhen: string[]
  sellWhen: string[]
  confluence?: {
    score: number
    bias: string
    factors: Array<{ tag: string; text: string }>
  }
  disclaimers: string[]
  /** Thống kê lịch sử: sau ~2–3 nến ngày, tỷ lệ đóng > đóng ngày MUA (chỉ khung 1d) */
  buyForwardOutlook?: BuyForwardOutlook | null
}

export type ChartResponse = {
  bars: ChartBar[]
  meta: ChartMeta
  advice: Advice | null
}

export type TrackListItem = {
  id: string
  symbol: string
  action: 'MUA' | 'BÁN' | 'CHỜ'
  entryDate: string
  entryPrice: number | null
  evalDueOn: string
  createdAt: string
  note?: string
  signalAsOf?: string | null
  source?: string | null
  signalSummary?: string | null
  signalScore?: number | null
  signalPayload?: Record<string, unknown> | null
  markPrice?: number | null
  markDate?: string | null
  markProvider?: string | null
  pnlPercent?: number | null
  signalCorrect?: boolean | null
  evalReady?: boolean
  todayVN?: string
}

export type TrackListResponse = {
  generatedAt: string
  summary: {
    total: number
    evalReadyCount: number
    correctCount: number
    winRatePercent: number | null
  }
  items: TrackListItem[]
}

export type ScanLatest = {
  generatedAt: string | null
  timezone: string
  trigger?: string
  scheduleNote?: string
  count: number
  results: Array<{
    symbol: string
    scannedAt?: string
    error?: string
    advice?: Advice | null
    meta?: ChartMeta
    warnings?: string[]
  }>
}

export type PickFiltersApplied = {
  signalMode?: 'balanced' | 'strict'
  minForwardWin: number
  weakMuaMinConfluence: number
  forwardMinSamples: number
  queryHintVi: string
}

export type PicksResponse = {
  generatedAt: string
  universeFromCache: boolean
  pickFilters?: PickFiltersApplied
  picks: Array<{
    symbol: string
    action: string
    confluenceScore: number
    confluenceBias: string
    summary: string
    warnings: string[]
    dataProvider?: string
    buyForwardOutlook?: BuyForwardOutlook | null
  }>
}

export type SnapshotItem = {
  symbol: string
  action: string | null
  confluenceScore: number | null
  confluenceBias: string | null
  warnings: string[]
  dataProvider?: string
  lastDate?: string | null
  lastClose?: number | null
  trendOk?: boolean
  rsi?: number | null
  error?: string
  alertLevel?: string
  scannedAt?: string
}

export type SnapshotResponse = {
  generatedAt: string
  items: SnapshotItem[]
}

export type AtcAlertPayload = {
  generatedAt: string | null
  timezone: string
  trigger?: string
  windowLabel?: string
  disclaimer?: string
  count?: number
  highlightedCount?: number
  highlighted?: SnapshotItem[]
  items?: SnapshotItem[]
}

export type ScheduleInfo = {
  timezone: string
  crons: Array<{
    time: string
    days: string
    expr: string
    label?: string
  }>
  note?: string
  atcNote?: string
}

export type CurrentUserResponse = {
  user: {
    id: string
    auth0Sub: string
    email: string | null
    name: string | null
    picture: string | null
    role: 'admin' | 'user'
  }
}

export type UserWatchlistResponse = {
  items: Array<{
    id: string
    symbol: string
    source?: string | null
    sourcePayload?: Record<string, unknown> | null
    createdAt: string
  }>
}

export type AuthAppProps = {
  isAuthConfigured: boolean
  isAuthenticated?: boolean
  isAuthLoading?: boolean
  authUser?: User
  login?: () => void
  signup?: () => void
  logout?: () => void
  getAccessToken?: () => Promise<string>
}
