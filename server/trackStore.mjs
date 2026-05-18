import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const TRACK_FILE = join(__dirname, 'data', 'signal-track.json')

/** Số phiên giao dịch (T2–T6) chờ trước khi tổng kết. */
export const EVAL_TRADING_DAYS = 5

const VN_TZ = 'Asia/Ho_Chi_Minh'
const MS_PER_DAY = 86400000

export function todayVN() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: VN_TZ,
  })
}

/** +1 ngày lịch tại VN (luôn format lại theo VN, không phụ thuộc TZ máy chủ). */
export function ymdAddOneCalendarDayVN(ymd) {
  const anchor = new Date(`${ymd}T12:00:00+07:00`)
  return new Date(anchor.getTime() + MS_PER_DAY).toLocaleDateString('en-CA', {
    timeZone: VN_TZ,
  })
}

/** Thứ 7 / chủ nhật theo lịch VN (HOSE/HNX: không phải ngày giao dịch). */
export function isVnWeekendYmd(ymd) {
  const w = new Intl.DateTimeFormat('en-US', {
    timeZone: VN_TZ,
    weekday: 'short',
  }).format(new Date(`${ymd}T12:00:00+07:00`))
  return w === 'Sat' || w === 'Sun'
}

/**
 * Cộng n **phiên giao dịch** kiểu VN (T2–T6): chỉ bỏ thứ 7 & CN theo Asia/Ho_Chi_Minh.
 * Không trừ ngày nghỉ lễ trên sàn — nếu cần khớp tuyệt đối với sàn, phải dựa chuỗi ngày có nến thực tế.
 * Không tính ngày vào là +1 phiên.
 */
export function addTradingSessionsFromEntry(entryYmd, sessionCount) {
  let ymd = entryYmd
  let counted = 0
  while (counted < sessionCount) {
    ymd = ymdAddOneCalendarDayVN(ymd)
    if (!isVnWeekendYmd(ymd)) counted++
  }
  return ymd
}

function ensureDataDir() {
  const dir = dirname(TRACK_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readTrackList() {
  try {
    if (!existsSync(TRACK_FILE)) return []
    const j = JSON.parse(readFileSync(TRACK_FILE, 'utf8'))
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

export function writeTrackList(items) {
  ensureDataDir()
  writeFileSync(TRACK_FILE, JSON.stringify(items, null, 2), 'utf8')
}

/**
 * @param {{ symbol: string, action: string, entryDate: string, entryPrice: number, note?: string }} row
 */
export function addTrackItem(row) {
  const items = readTrackList()
  const id = randomUUID()
  const rec = {
    id,
    createdAt: new Date().toISOString(),
    symbol: row.symbol.trim().toUpperCase().replace(/\.VN$/i, ''),
    action:
      row.action === 'BÁN'
        ? 'BÁN'
        : row.action === 'CHỜ'
          ? 'CHỜ'
          : 'MUA',
    entryDate: row.entryDate,
    entryPrice: row.entryPrice,
    note: row.note ? String(row.note).slice(0, 280) : undefined,
    evalDueOn: addTradingSessionsFromEntry(row.entryDate, EVAL_TRADING_DAYS),
  }
  items.push(rec)
  writeTrackList(items)
  return rec
}

export function deleteTrackItem(id) {
  const items = readTrackList().filter((x) => x.id !== id)
  writeTrackList(items)
}

/**
 * MUA: lãi ảo long = (mark - entry) / entry.
 * BÁN (kỳ vọng giảm): lãi ảo = (entry - mark) / entry.
 */
export function pnlVsSignal(action, entryPrice, markPrice) {
  if (
    markPrice == null ||
    entryPrice == null ||
    !Number.isFinite(markPrice) ||
    !Number.isFinite(entryPrice) ||
    Math.abs(entryPrice) < 1e-12
  ) {
    return { pnlPercent: null, signalCorrect: null }
  }
  const rawLong = ((markPrice - entryPrice) / entryPrice) * 100
  if (action === 'CHỜ') {
    const pnlPercent = Math.round(rawLong * 100) / 100
    return { pnlPercent, signalCorrect: null }
  }
  const raw =
    action === 'BÁN'
      ? ((entryPrice - markPrice) / entryPrice) * 100
      : rawLong
  const pnlPercent = Math.round(raw * 100) / 100
  return {
    pnlPercent,
    signalCorrect: raw > 0,
  }
}

export function canEvaluateRecord(rec, todayStr) {
  return todayStr >= rec.evalDueOn
}
