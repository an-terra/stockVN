# Auth0 + Render PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm đăng nhập/đăng ký bằng Auth0 (Google/Gmail, LINE, Facebook), quyền admin qua `ADMIN_EMAILS`, lưu watchlist/tín hiệu theo từng user trong Render PostgreSQL, và refresh lãi/lỗ khi user mở thống kê.

**Architecture:** Frontend dùng Auth0 React SDK để lấy access token và gọi `/api/user/*`. Backend Express verify JWT Auth0 bằng JWKS, upsert user theo `auth0_sub`, tính role `admin` nếu email nằm trong `ADMIN_EMAILS`, thao tác PostgreSQL qua module repository nhỏ. API file-based `/api/track` hiện có được giữ cho demo/public, còn dữ liệu user thật đi qua `/api/user/*`.

**Tech Stack:** React 19, Vite, Auth0 React SDK, Express, `jose` JWT/JWKS, `pg` PostgreSQL, Node built-in test runner.

---

## File Structure

- Create `server/db.mjs`: pool PostgreSQL, migration runner idempotent, SQL helpers.
- Create `server/auth.mjs`: đọc config Auth0/admin, verify Bearer token, middleware `requireUser`.
- Create `server/userStore.mjs`: repository cho users, watchlist, signal tracks, snapshots.
- Modify `server/index.mjs`: mount auth middleware, user routes, reuse price fetch helpers.
- Modify `server/package.json`: dependencies `jose`, `pg`, scripts `test`, `db:migrate`.
- Create `server/tests/auth.test.mjs`: unit tests cho header parsing/config behavior.
- Create `server/tests/pnl.test.mjs`: unit tests cho P&L logic đang dùng lại.
- Create `frontend/src/authConfig.ts`: Auth0 env parsing và `isAuthConfigured`.
- Create `frontend/src/authClient.ts`: helper gọi API có token.
- Modify `frontend/src/main.tsx`: wrap `Auth0Provider` khi cấu hình đủ.
- Modify `frontend/src/App.tsx`: auth UI, user watchlist/track integration, refresh P&L.
- Modify `frontend/src/types.ts`: user/auth API response types.
- Modify `frontend/package.json`: dependency `@auth0/auth0-react`.
- Modify `Dockerfile`: truyền Auth0 build args cho Vite.
- Modify `render.yaml` and `docs/HUONG_DAN_RENDER.md`: env vars Auth0/Postgres/Deploy Hook.

Admin seed/account note:

- Tạo user `admin@an-terra.com` trực tiếp trong Auth0 Dashboard (`User Management` → `Users` → `Create User`).
- Không ghi mật khẩu vào code/docs/env.
- Render env: `ADMIN_EMAILS=admin@an-terra.com`.

---

## Task 1: Backend dependencies and database foundation

**Files:**
- Modify: `server/package.json`
- Create: `server/db.mjs`
- Test: `server/tests/pnl.test.mjs`

- [ ] **Step 1: Add dependencies and test script**

Run:

```bash
npm install --prefix server pg jose
```

Update `server/package.json` scripts:

```json
{
  "scripts": {
    "start": "node index.mjs",
    "report:week": "node cli/reportWeekMua.mjs",
    "db:migrate": "node -e \"import('./db.mjs').then((m)=>m.migrate())\"",
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [ ] **Step 2: Create `server/db.mjs`**

Implement:

```js
import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
      ? { rejectUnauthorized: false }
      : undefined,
})

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL)
}

export async function query(text, params = []) {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL chưa được cấu hình')
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
      created_at timestamptz not null default now(),
      unique (user_id, symbol)
    )
  `)
  await query(`
    create table if not exists signal_tracks (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      symbol text not null,
      action text not null check (action in ('MUA', 'BÁN', 'CHỜ')),
      entry_date date not null,
      entry_price numeric not null,
      note text,
      created_at timestamptz not null default now()
    )
  `)
  await query(`
    create table if not exists signal_track_snapshots (
      id uuid primary key default gen_random_uuid(),
      track_id uuid not null references signal_tracks(id) on delete cascade,
      snapshot_date date not null,
      mark_price numeric,
      mark_date date,
      pnl_percent numeric,
      signal_correct boolean,
      data_provider text,
      created_at timestamptz not null default now(),
      unique (track_id, snapshot_date)
    )
  `)
}
```

- [ ] **Step 3: Add P&L regression test**

Create `server/tests/pnl.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { pnlVsSignal } from '../trackStore.mjs'

test('MUA pnl is long return', () => {
  assert.deepEqual(pnlVsSignal('MUA', 100, 112), {
    pnlPercent: 12,
    signalCorrect: true,
  })
})

test('BAN pnl is inverse return', () => {
  assert.deepEqual(pnlVsSignal('BÁN', 100, 92), {
    pnlPercent: 8,
    signalCorrect: true,
  })
})

test('CHO keeps pnl but no correctness', () => {
  assert.deepEqual(pnlVsSignal('CHỜ', 100, 95), {
    pnlPercent: -5,
    signalCorrect: null,
  })
})
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test --prefix server
```

Expected: all P&L tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/db.mjs server/tests/pnl.test.mjs
git commit -m "feat(auth): add postgres foundation and pnl tests"
```

---

## Task 2: Auth0 backend verification

**Files:**
- Create: `server/auth.mjs`
- Create: `server/tests/auth.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write auth utility tests**

Create `server/tests/auth.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractBearerToken, authConfigStatus, roleForEmail } from '../auth.mjs'

test('extractBearerToken reads valid bearer header', () => {
  assert.equal(extractBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi')
})

test('extractBearerToken rejects missing bearer prefix', () => {
  assert.equal(extractBearerToken('Basic abc'), null)
  assert.equal(extractBearerToken(''), null)
})

test('authConfigStatus reports missing env names', () => {
  const status = authConfigStatus({})
  assert.equal(status.configured, false)
  assert.deepEqual(status.missing.sort(), ['AUTH0_AUDIENCE', 'AUTH0_DOMAIN'])
})

test('roleForEmail marks configured admin emails', () => {
  assert.equal(roleForEmail('admin@an-terra.com', 'admin@an-terra.com'), 'admin')
  assert.equal(roleForEmail('user@example.com', 'admin@an-terra.com'), 'user')
  assert.equal(roleForEmail(' ADMIN@AN-TERRA.COM ', 'admin@an-terra.com'), 'admin')
})
```

- [ ] **Step 2: Implement `server/auth.mjs`**

```js
import { createRemoteJWKSet, jwtVerify } from 'jose'

export function extractBearerToken(header) {
  const raw = String(header ?? '').trim()
  const m = raw.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

export function authConfigStatus(env = process.env) {
  const missing = []
  if (!env.AUTH0_DOMAIN) missing.push('AUTH0_DOMAIN')
  if (!env.AUTH0_AUDIENCE) missing.push('AUTH0_AUDIENCE')
  return { configured: missing.length === 0, missing }
}

export function roleForEmail(email, adminEmails = process.env.ADMIN_EMAILS ?? '') {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) return 'user'
  const admins = String(adminEmails)
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(normalized) ? 'admin' : 'user'
}

let jwks = null

function getJwks(domain) {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://${domain.replace(/^https?:\/\//, '')}/.well-known/jwks.json`),
    )
  }
  return jwks
}

export async function verifyAuth0Token(token) {
  const status = authConfigStatus()
  if (!status.configured) {
    const err = new Error(`Auth0 chưa cấu hình: ${status.missing.join(', ')}`)
    err.status = 503
    throw err
  }
  const domain = process.env.AUTH0_DOMAIN.replace(/^https?:\/\//, '')
  const { payload } = await jwtVerify(token, getJwks(domain), {
    issuer: `https://${domain}/`,
    audience: process.env.AUTH0_AUDIENCE,
  })
  return payload
}

export function requireUser(upsertUser) {
  return async (req, res, next) => {
    try {
      const token = extractBearerToken(req.headers.authorization)
      if (!token) return res.status(401).json({ detail: 'Thiếu Bearer token' })
      const payload = await verifyAuth0Token(token)
      const user = await upsertUser({
        auth0Sub: payload.sub,
        email: payload.email ?? null,
        name: payload.name ?? payload.nickname ?? null,
        picture: payload.picture ?? null,
      })
      req.auth = {
        payload,
        user: {
          ...user,
          role: roleForEmail(payload.email),
        },
      }
      next()
    } catch (e) {
      res.status(e.status ?? 401).json({
        detail: e instanceof Error ? e.message : 'Không xác thực được',
      })
    }
  }
}
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test --prefix server
```

Expected: auth tests and P&L tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/auth.mjs server/tests/auth.test.mjs
git commit -m "feat(auth): verify Auth0 JWT on backend"
```

---

## Task 3: User repository and protected routes

**Files:**
- Create: `server/userStore.mjs`
- Modify: `server/index.mjs`
- Modify: `server/tests/*.test.mjs` if exports need adjustment

- [ ] **Step 1: Implement `server/userStore.mjs`**

```js
import { query } from './db.mjs'
import {
  addTradingSessionsFromEntry,
  pnlVsSignal,
  todayVN,
} from './trackStore.mjs'

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase().replace(/\.VN$/i, '')
}

export async function upsertUser(profile) {
  const r = await query(
    `
    insert into users (auth0_sub, email, name, picture, updated_at)
    values ($1, $2, $3, $4, now())
    on conflict (auth0_sub)
    do update set email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = now()
    returning id, auth0_sub as "auth0Sub", email, name, picture, created_at as "createdAt", updated_at as "updatedAt"
    `,
    [profile.auth0Sub, profile.email, profile.name, profile.picture],
  )
  return r.rows[0]
}

export async function listWatchlist(userId) {
  const r = await query(
    'select symbol, created_at as "createdAt" from watchlist_items where user_id = $1 order by symbol',
    [userId],
  )
  return r.rows
}

export async function addWatchlistItem(userId, symbol) {
  const sym = normalizeSymbol(symbol)
  if (sym.length < 2 || sym.length > 16) throw new Error('symbol không hợp lệ')
  const r = await query(
    `
    insert into watchlist_items (user_id, symbol)
    values ($1, $2)
    on conflict (user_id, symbol) do nothing
    returning symbol, created_at as "createdAt"
    `,
    [userId, sym],
  )
  return r.rows[0] ?? { symbol: sym }
}

export async function deleteWatchlistItem(userId, symbol) {
  const sym = normalizeSymbol(symbol)
  const r = await query(
    'delete from watchlist_items where user_id = $1 and symbol = $2',
    [userId, sym],
  )
  return r.rowCount
}

export async function addUserTrack(userId, row) {
  const sym = normalizeSymbol(row.symbol)
  const entryDate = row.entryDate || todayVN()
  const entryPrice = Number(row.entryPrice)
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('entryPrice không hợp lệ')
  const action = row.action === 'BÁN' ? 'BÁN' : row.action === 'CHỜ' ? 'CHỜ' : 'MUA'
  const r = await query(
    `
    insert into signal_tracks (user_id, symbol, action, entry_date, entry_price, note)
    values ($1, $2, $3, $4, $5, $6)
    returning id, symbol, action, entry_date as "entryDate", entry_price as "entryPrice", note, created_at as "createdAt"
    `,
    [userId, sym, action, entryDate, entryPrice, row.note ? String(row.note).slice(0, 280) : null],
  )
  return { ...r.rows[0], evalDueOn: addTradingSessionsFromEntry(entryDate, 5) }
}

export async function deleteUserTrack(userId, id) {
  const r = await query('delete from signal_tracks where user_id = $1 and id = $2', [userId, id])
  return r.rowCount
}

export async function listUserTracks(userId) {
  const r = await query(
    `
    select
      t.id, t.symbol, t.action, t.entry_date as "entryDate", t.entry_price as "entryPrice",
      t.note, t.created_at as "createdAt",
      s.snapshot_date as "snapshotDate", s.mark_price as "markPrice", s.mark_date as "markDate",
      s.pnl_percent as "pnlPercent", s.signal_correct as "signalCorrect", s.data_provider as "dataProvider"
    from signal_tracks t
    left join lateral (
      select * from signal_track_snapshots s
      where s.track_id = t.id
      order by s.snapshot_date desc
      limit 1
    ) s on true
    where t.user_id = $1
    order by t.created_at desc
    `,
    [userId],
  )
  return r.rows.map((row) => ({
    ...row,
    evalDueOn: addTradingSessionsFromEntry(row.entryDate, 5),
  }))
}

export async function upsertTrackSnapshot(trackId, mark) {
  const today = todayVN()
  const { pnlPercent, signalCorrect } = pnlVsSignal(mark.action, Number(mark.entryPrice), mark.markPrice)
  const r = await query(
    `
    insert into signal_track_snapshots
      (track_id, snapshot_date, mark_price, mark_date, pnl_percent, signal_correct, data_provider)
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (track_id, snapshot_date)
    do update set mark_price = excluded.mark_price, mark_date = excluded.mark_date,
      pnl_percent = excluded.pnl_percent, signal_correct = excluded.signal_correct,
      data_provider = excluded.data_provider, created_at = now()
    returning *
    `,
    [trackId, today, mark.markPrice, mark.markDate, pnlPercent, signalCorrect, mark.dataProvider],
  )
  return r.rows[0]
}
```

- [ ] **Step 2: Mount protected routes in `server/index.mjs`**

Import:

```js
import { requireUser } from './auth.mjs'
import {
  addUserTrack,
  addWatchlistItem,
  deleteUserTrack,
  deleteWatchlistItem,
  listUserTracks,
  listWatchlist,
  upsertTrackSnapshot,
  upsertUser,
} from './userStore.mjs'
```

Add routes after `app.use(express.json())`:

```js
const userOnly = requireUser(upsertUser)

app.get('/api/me', userOnly, (req, res) => {
  res.json({ user: req.auth.user })
})

app.get('/api/user/watchlist', userOnly, async (req, res) => {
  res.json({ items: await listWatchlist(req.auth.user.id) })
})

app.post('/api/user/watchlist', userOnly, async (req, res) => {
  const item = await addWatchlistItem(req.auth.user.id, req.body?.symbol)
  res.json({ ok: true, item })
})

app.delete('/api/user/watchlist/:symbol', userOnly, async (req, res) => {
  const removed = await deleteWatchlistItem(req.auth.user.id, req.params.symbol)
  res.json({ ok: true, removed })
})

app.get('/api/user/track', userOnly, async (req, res) => {
  await refreshUserTrackMarks(req.auth.user.id)
  res.json({ generatedAt: new Date().toISOString(), items: await listUserTracks(req.auth.user.id) })
})

app.post('/api/user/track', userOnly, async (req, res) => {
  const item = await addUserTrack(req.auth.user.id, req.body ?? {})
  res.json({ ok: true, item })
})

app.delete('/api/user/track/:id', userOnly, async (req, res) => {
  const removed = await deleteUserTrack(req.auth.user.id, req.params.id)
  res.json({ ok: true, removed })
})

app.post('/api/user/track/refresh', userOnly, async (req, res) => {
  await refreshUserTrackMarks(req.auth.user.id, true)
  res.json({ ok: true, items: await listUserTracks(req.auth.user.id) })
})
```

- [ ] **Step 3: Add refresh helper near `fetchMarkForTrack`**

Use existing `fetchMarkForTrack` and `listUserTracks`:

```js
async function refreshUserTrackMarks(userId) {
  const tracks = await listUserTracks(userId)
  for (const row of tracks) {
    try {
      const mark = await fetchMarkForTrack(row.symbol)
      await upsertTrackSnapshot(row.id, {
        action: row.action,
        entryPrice: row.entryPrice,
        markPrice: mark?.markPrice ?? null,
        markDate: mark?.markDate ?? null,
        dataProvider: mark?.dataProvider ?? null,
      })
    } catch {
      await upsertTrackSnapshot(row.id, {
        action: row.action,
        entryPrice: row.entryPrice,
        markPrice: null,
        markDate: null,
        dataProvider: null,
      })
    }
  }
}
```

- [ ] **Step 4: Verify syntax and tests**

Run:

```bash
npm test --prefix server
node --check server/index.mjs
```

Expected: tests pass and syntax check exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/userStore.mjs
git commit -m "feat(auth): add protected user watchlist and track APIs"
```

---

## Task 4: Frontend Auth0 integration and authenticated API helper

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/authConfig.ts`
- Create: `frontend/src/authClient.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add Auth0 dependency**

Run:

```bash
npm install --prefix frontend @auth0/auth0-react
```

- [ ] **Step 2: Create `frontend/src/authConfig.ts`**

```ts
export const auth0Config = {
  domain: (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined)?.trim() ?? '',
  clientId:
    (import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined)?.trim() ?? '',
  audience:
    (import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined)?.trim() ?? '',
}

export const isAuthConfigured = Boolean(
  auth0Config.domain && auth0Config.clientId && auth0Config.audience,
)
```

- [ ] **Step 3: Create `frontend/src/authClient.ts`**

```ts
import { apiUrl } from './apiClient'

export async function fetchAuthJson<T>(
  getToken: () => Promise<string>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getToken()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(apiUrl(path), { ...init, headers })
  const data = (await response.json()) as T & { detail?: string }
  if (!response.ok) throw new Error(data.detail ?? `Lỗi ${response.status}`)
  return data as T
}
```

- [ ] **Step 4: Wrap app in `Auth0Provider`**

Modify `frontend/src/main.tsx`:

```tsx
import { Auth0Provider } from '@auth0/auth0-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { auth0Config, isAuthConfigured } from './authConfig'

const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

createRoot(document.getElementById('root')!).render(
  isAuthConfigured ? (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        audience: auth0Config.audience,
        redirect_uri: window.location.origin,
      }}
      cacheLocation="localstorage"
    >
      {app}
    </Auth0Provider>
  ) : (
    app
  ),
)
```

- [ ] **Step 5: Add types**

In `frontend/src/types.ts`, add:

```ts
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
  items: Array<{ symbol: string; createdAt?: string }>
}
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run build --prefix frontend
```

Expected: TypeScript succeeds when Auth0 env vars are absent.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/authConfig.ts frontend/src/authClient.ts frontend/src/main.tsx frontend/src/types.ts
git commit -m "feat(auth): add Auth0 frontend provider and API helper"
```

---

## Task 5: Frontend user UI, watchlist sync, and user track API

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/app.css`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Import Auth0 and helpers**

In `App.tsx`, add:

```ts
import { useAuth0 } from '@auth0/auth0-react'
import { fetchAuthJson } from './authClient'
import { isAuthConfigured } from './authConfig'
```

Add inside `App()`:

```ts
const {
  isAuthenticated,
  isLoading: authLoading,
  user,
  loginWithRedirect,
  logout,
  getAccessTokenSilently,
} = useAuth0()
const [currentUser, setCurrentUser] = useState<CurrentUserResponse | null>(null)
```

- [ ] **Step 2: Add auth header UI**

Add near the top of the rendered app:

```tsx
<div className="auth-bar">
  {!isAuthConfigured ? (
    <span className="auth-muted">Auth0 chưa cấu hình</span>
  ) : authLoading ? (
    <span className="auth-muted">Đang kiểm tra đăng nhập…</span>
  ) : isAuthenticated ? (
    <>
      {user?.picture && <img className="auth-avatar" src={user.picture} alt="" />}
      <span className="auth-user">{user?.name ?? user?.email ?? 'Tài khoản'}</span>
      {currentUser?.user.role === 'admin' && <span className="auth-role">Admin</span>}
      <button type="button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
        Đăng xuất
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={() => loginWithRedirect()}>Đăng nhập</button>
      <button type="button" onClick={() => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}>
        Đăng ký
      </button>
    </>
  )}
</div>
```

- [ ] **Step 3: Load current user and sync watchlist after login**

Add effect:

```ts
useEffect(() => {
  let cancelled = false
  if (!isAuthenticated) {
    setCurrentUser(null)
    return
  }
  ;(async () => {
    try {
      const me = await fetchAuthJson<CurrentUserResponse>(
        getAccessTokenSilently,
        '/api/me',
      )
      if (!cancelled) setCurrentUser(me)
      const data = await fetchAuthJson<UserWatchlistResponse>(
        getAccessTokenSilently,
        '/api/user/watchlist',
      )
      const symbols = data.items.map((x) => x.symbol)
      if (!cancelled && symbols.length) setUserWatchlist(symbols)
    } catch (e) {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được watchlist tài khoản')
    }
  })()
  return () => {
    cancelled = true
  }
}, [isAuthenticated, getAccessTokenSilently])
```

- [ ] **Step 4: Persist add/remove watchlist to API when logged in**

Where current code adds/removes `userWatchlist`, call:

```ts
if (isAuthenticated) {
  await fetchAuthJson(getAccessTokenSilently, '/api/user/watchlist', {
    method: 'POST',
    body: JSON.stringify({ symbol: nextSymbol }),
  })
}
```

For delete:

```ts
if (isAuthenticated) {
  await fetchAuthJson(
    getAccessTokenSilently,
    `/api/user/watchlist/${encodeURIComponent(symbolToRemove)}`,
    { method: 'DELETE' },
  )
}
```

- [ ] **Step 5: Switch track calls to user API when logged in**

Update `loadTrack`:

```ts
if (isAuthenticated) {
  const data = await fetchAuthJson<TrackListResponse>(
    getAccessTokenSilently,
    '/api/user/track',
  )
  setTrackPayload(data)
  return
}
```

Keep existing `/api/track` fallback when not logged in.

Update add/delete similarly:

```ts
const trackPath = isAuthenticated ? '/api/user/track' : '/api/track'
```

and delete:

```ts
const path = isAuthenticated
  ? `/api/user/track/${encodeURIComponent(id)}`
  : `/api/track/${encodeURIComponent(id)}`
```

- [ ] **Step 6: Add manual refresh button for logged-in user**

Near signal statistics UI:

```tsx
{isAuthenticated && (
  <button
    type="button"
    className="scan-btn secondary tight"
    onClick={async () => {
      setTrackLoading(true)
      try {
        const data = await fetchAuthJson<TrackListResponse>(
          getAccessTokenSilently,
          '/api/user/track/refresh',
          { method: 'POST' },
        )
        setTrackPayload(data)
      } catch (e) {
        setTrackErr(e instanceof Error ? e.message : 'Không cập nhật được lãi/lỗ')
      } finally {
        setTrackLoading(false)
      }
    }}
  >
    Cập nhật lãi/lỗ hôm nay
  </button>
)}
```

- [ ] **Step 7: Add CSS**

Append to `frontend/src/app.css`:

```css
.auth-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.auth-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
}

.auth-user {
  font-weight: 700;
}

.auth-muted {
  color: #64748b;
  font-size: 0.9rem;
}

.auth-role {
  border-radius: 999px;
  background: #fee2e2;
  color: #991b1b;
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.15rem 0.45rem;
  text-transform: uppercase;
}
```

- [ ] **Step 8: Verify**

Run:

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.tsx frontend/src/app.css frontend/src/types.ts
git commit -m "feat(auth): add login UI and user watchlist tracking"
```

---

## Task 6: Render config, Docker build args, and docs

**Files:**
- Modify: `Dockerfile`
- Modify: `render.yaml`
- Modify: `docs/HUONG_DAN_RENDER.md`
- Modify: `README.md`

- [ ] **Step 1: Update Dockerfile build args**

In web build stage:

```dockerfile
ARG VITE_AUTH0_DOMAIN=
ARG VITE_AUTH0_CLIENT_ID=
ARG VITE_AUTH0_AUDIENCE=
ENV VITE_API_BASE=
ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN
ENV VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID
ENV VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE
RUN npm run build --prefix frontend
```

- [ ] **Step 2: Update `render.yaml` env hints**

Add comments under service:

```yaml
    envVars:
      - key: NODE_ENV
        value: production
      # Add these in Render Dashboard as secrets/env:
      # AUTH0_DOMAIN, AUTH0_AUDIENCE, DATABASE_URL
      # Build args for Vite Auth0 values must be configured in Render Docker build settings if not using blueprint support.
```

- [ ] **Step 3: Update Render docs**

Add exact env list:

```md
Auth0 runtime env:
- AUTH0_DOMAIN
- AUTH0_AUDIENCE
- DATABASE_URL
- ADMIN_EMAILS (ví dụ admin@an-terra.com)

Auth0 frontend build env:
- VITE_AUTH0_DOMAIN
- VITE_AUTH0_CLIENT_ID
- VITE_AUTH0_AUDIENCE
```

Add Render PostgreSQL setup:

```md
Render Dashboard → New → PostgreSQL → copy Internal Database URL → set DATABASE_URL on Web Service.
```

- [ ] **Step 4: Verify**

Run:

```bash
git diff -- Dockerfile render.yaml docs/HUONG_DAN_RENDER.md README.md
```

Expected: docs and config mention Auth0 + Render PostgreSQL consistently.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile render.yaml docs/HUONG_DAN_RENDER.md README.md
git commit -m "docs(auth): document Render Auth0 and Postgres configuration"
```

---

## Task 7: End-to-end verification and deployment

**Files:**
- No source changes expected unless verification reveals a bug.

- [ ] **Step 1: Install all dependencies cleanly**

Run:

```bash
npm install
npm install --prefix server
npm install --prefix frontend
```

Expected: package locks updated and no install errors.

- [ ] **Step 2: Run backend tests**

Run:

```bash
npm test --prefix server
```

Expected: PASS.

- [ ] **Step 3: Run frontend lint/build**

Run:

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
```

Expected: PASS.

- [ ] **Step 4: Build Docker image**

Run:

```bash
docker build -t stockvn-auth:local .
```

Expected: Docker build completes. If Docker is not installed locally, rely on GitHub Actions CI and Render build logs.

- [ ] **Step 5: Push and verify Render**

Run:

```bash
git push origin main
```

Then on Render:

- Set `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`.
- Set frontend Auth0 build env/args according to Render service support.
- Redeploy service.
- Open the app, login via Auth0, add a watchlist symbol, add a signal track, refresh lãi/lỗ.

- [ ] **Step 6: Final commit if verification fixes were needed**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix(auth): resolve verification issues"
git push origin main
```

---

## Self-Review

- Spec coverage: Auth0, Render PostgreSQL, per-user watchlist, per-user signal tracking, refresh-on-open P&L, Render docs, and testing are covered by Tasks 1-7.
- Placeholder scan: no open-ended “fill later” implementation steps remain; each task has exact files, snippets, and commands.
- Type consistency: backend uses `auth0Sub`, `user_id`, `TrackListResponse`; frontend helpers consistently use `fetchAuthJson` and `/api/user/*`.

