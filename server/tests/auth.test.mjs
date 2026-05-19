import assert from 'node:assert/strict'
import test from 'node:test'

import { authConfigStatus, extractBearerToken, roleForEmail } from '../auth.mjs'

test('extractBearerToken reads bearer authorization header', () => {
  assert.equal(extractBearerToken('Bearer abc.def'), 'abc.def')
  assert.equal(extractBearerToken('bearer token-123'), 'token-123')
  assert.equal(extractBearerToken('Basic token-123'), null)
  assert.equal(extractBearerToken(undefined), null)
})

test('authConfigStatus requires domain and audience', () => {
  assert.deepEqual(authConfigStatus({}), {
    configured: false,
    domain: '',
    audience: '',
  })
  assert.equal(
    authConfigStatus({ AUTH0_DOMAIN: 'x.auth0.com', AUTH0_AUDIENCE: 'api' })
      .configured,
    true,
  )
})

test('roleForEmail uses ADMIN_EMAILS case-insensitively', () => {
  assert.equal(
    roleForEmail('Admin@An-Terra.com', {
      ADMIN_EMAILS: 'admin@an-terra.com,other@example.com',
    }),
    'admin',
  )
  assert.equal(
    roleForEmail('user@example.com', {
      ADMIN_EMAILS: 'admin@an-terra.com',
    }),
    'user',
  )
})
