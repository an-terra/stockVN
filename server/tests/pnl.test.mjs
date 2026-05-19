import assert from 'node:assert/strict'
import test from 'node:test'

import { pnlVsSignal } from '../trackStore.mjs'

test('pnlVsSignal calculates long P&L for MUA', () => {
  assert.deepEqual(pnlVsSignal('MUA', 100, 112.345), {
    pnlPercent: 12.35,
    signalCorrect: true,
  })
})

test('pnlVsSignal calculates inverse P&L for BAN signal', () => {
  assert.deepEqual(pnlVsSignal('BÁN', 100, 92), {
    pnlPercent: 8,
    signalCorrect: true,
  })
})

test('pnlVsSignal handles CHO and invalid prices', () => {
  assert.deepEqual(pnlVsSignal('CHỜ', 100, 103), {
    pnlPercent: 3,
    signalCorrect: null,
  })
  assert.deepEqual(pnlVsSignal('MUA', 0, 103), {
    pnlPercent: null,
    signalCorrect: null,
  })
})
