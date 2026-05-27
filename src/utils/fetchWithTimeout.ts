export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}
