/**
 * Báo cáo (minh họa): các phiên gần đây — điểm hội tụ + nếu có tín hiệu MUA edge
 * thì % lãi/lỗ ảo tới đóng cửa mới nhất và tới sau ~5 phiên T2–T6 (EOD Yahoo/…).
 *
 * Chạy: node cli/reportWeekMua.mjs CTG DBH DPM
 */

import { fetchUnifiedChart, yahooTicker } from '../providers.mjs'
import { aggregateRawOHLCV } from '../aggregate.mjs'
import { computePayload } from '../signalPayload.mjs'
import { addTradingSessionsFromEntry } from '../trackStore.mjs'

function sliceRawToIndex(raw, endIncl) {
  return {
    dates: raw.dates.slice(0, endIncl + 1),
    o: raw.o.slice(0, endIncl + 1),
    h: raw.h.slice(0, endIncl + 1),
    l: raw.l.slice(0, endIncl + 1),
    c: raw.c.slice(0, endIncl + 1),
    v: raw.v.slice(0, endIncl + 1),
  }
}

function exitIndexAfterSessions(dates, entryIdx, sessions) {
  if (entryIdx < 0 || entryIdx >= dates.length) return dates.length - 1
  const due = addTradingSessionsFromEntry(dates[entryIdx], sessions)
  for (let j = entryIdx + 1; j < dates.length; j++) {
    if (dates[j] >= due) return j
  }
  return dates.length - 1
}

async function reportSymbol(symDisplay) {
  const d = symDisplay.trim().toUpperCase().replace(/\.VN$/i, '')
  const y = yahooTicker(d)
  const { raw, provider } = await fetchUnifiedChart(d, '2y')
  if (!raw.c.length) {
    console.error(`\n=== ${d} ===\nKhông có dữ liệu.\n`)
    return
  }
  const agg = aggregateRawOHLCV(raw, '1d')
  const n = agg.c.length
  const lastI = n - 1
  const lookback = Math.min(7, n - 50)
  const startI = Math.max(49, lastI - lookback + 1)

  console.log(`\n=== ${d} (${provider}) — ${lookback} phiên gần nhất, EOD ===`)
  console.log(
    'Ngày\t\tHành động\tĐiểm\tBias\t\t\tGiá vào\t%→cuối\t%→+5phiên\tGhi chú',
  )

  for (let i = startI; i <= lastI; i++) {
    const sliced = sliceRawToIndex(agg, i)
    const payload = computePayload(sliced, d, y, provider, '1d')
    const adv = payload.advice
    const action = adv?.action ?? '—'
    const sc = adv?.confluence?.score ?? '—'
    const bias = adv?.confluence?.bias ?? '—'
    const entry = agg.c[i]
    const date = agg.dates[i]

    let pctToLast = '—'
    let pctAfter5 = '—'
    let note = ''

    if (adv?.action === 'MUA' && entry > 0) {
      const lastClose = agg.c[lastI]
      pctToLast = (
        ((lastClose - entry) / entry) *
        100
      ).toFixed(2)
      const j5 = exitIndexAfterSessions(agg.dates, i, 5)
      const c5 = agg.c[j5]
      pctAfter5 = (((c5 - entry) / entry) * 100).toFixed(2)
      if (j5 === lastI && agg.dates[j5] < addTradingSessionsFromEntry(date, 5)) {
        note = 'chưa đủ 5 phiên sau trong dữ liệu'
      }
      const tp1 = adv.takeProfit1
      const sl = adv.stopLoss
      if (tp1 != null && lastClose >= tp1) note += (note ? '; ' : '') + 'đạt TP1 gợi ý'
      if (sl != null && lastClose <= sl) note += (note ? '; ' : '') + 'chạm SL gợi ý'
    }

    const biasShort =
      typeof bias === 'string' && bias.length > 18
        ? bias.slice(0, 18) + '…'
        : bias

    console.log(
      `${date}\t${action}\t\t${sc}\t${biasShort}\t${entry.toFixed(3)}\t${String(pctToLast)}\t${String(pctAfter5)}\t${note}`,
    )
  }
}

const syms = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['CTG', 'DBH', 'DPM']

for (const s of syms) {
  try {
    await reportSymbol(s)
    await new Promise((r) => setTimeout(r, 400))
  } catch (e) {
    console.error(`Lỗi ${s}:`, e instanceof Error ? e.message : e)
  }
}

console.log(
  '\n(Minh họa kỹ thuật; dữ liệu có thể trễ so sàn. % là giá đóng cửa series, không phí.)',
)
