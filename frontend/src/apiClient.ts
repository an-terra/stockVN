/**
 * Khi dev: để trống — Vite proxy /api → 8000.
 * Khi preview/host tĩnh: tạo .env với VITE_API_BASE=http://127.0.0.1:8000 rồi build lại.
 */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE as string | undefined
  const base = (raw ?? '').trim().replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

export type FetchApiJsonResult<T> = { response: Response; data: T }

/**
 * Đọc JSON an toàn — nếu máy chủ trả HTML (SPA / 404) thì báo lỗi rõ tiếng Việt.
 */
export async function fetchApiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<FetchApiJsonResult<T>> {
  const response = await fetch(apiUrl(path), init)
  const text = await response.text()
  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    const head = text.trimStart().slice(0, 60).replace(/\s+/g, ' ')
    if (
      text.trimStart().startsWith('<') ||
      text.trimStart().toLowerCase().startsWith('<!doctype')
    ) {
      throw new Error(
        [
          'API trả về HTML thay vì JSON.',
          'Chạy backend: mở thư mục server → npm start (cổng 8000).',
          'Frontend chỉ dùng npm run dev từ thư mục frontend (có proxy), hoặc npm run preview sau khi cấu hình proxy;',
          'Hoặc cổng 8000 đang bị chiếm bởi chương trình khác (API cũ không có /api/track) — hãy tắt process đó rồi chạy lại npm start trong thư mục server của repo này.',
          'Nếu API chạy cổng khác: đặt frontend/.env VITE_API_BASE=http://127.0.0.1:PORT rồi chạy lại dev.',
        ].join(' '),
      )
    }
    throw new Error(`Phản hồi không phải JSON (${response.status}): ${head}`)
  }
  return { response, data }
}
