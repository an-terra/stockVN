import { createRemoteJWKSet, jwtVerify } from 'jose'

let jwks = null

export function extractBearerToken(headerValue) {
  const value = String(headerValue ?? '').trim()
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function authConfigStatus(env = process.env) {
  const domain = String(env.AUTH0_DOMAIN ?? '').trim()
  const audience = String(env.AUTH0_AUDIENCE ?? '').trim()
  return {
    configured: Boolean(domain && audience),
    domain,
    audience,
  }
}

export function roleForEmail(email, env = process.env) {
  const normalized = String(email ?? '').trim().toLowerCase()
  const admins = String(env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  return normalized && admins.includes(normalized) ? 'admin' : 'user'
}

function issuerForDomain(domain) {
  const clean = domain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '')
  return `https://${clean}/`
}

async function verifyAuth0Token(token) {
  const status = authConfigStatus()
  if (!status.configured) {
    const err = new Error('Auth0 chua duoc cau hinh tren server')
    err.statusCode = 503
    throw err
  }
  const issuer = issuerForDomain(status.domain)
  jwks ??= createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`))
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: status.audience,
  })
  return payload
}

export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export async function requireUser(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization)
    if (!token) {
      return res.status(401).json({ detail: 'Can dang nhap' })
    }
    const payload = await verifyAuth0Token(token)
    const auth0Sub = String(payload.sub ?? '')
    if (!auth0Sub) {
      return res.status(401).json({ detail: 'Token khong hop le' })
    }
    const email = String(payload.email ?? '').trim() || null
    req.auth = {
      auth0Sub,
      email,
      name: String(payload.name ?? payload.nickname ?? '').trim() || null,
      picture: String(payload.picture ?? '').trim() || null,
      role: roleForEmail(email),
    }
    next()
  } catch (e) {
    const statusCode = e?.statusCode || 401
    res.status(statusCode).json({
      detail: e instanceof Error ? e.message : 'Khong xac thuc duoc token',
    })
  }
}
