export const authConfig = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN as string | undefined,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined,
  audience: import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined,
}

export const isAuthConfigured = Boolean(
  authConfig.domain && authConfig.clientId && authConfig.audience,
)
