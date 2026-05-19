import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import App from './App'
import { authConfig, isAuthConfigured } from './authConfig'
import type { AuthAppProps } from './types'

function AuthenticatedApp() {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  } = useAuth0()

  const props: AuthAppProps = {
    isAuthConfigured,
    isAuthenticated,
    isAuthLoading: isLoading,
    authUser: user,
    login: () => void loginWithRedirect(),
    logout: () => void logout({ logoutParams: { returnTo: window.location.origin } }),
    getAccessToken: getAccessTokenSilently,
  }

  return <App {...props} />
}

export default function AuthRoot() {
  if (!isAuthConfigured) {
    return <App isAuthConfigured={false} />
  }

  return (
    <Auth0Provider
      domain={authConfig.domain!}
      clientId={authConfig.clientId!}
      authorizationParams={{
        audience: authConfig.audience,
        redirect_uri: window.location.origin,
      }}
    >
      <AuthenticatedApp />
    </Auth0Provider>
  )
}
