import { apiUrl } from './apiClient'

export async function fetchAuthJson<T>(
  getAccessToken: () => Promise<string>,
  path: string,
  init: RequestInit = {},
) {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
  })
  const data = (await response.json()) as T
  return { response, data }
}
