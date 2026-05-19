import type { AppData } from './types'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Unable to load ${path}`)
  }
  return response.json() as Promise<T>
}

export async function loadAppData(): Promise<AppData> {
  const [manifest, forecasts, rules, warnings, pfma, albacore, bluewater] =
    await Promise.all([
      fetchJson<AppData['manifest']>('data/manifest.json'),
      fetchJson<AppData['forecasts']>('data/forecasts.json'),
      fetchJson<AppData['rules']>('data/rules.json'),
      fetchJson<AppData['warnings']>('data/warnings.geojson'),
      fetchJson<AppData['pfma']>('data/pfma.geojson'),
      fetchJson<AppData['albacore']>('data/albacore.geojson'),
      fetchJson<AppData['bluewater']>('data/bluewater.json'),
    ])

  return { manifest, forecasts, rules, warnings, pfma, albacore, bluewater }
}
