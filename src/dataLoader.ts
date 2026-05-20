import type { AppData } from './types'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Unable to load ${path}`)
  }
  return response.json() as Promise<T>
}

export async function loadAppData(): Promise<AppData> {
  const [manifest, forecasts, forecastGrid, rules, warnings, pfma, rca, albacore, bluewater, depthGrid, tasks] =
    await Promise.all([
      fetchJson<AppData['manifest']>('data/manifest.json'),
      fetchJson<AppData['forecasts']>('data/forecasts.json'),
      fetchJson<AppData['forecastGrid']>('data/forecast-grid.json'),
      fetchJson<AppData['rules']>('data/rules.json'),
      fetchJson<AppData['warnings']>('data/warnings.geojson'),
      fetchJson<AppData['pfma']>('data/pfma.geojson'),
      fetchJson<AppData['rca']>('data/rockfish-conservation-areas.geojson'),
      fetchJson<AppData['albacore']>('data/albacore.geojson'),
      fetchJson<AppData['bluewater']>('data/bluewater.json'),
      fetchJson<AppData['depthGrid']>('data/depth-grid.json'),
      fetchJson<AppData['tasks']>('data/task-status.json'),
    ])

  return { manifest, forecasts, forecastGrid, rules, warnings, pfma, rca, albacore, bluewater, depthGrid, tasks }
}
