import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts'
import type { SeriesMarker } from 'lightweight-charts'
import { useLayoutEffect, useRef } from 'react'
import type { ChartBar } from './types'

const BG = '#16171d'
const GRID = '#2e303a'
const TEXT = '#9ca3af'

export type LiveChartSignal = {
  action: 'MUA' | 'BÁN' | 'CHỜ'
  asOf?: string | null
  /** Giá dưới EMA20 và dưới EMA50 — gợi ý theo dõi thoát (chỉ UI, khi action CHỜ) */
  softBear?: boolean
}

type Props = { bars: ChartBar[]; liveSignal?: LiveChartSignal | null }

export function StockChart({ bars, liveSignal }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || bars.length === 0) return

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: TEXT,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    const ema20 = chart.addSeries(LineSeries, {
      color: '#c084fc',
      lineWidth: 2,
      title: 'EMA20',
    })

    const ema50 = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      title: 'EMA50',
    })

    const volume = chart.addSeries(HistogramSeries, {
      color: 'rgba(148, 163, 184, 0.25)',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })

    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.15 },
    })

    chart.priceScale('').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chart.addPane()
    const rsiLine = chart.addSeries(
      LineSeries,
      {
        color: '#fbbf24',
        lineWidth: 2,
        title: 'RSI',
      },
      1,
    )

    chart.panes()[1]?.setStretchFactor(0.32)

    rsiLine.createPriceLine({
      price: 30,
      color: 'rgba(148, 163, 184, 0.35)',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '30',
    })
    rsiLine.createPriceLine({
      price: 70,
      color: 'rgba(148, 163, 184, 0.35)',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '70',
    })

    candle.setData(
      bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )

    ema20.setData(bars.map((b) => ({ time: b.time, value: b.ema20 })))
    ema50.setData(bars.map((b) => ({ time: b.time, value: b.ema50 })))

    volume.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color:
          b.close >= b.open
            ? 'rgba(34, 197, 94, 0.35)'
            : 'rgba(239, 68, 68, 0.35)',
      })),
    )

    rsiLine.setData(
      bars.flatMap((b) =>
        b.rsi != null ? [{ time: b.time, value: b.rsi }] : [],
      ),
    )

    const markerData: SeriesMarker<string>[] = []
    for (const b of bars) {
      if (b.buy) {
        markerData.push({
          time: b.time,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: 'MUA',
        })
      }
      if (b.sell) {
        markerData.push({
          time: b.time,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: 'BÁN',
        })
      }
    }

    /* Trạng thái “hiện tại” trên nến cuối (khớp khuyến nghị MUA/BÁN/CHỜ) —
     * vì sự kiện edge có thể đã xảy ra vài phiên trước. */
    if (liveSignal && bars.length > 0) {
      const last = bars[bars.length - 1]
      let tMark: string = last.time
      if (liveSignal.asOf && bars.some((b) => b.time === liveSignal.asOf)) {
        tMark = liveSignal.asOf as string
      }
      const atMark = markerData.filter((m) => m.time === tMark)
      const hasMua = atMark.some((m) => m.text === 'MUA')
      const hasBan = atMark.some((m) => m.text === 'BÁN')

      if (liveSignal.action === 'MUA' && !hasMua) {
        markerData.push({
          time: tMark,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: 'MUA',
        })
      } else if (liveSignal.action === 'BÁN' && !hasBan) {
        markerData.push({
          time: tMark,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: 'BÁN',
        })
      } else if (
        liveSignal.action === 'CHỜ' &&
        liveSignal.softBear &&
        !hasBan &&
        !hasMua
      ) {
        markerData.push({
          time: tMark,
          position: 'aboveBar',
          color: '#fb923c',
          shape: 'arrowDown',
          text: 'YẾU',
        })
      } else if (liveSignal.action === 'CHỜ' && !hasMua && !hasBan) {
        markerData.push({
          time: tMark,
          position: 'belowBar',
          color: '#94a3b8',
          shape: 'circle',
          text: 'CHỜ',
        })
      }
    }

    markerData.sort(
      (a, b) => String(a.time).localeCompare(String(b.time)),
    )

    const markers = createSeriesMarkers(candle, markerData)
    chart.timeScale().fitContent()

    return () => {
      markers.detach()
      chart.remove()
    }
  }, [bars, liveSignal])

  return <div ref={ref} className="stock-chart-wrap" />
}
