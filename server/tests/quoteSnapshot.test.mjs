import assert from 'node:assert/strict'
import test from 'node:test'

import { buildQuoteSnapshot } from '../signalPayload.mjs'

function makeRaw({ closes, dates, yahooQuote }) {
  return {
    dates: dates ?? closes.map((_, i) => `2026-01-${(i + 1).toString().padStart(2, '0')}`),
    o: closes,
    h: closes,
    l: closes,
    c: closes,
    v: closes.map(() => 1000),
    yahooQuote,
  }
}

test('buildQuoteSnapshot uses adjusted prev bar close when Yahoo prev close diverges (ex-rights VN case)', () => {
  const raw = makeRaw({
    closes: [18000, 17150],
    yahooQuote: {
      regularMarketPrice: 17150,
      previousClose: 19400,
      chartPreviousClose: null,
    },
  })
  const snap = buildQuoteSnapshot(raw, 'yahoo', '1d')
  assert.equal(snap.currentPrice, 17150)
  assert.equal(
    snap.previousReference,
    18000,
    'previousReference giữ theo prevBarClose, không bị Yahoo previousClose ghi đè khi lệch >2%',
  )
  assert.equal(snap.change, -850)
  assert.ok(snap.changePercent < 0 && snap.changePercent > -5)
})

test('buildQuoteSnapshot honors Yahoo previousClose when it agrees with bar chain', () => {
  const raw = makeRaw({
    closes: [17100, 17150],
    yahooQuote: {
      regularMarketPrice: 17200,
      previousClose: 17150,
      chartPreviousClose: null,
    },
  })
  const snap = buildQuoteSnapshot(raw, 'yahoo', '1d')
  assert.equal(snap.currentPrice, 17200)
  assert.equal(snap.previousReference, 17150)
})

test('buildQuoteSnapshot falls back to Yahoo previousClose when bar chain has no prev', () => {
  const raw = makeRaw({
    closes: [17150],
    yahooQuote: {
      regularMarketPrice: 17200,
      previousClose: 17100,
      chartPreviousClose: null,
    },
  })
  const snap = buildQuoteSnapshot(raw, 'yahoo', '1d')
  assert.equal(snap.previousReference, 17100)
})
