import { query } from './db.mjs'
import { addTradingSessionsFromEntry } from './trackStore.mjs'

export function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase().replace(/\.VN$/i, '')
}

function toNumber(value) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeAction(action) {
  const raw = String(action ?? 'MUA').trim().toUpperCase()
  return raw === 'BÁN' ? 'BÁN' : raw === 'CHỜ' ? 'CHỜ' : 'MUA'
}

export async function upsertUser(auth) {
  const result = await query(
    `
      insert into users (auth0_sub, email, name, picture, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (auth0_sub) do update set
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture,
        updated_at = now()
      returning id, auth0_sub, email, name, picture, created_at, updated_at
    `,
    [auth.auth0Sub, auth.email, auth.name, auth.picture],
  )
  return result.rows[0]
}

export async function listWatchlist(userId) {
  const result = await query(
    `
      select id, symbol, source, source_payload, created_at
      from watchlist_items
      where user_id = $1
      order by created_at desc
    `,
    [userId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    source: row.source,
    sourcePayload: row.source_payload ?? null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  }))
}

export async function addWatchlistItem(userId, payload) {
  const symbol = normalizeSymbol(payload.symbol)
  if (symbol.length < 2 || symbol.length > 16) {
    const err = new Error('Ma khong hop le')
    err.statusCode = 400
    throw err
  }
  const result = await query(
    `
      insert into watchlist_items (user_id, symbol, source, source_payload)
      values ($1, $2, $3, $4)
      on conflict (user_id, symbol) do update set
        source = excluded.source,
        source_payload = excluded.source_payload
      returning id, symbol, source, source_payload, created_at
    `,
    [
      userId,
      symbol,
      payload.source ? String(payload.source).slice(0, 80) : null,
      payload.sourcePayload ? JSON.stringify(payload.sourcePayload) : null,
    ],
  )
  const row = result.rows[0]
  return {
    id: row.id,
    symbol: row.symbol,
    source: row.source,
    sourcePayload: row.source_payload ?? null,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  }
}

export async function deleteWatchlistItem(userId, symbol) {
  const result = await query(
    'delete from watchlist_items where user_id = $1 and symbol = $2',
    [userId, normalizeSymbol(symbol)],
  )
  return result.rowCount
}

export async function addUserTrack(userId, payload) {
  const symbol = normalizeSymbol(payload.symbol)
  if (symbol.length < 2 || symbol.length > 16) {
    const err = new Error('Ma khong hop le')
    err.statusCode = 400
    throw err
  }
  const action = normalizeAction(payload.action)
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.entryDate ?? ''))
    ? String(payload.entryDate)
    : null
  const entryPrice = Number(payload.entryPrice)
  if (!entryDate || !Number.isFinite(entryPrice)) {
    const err = new Error('Thieu ngay hoac gia vao')
    err.statusCode = 400
    throw err
  }
  const evalDueOn = addTradingSessionsFromEntry(entryDate, 5)
  const result = await query(
    `
      insert into signal_tracks (
        user_id, symbol, action, entry_date, entry_price, note, eval_due_on,
        signal_as_of, source, signal_summary, signal_score, signal_payload
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning *
    `,
    [
      userId,
      symbol,
      action,
      entryDate,
      entryPrice,
      payload.note ? String(payload.note).slice(0, 280) : null,
      evalDueOn,
      payload.signalAsOf ? String(payload.signalAsOf).slice(0, 40) : null,
      payload.source ? String(payload.source).slice(0, 80) : null,
      payload.signalSummary ? String(payload.signalSummary).slice(0, 500) : null,
      payload.signalScore != null ? Number(payload.signalScore) : null,
      payload.signalPayload ? JSON.stringify(payload.signalPayload) : null,
    ],
  )
  return mapTrackRow(result.rows[0])
}

export async function deleteUserTrack(userId, id) {
  const result = await query(
    'delete from signal_tracks where user_id = $1 and id = $2',
    [userId, id],
  )
  return result.rowCount
}

export async function listUserTracks(userId) {
  const result = await query(
    `
      select
        t.*,
        s.snapshot_date,
        s.mark_price,
        s.mark_date,
        s.mark_provider,
        s.pnl_percent,
        s.signal_correct
      from signal_tracks t
      left join lateral (
        select *
        from signal_track_snapshots s
        where s.track_id = t.id
        order by s.snapshot_date desc
        limit 1
      ) s on true
      where t.user_id = $1
      order by t.created_at desc
    `,
    [userId],
  )
  return result.rows.map(mapTrackRow)
}

export async function upsertTrackSnapshot(trackId, payload) {
  await query(
    `
      insert into signal_track_snapshots (
        track_id, snapshot_date, mark_price, mark_date, mark_provider,
        pnl_percent, signal_correct
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (track_id, snapshot_date) do update set
        mark_price = excluded.mark_price,
        mark_date = excluded.mark_date,
        mark_provider = excluded.mark_provider,
        pnl_percent = excluded.pnl_percent,
        signal_correct = excluded.signal_correct
    `,
    [
      trackId,
      payload.snapshotDate,
      payload.markPrice,
      payload.markDate,
      payload.markProvider,
      payload.pnlPercent,
      payload.signalCorrect,
    ],
  )
}

function mapTrackRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    symbol: row.symbol,
    action: row.action,
    entryDate: String(row.entry_date).slice(0, 10),
    entryPrice: toNumber(row.entry_price),
    note: row.note ?? undefined,
    evalDueOn: String(row.eval_due_on).slice(0, 10),
    signalAsOf: row.signal_as_of ?? null,
    source: row.source ?? null,
    signalSummary: row.signal_summary ?? null,
    signalScore: toNumber(row.signal_score),
    signalPayload: row.signal_payload ?? null,
    markPrice: toNumber(row.mark_price),
    markDate: row.mark_date ?? null,
    markProvider: row.mark_provider ?? null,
    pnlPercent: toNumber(row.pnl_percent),
    signalCorrect: row.signal_correct ?? null,
    snapshotDate: row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null,
  }
}
