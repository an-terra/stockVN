function trimEnv(value: string | undefined): string | undefined {
  const s = value?.trim()
  return s || undefined
}

export const authConfig = {
  domain: trimEnv(import.meta.env.VITE_AUTH0_DOMAIN as string | undefined),
  clientId: trimEnv(import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined),
  audience: trimEnv(import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined),
}

export const isAuthConfigured = Boolean(
  authConfig.domain && authConfig.clientId && authConfig.audience,
)
