/**
 * So sánh balanced vs strict trên cùng chuỗi EOD: số lần MUA edge, tỷ lệ đóng > đóng vào sau 2/3/5 nến.
 *
 * Chạy: node server/cli/compareSignalModes.mjs
 * Hoặc:  node server/cli/compareSignalModes.mjs VCB TCB HPG
 */

import { fetchUnifiedChart } from '../providers.mjs'
import { aggregateRawOHLCV } from '../aggregate.mjs'
import { computeSignalArrays } from '../signalPayload.mjs'
import { LIQUID_CANDIDATES } from '../universe.mjs'

const HORIZONS = [2, 3, 5]
const START = 49

function countBuyEvents(sig) {
  let n = 0
  for (let i = START; i < sig.n; i++) if (sig.buyEvent[i]) n++
  return n
}

function emptyAcc() {
  const o = { signals: 0 }
  for (const h of HORIZONS) {
    o[`h${h}`] = { total: 0, wins: 0, sumR: 0 }
  }
  return o
}

function addHorizon(acc, h, entry, exit) {
  const r = ((exit - entry) / entry) * 100
  const k = `h${h}`
  acc[k].total++
  if (exit > entry) acc[k].wins++
  acc[k].sumR += r
}

function accumulateSig(acc, sig) {
  const { c, n, buyEvent } = sig
  acc.signals += countBuyEvents(sig)
  for (let i = START; i < n; i++) {
    if (!buyEvent[i]) continue
    const entry = c[i]
    if (!Number.isFinite(entry) || entry <= 0) continue
    for (const h of HORIZONS) {
      if (i + h >= n) continue
      const exit = c[i + h]
      addHorizon(acc, h, entry, exit)
    }
  }
}

function printAcc(label, acc) {
  console.log(`\n=== ${label} ===`)
  console.log(`Tổng tín hiệu MUA edge (mỗi mã đếm từ nến ${START}): ${acc.signals}`)
  for (const h of HORIZONS) {
    const x = acc[`h${h}`]
    const wr = x.total ? Math.round((x.wins / x.total) * 1000) / 10 : null
    const avg = x.total ? Math.round((x.sumR / x.total) * 100) / 100 : null
    console.log(
      `  Sau ${h} nến: n=${x.total} | thắng nhẹ (đóng>) ~${wr}% | TB %Lãi ~${avg}%`,
    )
  }
}

async function main() {
  const args = process.argv.slice(2)
  const symbols = args.length
    ? [...new Set(args.map((s) => s.trim().toUpperCase().replace(/\.VN$/i, '')))]
    : LIQUID_CANDIDATES.slice(0, 28)

  const balGrand = emptyAcc()
  const strictGrand = emptyAcc()
  let ok = 0

  for (const sym of symbols) {
    try {
      const d = sym.trim().toUpperCase()
      const { raw, provider } = await fetchUnifiedChart(d, '2y')
      if (raw.c.length < 80) continue
      const agg = aggregateRawOHLCV(raw, '1d')
      if (agg.c.length < 80) continue
      const bal = computeSignalArrays(agg, { signalMode: 'balanced' })
      const strict = computeSignalArrays(agg, { signalMode: 'strict' })
      accumulateSig(balGrand, bal)
      accumulateSig(strictGrand, strict)
      ok++
      console.error(`OK ${d} (${provider})`)
    } catch (e) {
      console.error(`Skip ${sym}: ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`\nĐã gộp ${ok}/${symbols.length} mã (2y, EOD 1d).`)
  printAcc('balanced (mặc định)', balGrand)
  printAcc('strict (đa xác nhận + điểm base + BÁN EMA20 lọc MACD)', strictGrand)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
