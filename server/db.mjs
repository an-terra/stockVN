import pg from 'pg'

const { Pool } = pg

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
      ? { rejectUnauthorized: false }
      : undefined,
})

export async function query(text, params = []) {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL chua duoc cau hinh')
  }
  return pool.query(text, params)
}

export async function migrate() {
  await query('create extension if not exists pgcrypto')
  await query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      auth0_sub text unique not null,
      email text,
      name text,
      picture text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists watchlist_items (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      symbol text not null,
      source text,
      source_payload jsonb,
      created_at timestamptz not null default now(),
      unique(user_id, symbol)
    )
  `)
  await query(`
    create table if not exists signal_tracks (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      symbol text not null,
      action text not null,
      entry_date date not null,
      entry_price numeric not null,
      note text,
      eval_due_on date not null,
      signal_as_of text,
      source text,
      signal_summary text,
      signal_score numeric,
      signal_payload jsonb,
      created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists signal_track_snapshots (
      id uuid primary key default gen_random_uuid(),
      track_id uuid not null references signal_tracks(id) on delete cascade,
      snapshot_date date not null,
      mark_price numeric,
      mark_date text,
      mark_provider text,
      pnl_percent numeric,
      signal_correct boolean,
      created_at timestamptz not null default now(),
      unique(track_id, snapshot_date)
    )
  `)
  await query(`
    create index if not exists idx_watchlist_items_user_id
    on watchlist_items(user_id)
  `)
  await query(`
    create index if not exists idx_signal_tracks_user_id
    on signal_tracks(user_id)
  `)
  await query(`
    create index if not exists idx_signal_track_snapshots_track_id
    on signal_track_snapshots(track_id)
  `)
}

export async function migrateIfConfigured() {
  if (!hasDatabase()) {
    console.log('[db] DATABASE_URL chua cau hinh, bo qua migration')
    return
  }
  await migrate()
  console.log('[db] migration ok')
}
