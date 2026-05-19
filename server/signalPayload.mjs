// signalPayload.mjs — logic computePayload / buildQuoteSnapshot / buildWarnings (đồng bộ với index.mjs)
// Chuỗi OHLCV ngày từ provider đã là các phiên có khớp (bỏ ngày nghỉ sàn / cuối tuần). Đếm nến = đếm phiên T2–T6 thực tế trong dữ liệu.

function classicSchooledContext(i, ctx) {
  const { c, l, ema20, ema50, atr, rsi, trendOk, breakout, macd, signal } = ctx
  const factors = []
  let delta = 0
  const close = c[i]
  const em20 = ema20[i]
  const em50v = ema50[i]
  const atrv = atr[i]
  const r = rsi[i]

  if (i >= 21 && atrv != null) {
    let s = 0
    let cnt = 0
    for (let j = i - 20; j < i; j++) {
      if (atr[j] != null) {
        s += atr[j]
        cnt++
      }
    }
    if (cnt > 0) {
      const atrMean = s / cnt
      if (atrv < atrMean * 0.88) {
        delta += 3
        factors.push({
          tag: 'tham_chieu',
          text:
            'ATR hiện co hẹp hơn trung bình ~20 phiên trước — thường được diễn giải là giai đoạn tích lũy trước khi chọn hướng (ý tưởng “co biến động / volatility contraction” trong nhiều hệ breakout).',
        })
      }
    }
  }

  if (em20 != null && atrv != null && close > em20 + 2.25 * atrv) {
    delta -= 5
    factors.push({
      tag: 'tham_chieu',
      text:
        'Giá kéo xa EMA20 so với ATR — rủi ro hồi kỹ thuật; hạn chế mua đuổi, ưu tiên stop (tinh thần quản trị rủi ro / tránh FOMO trong các tài liệu cổ điển về đầu cơ).',
    })
  }

  if (i >= 6 && trendOk[i] && em20 != null) {
    const prevLow = Math.min(l[i - 3], l[i - 4], l[i - 5])
    if (l[i] > prevLow * 1.001 && close > em20) {
      delta += 4
      factors.push({
        tag: 'tham_chieu',
        text:
          'Đáy các nhịp gần có xu hướng cao dần, giá trên EMA50 — HH/HL đơn giản (tinh thần ưu tiên giao dịch thuận xu hướng “leo thang”, như học thuyết Dow / trend-following phổ biến).',
      })
    }
  }

  if (
    !trendOk[i] &&
    em20 != null &&
    em50v != null &&
    em20 < em50v &&
    close < em20 &&
    r != null &&
    r < 34
  ) {
    const m = macd[i]
    const sig = signal[i]
    if (m != null && sig != null && m < sig) {
      delta -= 6
      factors.push({
        tag: 'tham_chieu',
        text:
          'Giá dưới các MA chính, RSI yếu, MACD dưới tín hiệu — nguyên tắc thận trọng “không bắt dao rơi” cho tới khi có xác nhận đảo chiều (tài liệu về trend và tâm lý đám đông).',
      })
    }
  }

  if (breakout?.[i]) {
    delta += 2
    factors.push({
      tag: 'tham_chieu',
      text:
        'Break khỏi vùng đỉnh gần kèm khối lượng — gần tinh thần “nền + bứt” trong các tài liệu về mạnh giá (ý tưởng giáo dục: Darvas box / base breakout, không phải hệ lọc đầy đủ kiểu CAN SLIM).',
    })
  }

  return { delta, factors }
}

/**
 * Điểm hội tụ 0–100: xu hướng (EMA), động lượng (RSI + MACD), khối lượng, biến động (ATR%).
 * @param {{ omitRuleBuyBonus?: boolean }} [confOpts] — bỏ +6 khi buyRaw (dùng làm ngưỡng strict không phản hồi từ chính tín hiệu MUA).
 */
function computeConfluence(i, ctx, confOpts = {}) {
  const omitRuleBuyBonus = confOpts.omitRuleBuyBonus === true
  const {
    c,
    l,
    ema20,
    ema50,
    rsi,
    v,
    vma20,
    atr,
    trendOk,
    buyRaw,
    macd,
    signal,
    hist,
    breakout,
  } = ctx
  const factors = []
  let score = 48
  const close = c[i]
  const em20 = ema20[i]
  const em50v = ema50[i]
  const r = rsi[i]
  const vma = vma20[i]
  const atrv = atr[i]
  const vol = v[i]

  if (
    em20 != null &&
    em50v != null &&
    em20 > em50v &&
    close > em20
  ) {
    score += 16
    factors.push({
      tag: 'xu_hướng',
      text: 'EMA20 > EMA50 và giá trên EMA20 (cấu trúc tăng ngắn hạn).',
    })
  } else if (trendOk[i]) {
    score += 9
    factors.push({
      tag: 'xu_hướng',
      text: 'Giá trên EMA50 (bias tăng trung hạn).',
    })
  } else {
    factors.push({
      tag: 'xu_hướng',
      text: 'Chưa có xếp bull rõ (EMA20/50) hoặc giá dưới EMA50.',
    })
  }

  if (r != null) {
    if (r >= 30 && r <= 45) {
      score += 8
      factors.push({
        tag: 'rsi',
        text: 'RSI vùng hồi sau quá bán — có thể có nhịp kỹ thuật (cần volume).',
      })
    } else if (r > 45 && r < 62) {
      score += 5
      factors.push({
        tag: 'rsi',
        text: 'RSI trung tính — không cực đoan quá mua/quá bán.',
      })
    } else if (r >= 68) {
      score -= 14
      factors.push({
        tag: 'rsi',
        text: 'RSI cao — rủi ro chốt lời/chỉnh; ưu tiên quản trị vị thế.',
      })
    } else if (r < 28) {
      score -= 4
      factors.push({
        tag: 'rsi',
        text: 'RSI rất thấp — có thể hồi nhưng dễ false bounce nếu trend yếu.',
      })
    }
  }

  if (vma != null && vol > vma * 1.12) {
    score += 10
    factors.push({
      tag: 'volume',
      text: 'Volume trên trung bình 20 phiên — có quan tâm dòng tiền.',
    })
  } else if (vma != null) {
    factors.push({
      tag: 'volume',
      text: 'Volume không vượt rõ TB20 — breakout/bounce cần xác nhận thêm.',
    })
  }

  if (atrv != null && close > 0) {
    const pct = (atrv / close) * 100
    if (pct > 4.5) {
      score -= 8
      factors.push({
        tag: 'bien_dong',
        text: `ATR/ giá ~${pct.toFixed(1)}% — biến động lớn, stop/lệnh cần tính buffer.`,
      })
    } else if (pct < 1.8) {
      score += 3
      factors.push({
        tag: 'bien_dong',
        text: 'Biến động ATR thấp hơn trung bình gần đây (tương đối “êm”).',
      })
    }
  }

  if (!omitRuleBuyBonus && buyRaw[i]) {
    score += 6
    factors.push({
      tag: 'rule',
      text: 'Ít nhất một điều kiện rule MUA đang bật trên cây này.',
    })
  }

  const m = macd?.[i]
  const sig = signal?.[i]
  const hi = hist?.[i]
  if (hi != null && m != null && sig != null) {
    if (hi > 0 && m > sig) {
      score += 5
      factors.push({
        tag: 'macd',
        text: 'MACD trên đường tín hiệu, histogram dương — động lượng tăng giá.',
      })
    } else if (hi < 0 && m < sig && close < em20) {
      score -= 6
      factors.push({
        tag: 'macd',
        text: 'MACD dưới tín hiệu kèm giá dưới EMA20 — động lượng suy yếu.',
      })
    }
  }

  const edu = classicSchooledContext(i, {
    c,
    l,
    ema20,
    ema50,
    atr,
    rsi,
    trendOk,
    breakout,
    macd,
    signal,
  })
  score += edu.delta
  for (const ef of edu.factors) factors.push(ef)

  score = Math.max(0, Math.min(100, Math.round(score)))

  let bias = 'TRUNG LẬP'
  if (score >= 63) bias = 'THIÊN MUA (hội tụ kỹ thuật)'
  else if (score <= 37) bias = 'THIÊN BÁN / THẬN TRỌNG'

  return { score, bias, factors }
}

/** Điểm hội tụ tại i không cộng +6 vì buyRaw (dùng làm ngưỡng strict). */
export function confluenceScoreBaseAt(i, ctx) {
  return computeConfluence(i, ctx, { omitRuleBuyBonus: true }).score
}

const DEFAULT_STRICT_MIN_BRANCHES = 2
const DEFAULT_STRICT_MIN_CONF_BASE = 55

export function normalizeSignalMode(v) {
  return v === 'strict' ? 'strict' : 'balanced'
}

export function normalizeSignalArrayOptions(opts = {}) {
  const signalMode = normalizeSignalMode(opts.signalMode)
  let strictMinBranches = Number(opts.strictMinBranches)
  if (!Number.isFinite(strictMinBranches)) strictMinBranches = DEFAULT_STRICT_MIN_BRANCHES
  strictMinBranches = Math.min(5, Math.max(1, Math.round(strictMinBranches)))
  let strictMinConfluenceBase = Number(opts.strictMinConfluenceBase)
  if (!Number.isFinite(strictMinConfluenceBase)) {
    strictMinConfluenceBase = DEFAULT_STRICT_MIN_CONF_BASE
  }
  strictMinConfluenceBase = Math.min(72, Math.max(50, Math.round(strictMinConfluenceBase)))
  return {
    signalMode,
    strictMinBranches,
    strictMinConfluenceBase,
  }
}

function emaSeries(closes, span) {
  const n = closes.length
  const out = Array(n).fill(null)
  if (n < span) return out
  const alpha = 2 / (span + 1)
  let sma = 0
  for (let i = 0; i < span; i++) sma += closes[i]
  sma /= span
  out[span - 1] = sma
  let prev = sma
  for (let i = span; i < n; i++) {
    prev = closes[i] * alpha + prev * (1 - alpha)
    out[i] = prev
  }
  return out
}

function rsiSeries(closes, period = 14) {
  const n = closes.length
  const rsis = Array(n).fill(null)
  if (n <= period) return rsis

  const gains = []
  const losses = []
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1]
    gains.push(Math.max(d, 0))
    losses.push(Math.max(-d, 0))
  }

  let ag = 0
  let al = 0
  for (let i = 0; i < period; i++) {
    ag += gains[i]
    al += losses[i]
  }
  ag /= period
  al /= period

  const idx = period
  if (al === 0) rsis[idx] = ag > 0 ? 100 : 50
  else rsis[idx] = 100 - 100 / (1 + ag / al)

  for (let i = period + 1; i < n; i++) {
    const g = gains[i - 1]
    const l = losses[i - 1]
    ag = (ag * (period - 1) + g) / period
    al = (al * (period - 1) + l) / period
    if (al === 0) rsis[i] = ag > 0 ? 100 : 50
    else rsis[i] = 100 - 100 / (1 + ag / al)
  }
  return rsis
}

function trueRange(h, l, c, i) {
  if (i === 0) return h[i] - l[i]
  const pc = c[i - 1]
  return Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc))
}

/** ATR Wilder 14 */
function atrSeries(h, l, c, period = 14) {
  const n = c.length
  const out = Array(n).fill(null)
  if (n < period) return out
  let sum = 0
  for (let i = 0; i < period; i++) sum += trueRange(h, l, c, i)
  let atr = sum / period
  out[period - 1] = atr
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + trueRange(h, l, c, i)) / period
    out[i] = atr
  }
  return out
}

/** MACD cổ điển (12, 26, 9): line = EMA12−EMA26, signal = EMA9(line), hist = line−signal */
function macdTriple(closes) {
  const n = closes.length
  const macd = Array(n).fill(null)
  const signal = Array(n).fill(null)
  const hist = Array(n).fill(null)
  if (n < 35) return { macd, signal, hist }
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  for (let i = 0; i < n; i++) {
    if (ema12[i] != null && ema26[i] != null) macd[i] = ema12[i] - ema26[i]
  }
  const first = macd.findIndex((x) => x != null)
  if (first === -1) return { macd, signal, hist }
  const tail = macd.slice(first)
  const sigTail = emaSeries(tail, 9)
  for (let j = 0; j < tail.length; j++) {
    const i = first + j
    signal[i] = sigTail[j]
    if (sigTail[j] != null && macd[i] != null) hist[i] = macd[i] - sigTail[j]
  }
  return { macd, signal, hist }
}

function rollingMax(values, window) {
  const n = values.length
  const out = Array(n).fill(null)
  for (let i = window - 1; i < n; i++) {
    let m = values[i - window + 1]
    for (let j = i - window + 2; j <= i; j++) if (values[j] > m) m = values[j]
    out[i] = m
  }
  return out
}

function rollingMean(values, window) {
  const n = values.length
  const out = Array(n).fill(null)
  for (let i = window - 1; i < n; i++) {
    let s = 0
    for (let j = i - window + 1; j <= i; j++) s += values[j]
    out[i] = s / window
  }
  return out
}

function buildAdvice(i, ctx) {
  const {
    dates,
    c,
    l,
    ema20,
    ema50,
    rsi,
    atr,
    buyEvent,
    sellEvent,
    buyRaw,
    trendOk,
    hiRoll,
    v,
    vma20,
    macd,
    signal,
    hist,
    breakout,
  } = ctx

  const close = c[i]
  const em20 = ema20[i]
  const em50v = ema50[i]
  const r = rsi[i]
  const atrv = atr[i]
  const recentHigh = hiRoll[i] != null ? hiRoll[i] : close

  let action = 'CHỜ'
  if (buyEvent[i]) action = 'MUA'
  else if (sellEvent[i]) action = 'BÁN'

  const tpAtr1 =
    atrv != null ? Math.round(close + 1.5 * atrv) : null
  const tpAtr2 =
    atrv != null ? Math.round(close + 2.5 * atrv) : null
  const swingTp =
    recentHigh > close ? Math.round(recentHigh) : tpAtr1

  const stopAtr =
    atrv != null ? Math.round(close - 1.25 * atrv) : null
  const stopEma =
    em20 != null ? Math.round(em20 * 0.985) : null
  let stopLoss = stopAtr
  if (stopEma != null && stopAtr != null) {
    stopLoss = Math.min(stopAtr, stopEma)
  } else if (stopLoss == null) stopLoss = stopEma

  const buyWhen = [
    'Xem xét MUA khi có marker MUA: RSI hồi từ quá bán (cắt lên 30), golden cross, breakout có volume, MACD cắt lên đường tín hiệu, hoặc hồi kiểm tra EMA20 trong uptrend.',
    'Ưu tiên khi giá duy trì trên EMA20; trên EMA50 càng xác nhận xu hướng tốt hơn.',
    'Trong phiên: theo dõi thêm khối lượng và biên độ so với ATR gần nhất.',
    'Đọc các dòng [tham_chieu] trong hội tụ: ý tưởng từ tài liệu công khai (xu hướng, breakout, co biến động…) — học để hiểu bối cảnh, không thay sách hay tư vấn chuyên nghiệp.',
  ]
  const sellWhen = [
    'Cân nhắc BÁN/giảm vị thế khi có tín hiệu: giá cắt xuống EMA20, death cross (EMA20 cắt xuống EMA50), hoặc MACD cắt xuống tín hiệu khi cấu trúc/EMA đang yếu.',
    'Chốt lời từng phần gần mục tiêu TP1/TP2 hoặc đỉnh 20 phiên gần nhất.',
    'RSI trên ~70 lâu: có thể bán một phần, không cần bắt đỉnh tuyệt đối.',
  ]

  if (r != null && r < 38) {
    buyWhen.push('RSI đang thấp: có thể chờ bứt lại trên ~32–35 để xác nhận lực hồi.')
  }
  if (r != null && r > 68) {
    sellWhen.push('RSI đang cao: tăng xác suất chỉnh nhịp ngắn — bảo vệ lãi.')
  }
  if (!trendOk[i] && action === 'CHỜ') {
    buyWhen.push('Giá dưới EMA50: xu hướng dài chưa rõ; MUA chỉ nên là tỷ lệ nhỏ nếu bắt nhịp ngắn.')
  }

  let summary = ''
  if (action === 'MUA') {
    summary =
      'Hệ thống ghi nhận tín hiệu MUA (edge) theo rule — chỉ mang tính minh họa; cần khớp kế hoạch vốn và rủi ro của bạn.'
  } else if (action === 'BÁN') {
    summary =
      'Tín hiệu BÁN minh họa: có thể là cắt xuống EMA20, death cross (EMA20/EMA50), hoặc MACD cắt xuống khi giá/CMA đang yếu — tham chiếu stop/mục tiêu để quản trị.'
  } else if (buyRaw[i]) {
    summary =
      'Chưa phải ngày “edge” MUA nhưng một phần điều kiện kỹ thuật vẫn đang bật — chờ xác nhận hoặc chia vốn nhỏ.'
    buyWhen.push(
      'Một số điều kiện mua (RSI/breakout/golden/MACD/hồi EMA20) đang bật liên tiếp; có thể đang trong nhịp tích lũy.',
    )
  } else {
    summary =
      'Chưa có MUA/BÁN edge ở cây mới nhất. Dùng TP/SL gợi ý theo ATR làm khung tham chiếu, không phải cam kết giá.'
  }

  const confluence = computeConfluence(i, {
    c,
    l,
    ema20,
    ema50,
    rsi,
    v,
    vma20,
    atr,
    trendOk,
    buyRaw,
    macd,
    signal,
    hist,
    breakout,
  })

  return {
    action,
    summary,
    asOf: dates[i],
    takeProfit1: tpAtr1,
    takeProfit2: tpAtr2,
    takeProfitSwing: swingTp,
    stopLoss,
    atr14:
      atrv != null ? Math.round(atrv * 1000) / 1000 : null,
    resistanceHint:
      recentHigh != null ? Math.round(recentHigh) : null,
    supportEma20: em20 != null ? Math.round(em20 * 100) / 100 : null,
    supportEma50: em50v != null ? Math.round(em50v * 100) / 100 : null,
    buyWhen,
    sellWhen,
    confluence,
    disclaimers: [
      'Mục tiêu/stop dựa trên ATR & MA — không phải dự báo giá hay khuyến nghị đầu tư.',
      'Trong phiên VN, dữ liệu Yahoo có thể trễ hoặc lệch vài bước giá so với sàn thực tế.',
      'Điểm hội tụ là mô hình điểm số minh họa; không thay phân tích cơ bản, dòng tiền ngành hay quản trị rủi ro cá nhân.',
      'Thẻ [tham_chieu] là nguyên lý đã được nhiều tài liệu nhắc tới (tinh thần thuận xu hướng, nền+bứt, co biến động, tránh chống trend mạnh). Đó không phải mô phỏng phương pháp độc quyền của bất kỳ “trader nổi tiếng” nào.',
    ],
  }
}

/**
 * Giá "hiện tại" + chênh so với tham chiếu (phiên trước / Yahoo meta).
 */
export function buildQuoteSnapshot(raw, dataProvider, intervalNorm) {
  const c = raw.c
  const n = c.length
  const lastBarClose = n ? c[n - 1] : null
  const prevBarClose = n >= 2 ? c[n - 2] : null

  if (lastBarClose == null) {
    return {
      currentPrice: null,
      previousReference: null,
      change: null,
      changePercent: null,
      changeHint: null,
    }
  }

  let currentPrice = lastBarClose
  let previousReference = prevBarClose
  let changeHint =
    intervalNorm === '1w'
      ? 'So với đóng cửa nến tuần trước (dữ liệu EOD).'
      : intervalNorm === '1M'
        ? 'So với đóng cửa nến tháng trước (dữ liệu EOD).'
        : 'So với đóng cửa phiên giao dịch trước (EOD).'

  const yq = raw.yahooQuote
  if (intervalNorm === '1d' && dataProvider === 'yahoo' && yq) {
    if (
      yq.regularMarketPrice != null &&
      Number.isFinite(yq.regularMarketPrice)
    ) {
      currentPrice = yq.regularMarketPrice
      changeHint =
        'Giá hiện tại lấy từ Yahoo (có thể trễ vài phút); đóng tham chiếu là phiên trước đã điều chỉnh quyền/cổ tức (nếu có).'
    }
    // Yahoo meta.previousClose là close RAW (chưa trừ ex-right / cổ tức của VN).
    // Chỉ dùng làm fallback khi chuỗi bar không có prevBarClose, hoặc khi chênh lệch nhỏ (< 2%).
    const yPrev = yq.previousClose ?? yq.chartPreviousClose
    if (yPrev != null && Number.isFinite(yPrev)) {
      if (previousReference == null) {
        previousReference = yPrev
      } else if (
        Number.isFinite(previousReference) &&
        Math.abs(previousReference) > 1e-12 &&
        Math.abs(yPrev - previousReference) / Math.abs(previousReference) <= 0.02
      ) {
        previousReference = yPrev
      }
    }
  }

  const change =
    previousReference != null
      ? Math.round((currentPrice - previousReference) * 10000) / 10000
      : null
  const changePercent =
    previousReference != null && Math.abs(previousReference) > 1e-12
      ? Math.round(((currentPrice - previousReference) / previousReference) * 10000) /
        100
      : null

  return {
    currentPrice: Math.round(currentPrice * 10000) / 10000,
    previousReference:
      previousReference != null
        ? Math.round(previousReference * 10000) / 10000
        : null,
    change,
    changePercent,
    changeHint,
  }
}
/**
 * Trạng thái rule MUA/BÁN trên toàn chuỗi (nến ngày = phiên VN có dữ liệu).
 * @param {{ signalMode?: string, strictMinBranches?: number, strictMinConfluenceBase?: number }} [signalOpts]
 */
export function computeSignalArrays(raw, signalOpts = {}) {
  const {
    signalMode,
    strictMinBranches,
    strictMinConfluenceBase,
  } = normalizeSignalArrayOptions(signalOpts)
  const { dates, o, h, l, c, v } = raw
  const n = c.length
  const ema20 = emaSeries(c, 20)
  const ema50 = emaSeries(c, 50)
  const rsi = rsiSeries(c, 14)
  const vma20 = rollingMean(v, 20)
  const hiRoll = rollingMax(h, 20)
  const atr = atrSeries(h, l, c, 14)
  const { macd, signal, hist } = macdTriple(c)

  const trendOk = Array(n)
    .fill(false)
    .map((_, i) => ema50[i] != null && c[i] > ema50[i])

  const rsiCross = Array(n).fill(false)
  const breakout = Array(n).fill(false)
  const goldenCross = Array(n).fill(false)
  const deathCross = Array(n).fill(false)
  const sellCross = Array(n).fill(false)
  const macdBullCross = Array(n).fill(false)
  const macdBearCross = Array(n).fill(false)
  const pullbackEma20 = Array(n).fill(false)

  for (let i = 0; i < n; i++) {
    const r0 = i > 0 ? rsi[i - 1] : null
    const r1 = rsi[i]
    if (r0 != null && r1 != null) rsiCross[i] = r0 <= 30 && r1 > 30

    const vma = vma20[i]
    const hip = i > 0 ? hiRoll[i - 1] : null
    if (vma != null && hip != null) breakout[i] = c[i] > hip && v[i] > vma

    if (
      i > 0 &&
      ema20[i - 1] != null &&
      ema50[i - 1] != null &&
      ema20[i] != null &&
      ema50[i] != null
    ) {
      goldenCross[i] = ema20[i - 1] <= ema50[i - 1] && ema20[i] > ema50[i]
      deathCross[i] = ema20[i - 1] >= ema50[i - 1] && ema20[i] < ema50[i]
    }

    if (i > 0 && ema20[i] != null && ema20[i - 1] != null) {
      sellCross[i] = c[i] < ema20[i] && c[i - 1] >= ema20[i - 1]
    }

    if (
      i > 0 &&
      macd[i - 1] != null &&
      macd[i] != null &&
      signal[i - 1] != null &&
      signal[i] != null
    ) {
      macdBullCross[i] = macd[i - 1] <= signal[i - 1] && macd[i] > signal[i]
      macdBearCross[i] = macd[i - 1] >= signal[i - 1] && macd[i] < signal[i]
    }

    const e20 = ema20[i]
    if (
      i > 0 &&
      trendOk[i] &&
      e20 != null &&
      c[i] > e20 &&
      l[i] <= e20 * 1.015 &&
      c[i] > o[i] &&
      rsi[i] != null &&
      rsi[i - 1] != null &&
      rsi[i] > rsi[i - 1] &&
      rsi[i] < 58
    ) {
      pullbackEma20[i] = true
    }
  }

  const macdBearFiltered = Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    if (!macdBearCross[i]) continue
    const structBear =
      (ema20[i] != null && ema50[i] != null && ema20[i] < ema50[i]) ||
      (ema20[i] != null && c[i] < ema20[i])
    macdBearFiltered[i] = structBear
  }

  const buyRaw = Array(n)
    .fill(false)
    .map(
      (_, i) =>
        rsiCross[i] ||
        breakout[i] ||
        goldenCross[i] ||
        macdBullCross[i] ||
        pullbackEma20[i],
    )

  const buyEvent = Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? buyRaw[i - 1] : false
    buyEvent[i] = buyRaw[i] && !prev
  }

  const sellCrossForEvent = Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    if (!sellCross[i]) continue
    if (signalMode !== 'strict') {
      sellCrossForEvent[i] = true
      continue
    }
    const hi = hist[i]
    const m = macd[i]
    const sigL = signal[i]
    if (hi != null && hi < 0) {
      sellCrossForEvent[i] = true
    } else if (m != null && sigL != null && m < sigL) {
      sellCrossForEvent[i] = true
    }
  }

  const sellEvent = Array(n)
    .fill(false)
    .map((_, i) => sellCrossForEvent[i] || deathCross[i] || macdBearFiltered[i])

  for (let i = 0; i < n; i++) {
    if (buyEvent[i] && sellEvent[i]) buyEvent[i] = false
  }

  if (signalMode === 'strict') {
    const confluenceCtx = {
      c,
      l,
      ema20,
      ema50,
      rsi,
      v,
      vma20,
      atr,
      trendOk,
      buyRaw,
      macd,
      signal,
      hist,
      breakout,
    }
    const startStrict = 49
    for (let i = startStrict; i < n; i++) {
      if (!buyEvent[i]) continue
      let br = 0
      if (rsiCross[i]) br++
      if (breakout[i]) br++
      if (goldenCross[i]) br++
      if (macdBullCross[i]) br++
      if (pullbackEma20[i]) br++
      if (!trendOk[i] || br < strictMinBranches) {
        buyEvent[i] = false
        continue
      }
      const baseScore = computeConfluence(i, confluenceCtx, {
        omitRuleBuyBonus: true,
      }).score
      if (baseScore < strictMinConfluenceBase) buyEvent[i] = false
    }
  }

  return {
    dates,
    o,
    h,
    l,
    c,
    v,
    n,
    ema20,
    ema50,
    rsi,
    vma20,
    hiRoll,
    atr,
    macd,
    signal,
    hist,
    trendOk,
    rsiCross,
    breakout,
    goldenCross,
    deathCross,
    sellCross,
    macdBullCross,
    macdBearCross,
    pullbackEma20,
    macdBearFiltered,
    buyRaw,
    buyEvent,
    sellEvent,
    sellCrossForEvent,
    signalMode,
    strictMinBranches: signalMode === 'strict' ? strictMinBranches : null,
    strictMinConfluenceBase:
      signalMode === 'strict' ? strictMinConfluenceBase : null,
  }
}

/** Thống kê lịch sử: tại phiên có tín hiệu MUA edge, sau h nến đóng cửa có > giá vào. */
function statsMuaAfterHBars(sig, h, minSamples) {
  const { c, n, buyEvent } = sig
  const start = 49
  let wins = 0
  let total = 0
  let sumR = 0
  for (let i = start; i + h < n; i++) {
    if (!buyEvent[i]) continue
    const entry = c[i]
    const exit = c[i + h]
    if (!Number.isFinite(entry) || entry <= 0) continue
    total++
    const r = ((exit - entry) / entry) * 100
    sumR += r
    if (exit > entry) wins++
  }
  if (total < minSamples) {
    return {
      enough: false,
      barsAhead: h,
      sampleCount: total,
      winRatePercent: null,
      avgReturnPercent: null,
    }
  }
  return {
    enough: true,
    barsAhead: h,
    sampleCount: total,
    winRatePercent: Math.round((wins / total) * 1000) / 10,
    avgReturnPercent: Math.round((sumR / total) * 100) / 100,
  }
}

/**
 * Ước lượng từ quá khứ: sau 2 vs 3 nến (≈ “2,5 phiên”) khớp EOD, tỷ lệ lần có lãi nhẹ (đóng > đóng vào).
 * Không dự báo tương lai; khi ít mẫu trả về enough: false.
 */
function muaFollowThroughOutlook(sig, minSamples = 10) {
  const after2 = statsMuaAfterHBars(sig, 2, minSamples)
  const after3 = statsMuaAfterHBars(sig, 3, minSamples)
  let blendWin = null
  let blendAvg = null
  const blendEnough = after2.enough && after3.enough
  if (blendEnough) {
    blendWin =
      Math.round(((after2.winRatePercent + after3.winRatePercent) / 2) * 10) / 10
    blendAvg =
      Math.round(((after2.avgReturnPercent + after3.avgReturnPercent) / 2) * 100) /
      100
  }
  return {
    after2Bars: after2,
    after3Bars: after3,
    blend2_3Sessions: {
      enough: blendEnough,
      winRatePercent: blendWin,
      avgReturnPercent: blendAvg,
      label: 'Trung bình 2 và 3 nến (gần 2,5 phiên EOD)',
    },
  }
}

export function historicalMuaFollowThroughStats(raw, minSamples = 10, signalOpts = {}) {
  return muaFollowThroughOutlook(
    computeSignalArrays(raw, signalOpts),
    minSamples,
  )
}

/**
 * @param {object} [options]
 * @param {number} [options.muaForwardMinSamples] Clamp 5–40.
 * @param {string} [options.signalMode] balanced | strict
 * @param {number} [options.strictMinBranches] strict: tối thiểu số nhánh MUA đồng thời (1–5).
 * @param {number} [options.strictMinConfluenceBase] strict: điểm hội tụ base tối thiểu (50–72).
 */
export function computePayload(
  raw,
  symDisplay,
  symYahoo,
  dataProvider = 'yahoo',
  chartInterval = '1d',
  options = {},
) {
  let muaForwardMinSamples = 10
  if (
    options &&
    typeof options.muaForwardMinSamples === 'number' &&
    Number.isFinite(options.muaForwardMinSamples)
  ) {
    muaForwardMinSamples = Math.round(options.muaForwardMinSamples)
  }
  muaForwardMinSamples = Math.min(40, Math.max(5, muaForwardMinSamples))

  const signalArrayOpts = normalizeSignalArrayOptions({
    signalMode: options?.signalMode,
    strictMinBranches: options?.strictMinBranches,
    strictMinConfluenceBase: options?.strictMinConfluenceBase,
  })

  const sigArrays = computeSignalArrays(raw, signalArrayOpts)
  const {
    dates,
    o,
    h,
    l,
    c,
    v,
    n,
    ema20,
    ema50,
    rsi,
    vma20,
    hiRoll,
    atr,
    macd,
    signal,
    hist,
    trendOk,
    rsiCross,
    breakout,
    goldenCross,
    deathCross,
    sellCross,
    macdBullCross,
    macdBearCross,
    pullbackEma20,
    macdBearFiltered,
    buyRaw,
    buyEvent,
    sellEvent,
    sellCrossForEvent,
    signalMode: appliedSignalMode,
    strictMinBranches: appliedStrictBranches,
    strictMinConfluenceBase: appliedStrictConfBase,
  } = sigArrays

  const bars = []
  const startPlot = 49
  for (let i = startPlot; i < n; i++) {
    if (ema20[i] == null || ema50[i] == null) continue
    const reasons = []
    if (buyEvent[i]) {
      if (goldenCross[i]) reasons.push('EMA20 cắt lên EMA50 (golden cross)')
      if (rsiCross[i]) reasons.push('RSI cắt lên 30 sau vùng quá bán')
      if (breakout[i]) reasons.push('Breakout đỉnh 20 phiên + volume > TB20')
      if (macdBullCross[i]) reasons.push('MACD cắt lên đường tín hiệu')
      if (pullbackEma20[i])
        reasons.push('Hồi kiểm tra EMA20 trong uptrend (nến tăng + RSI cải thiện)')
    }
    if (sellEvent[i]) {
      if (sellCross[i] && sellCrossForEvent[i]) {
        reasons.push(
          appliedSignalMode === 'strict'
            ? 'Giá cắt xuống EMA20 (strict: kèm histogram âm hoặc MACD dưới tín hiệu)'
            : 'Giá cắt xuống EMA20',
        )
      }
      if (deathCross[i]) reasons.push('EMA20 cắt xuống EMA50 (death cross)')
      if (macdBearFiltered[i])
        reasons.push('MACD cắt xuống tín hiệu (động lượng suy, cấu trúc yếu)')
    }

    bars.push({
      time: dates[i],
      open: o[i],
      high: h[i],
      low: l[i],
      close: c[i],
      volume: v[i],
      ema20: ema20[i],
      ema50: ema50[i],
      rsi: rsi[i],
      buy: buyEvent[i],
      sell: sellEvent[i],
      trendOk: trendOk[i],
      reasons,
    })
  }

  const lastI = n - 1
  const intervalNorm =
    chartInterval === '1w' || chartInterval === 'w'
      ? '1w'
      : chartInterval === '1M' || chartInterval === 'm'
        ? '1M'
        : '1d'
  const intervalLabel =
    intervalNorm === '1w' ? 'tuần' : intervalNorm === '1M' ? 'tháng' : 'ngày'

  const buyForwardOutlook =
    intervalNorm === '1d'
      ? muaFollowThroughOutlook(sigArrays, muaForwardMinSamples)
      : null

  let baseNote =
    dataProvider === 'tcbs'
      ? 'Dữ liệu qua TCBS (fallback sau Yahoo và VNDirect). Minh họa, không phải tư vấn đầu tư.'
      : dataProvider === 'vndirect'
        ? 'Dữ liệu qua VNDirect finfo-api (Yahoo không đủ hoặc không có mã này). Minh họa, không phải tư vấn đầu tư.'
        : 'Dữ liệu Yahoo (chart API) — minh họa, không phải tư vấn đầu tư.'

  if (intervalNorm !== '1d') {
    baseNote += ` Biểu đồ đang gộp nến ${intervalLabel} từ chuỗi giá khớp theo ngày.`
  }

  const quoteSnap = buildQuoteSnapshot(raw, dataProvider, intervalNorm)

  const meta = {
    symbol: symDisplay,
    yahoo: symYahoo,
    dataProvider,
    chartInterval: intervalNorm,
    chartIntervalLabel: intervalLabel,
    signalMode: appliedSignalMode,
    strictFilter:
      appliedSignalMode === 'strict'
        ? {
            minBranches: appliedStrictBranches,
            minConfluenceBase: appliedStrictConfBase,
          }
        : null,
    lastDate: n ? dates[lastI] : null,
    lastClose: n ? c[lastI] : null,
    currentPrice: quoteSnap.currentPrice,
    previousReference: quoteSnap.previousReference,
    change: quoteSnap.change,
    changePercent: quoteSnap.changePercent,
    changeHint: quoteSnap.changeHint,
    trendOk: n ? trendOk[lastI] : false,
    rsi: n && rsi[lastI] != null ? rsi[lastI] : null,
    note: baseNote,
  }

  if (lastI >= 14 && atr[lastI] != null) {
    meta.confluenceBaseScore = confluenceScoreBaseAt(lastI, {
      c,
      l,
      ema20,
      ema50,
      rsi,
      v,
      vma20,
      atr,
      trendOk,
      buyRaw,
      macd,
      signal,
      hist,
      breakout,
    })
  }

  let advice = null
  if (lastI >= 14 && atr[lastI] != null) {
    advice = buildAdvice(lastI, {
      dates,
      c,
      l,
      ema20,
      ema50,
      rsi,
      atr,
      buyEvent,
      sellEvent,
      buyRaw,
      trendOk,
      hiRoll,
      v,
      vma20,
      macd,
      signal,
      hist,
      breakout,
    })
    if (advice && buyForwardOutlook) {
      advice = { ...advice, buyForwardOutlook }
    }
  }

  return { bars, meta, advice }
}

/**
 * @param {object} [warnOpts]
 * @param {number} [warnOpts.forwardWinWeakBelow] Ngưỡng cảnh báo khi tỷ lệ blend follow-through thấp (mặc định 45).
 */
export function buildWarnings(advice, meta, warnOpts = {}) {
  const forwardWeakBelow =
    typeof warnOpts.forwardWinWeakBelow === 'number' &&
    Number.isFinite(warnOpts.forwardWinWeakBelow)
      ? warnOpts.forwardWinWeakBelow
      : 45
  const w = []
  if (!advice) {
    if (meta?.lastClose == null)
      w.push('Chưa có khuyến nghị — cần thêm dữ liệu lịch sử.')
    return w
  }
  if (advice.action === 'BÁN') {
    w.push(
      'Tín hiệu BÁN minh họa (EMA20 / death cross / MACD suy yếu) — cân nhắc giảm vị thế.',
    )
  }
  if (advice.action === 'MUA' && meta && !meta.trendOk) {
    w.push(
      'Giá dưới EMA50 — xu hướng dài chưa rõ; chỉ nên MUA tỷ lệ nhỏ nếu bắt nhịp ngắn.',
    )
  }
  const blend = advice.buyForwardOutlook?.blend2_3Sessions
  if (
    advice.action === 'MUA' &&
    blend?.enough &&
    blend.winRatePercent != null &&
    blend.winRatePercent < forwardWeakBelow
  ) {
    w.push(
      `Thống kê lịch sử (cùng rule MUA): sau ~2–3 phiên trung bình chỉ ~${blend.winRatePercent}% lần đóng cửa cao hơn ngày tín hiệu — kỳ vọng lãi ngắn theo mẫu này đang yếu (so với ngưỡng ${forwardWeakBelow}%).`,
    )
  }
  const s = advice.confluence?.score
  if (s != null && s <= 40) {
    w.push(`Điểm hội tụ thấp (${s}/100) — bối cảnh kỹ thuật chưa thuận.`)
  }
  if (meta?.rsi != null && meta.rsi >= 70) {
    w.push(`RSI ${meta.rsi.toFixed(1)} — vùng quá mua, rủi ro chỉnh nhịp.`)
  }
  if (meta?.rsi != null && meta.rsi < 25) {
    w.push(
      `RSI ${meta.rsi.toFixed(1)} — bán mạnh; hồi kỹ thuật có thể false bounce.`,
    )
  }
  for (const f of advice.confluence?.factors ?? []) {
    if (f.tag === 'rsi' && f.text.includes('cao')) w.push(f.text)
    if (f.tag === 'bien_dong' && f.text.includes('lớn')) w.push(f.text)
  }
  return [...new Set(w)]
}
