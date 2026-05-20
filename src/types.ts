export type PageId =
  | 'map'
  | 'rules'
  | 'warnings'
  | 'bluewater'
  | 'albacore'
  | 'spots'
  | 'route'
  | 'trip'
  | 'settings'
  | 'data-status'

export type DataManifest = {
  generatedAt: string
  build: string
  coverage: string
  sources: Array<{
    name: string
    owner: string
    freshness: string
    status: 'ok' | 'stale' | 'demo'
  }>
}

export type MarinePointForecast = {
  id: string
  name: string
  lat: number
  lng: number
  area: string
  updatedAt: string
  score: number
  weather: {
    condition: string
    airTempC: number
    windKts: number
    windDir: string
    windDirDeg?: number
    pressureTrend: 'rising' | 'steady' | 'falling'
  }
  water: {
    currentKts: number
    currentDirDeg: number
    swellM: number
    swellPeriodS: number
    tide: 'flood' | 'ebb' | 'slack'
    sstC: number
    clarity: string
  }
  fish: {
    target: string
    biteWindow: string
    tactic: string
    risk: string
  }
  timeline: Array<{
    isoTime?: string
    time: string
    bite: number
    airTempC?: number
    condition?: string
    windKts: number
    windGustKts?: number
    windDirDeg?: number
    currentKts: number
    currentDirDeg?: number
    waveM?: number
    wavePeriodS?: number
    tideHeightM?: number
    precipMm?: number
    pressureHpa?: number
    sstC?: number
  }>
  apiSources?: ApiSourceStatus[]
}

export type ApiSourceStatus = {
  name: string
  status: 'ok' | 'limited' | 'failed' | 'skipped'
  detail: string
}

export type OfficialStationReading = {
  stationCode: string
  stationName: string
  distanceKm: number
  lat?: number
  lng?: number
  observed?: {
    value?: number
    directionDeg?: number
    time: string
    qcFlagCode?: string
  }
  prediction?: {
    value?: number
    directionDeg?: number
    time: string
    qcFlagCode?: string
  }
  predictionSeries?: Array<{
    value?: number
    directionDeg?: number
    time: string
    qcFlagCode?: string
  }>
}

export type CanadianStationData = {
  waterLevel?: OfficialStationReading
  current?: OfficialStationReading
  currentStations?: OfficialStationReading[]
}

export type ForecastGridCell = MarinePointForecast & {
  gridX: number
  gridY: number
  marine: {
    waveM: number
    wavePeriodS: number
    swellDirDeg: number
    tideHeightM: number
    salinityPsu: number
    visibilityKm: number
    precipMm: number
    pressureHpa: number
  }
  canadianStations?: CanadianStationData
}

export type TaskStatus = {
  id: string
  title: string
  status: 'done' | 'mvp' | 'planned'
  detail: string
}

export type RuleRecord = {
  id: string
  area: string
  species: string
  status: 'open' | 'restricted' | 'closed'
  summary: string
  source: string
  updatedAt: string
}

export type WarningFeatureProperties = {
  id: string
  type: string
  severity: 'watch' | 'advisory' | 'warning'
  title: string
  details: string
  updatedAt: string
}

export type AlbacoreFeatureProperties = {
  id: string
  name: string
  score: number
  tempC: number
  chlorophyll: string
  travelNm: number
  note: string
}

export type UserSpot = {
  id: string
  name: string
  lat: number
  lng: number
  target: string
  notes: string
  createdAt: string
}

export type BluewaterCell = {
  id: string
  zone: string
  sstC: number
  breakStrength: string
  color: string
  note: string
}

export type DepthGridPoint = {
  id: string
  lat: number
  lng: number
  status: 'ok' | 'nodata' | 'error'
  depthM?: number
  rawElevationM?: number
  message?: string
}

export type DepthGridCache = {
  source: string
  sourceUrl: string
  resolutionM: number
  note: string
  generatedAt: string
  points: DepthGridPoint[]
}

export type AppData = {
  manifest: DataManifest
  forecasts: MarinePointForecast[]
  forecastGrid: ForecastGridCell[]
  rules: RuleRecord[]
  warnings: GeoJSON.FeatureCollection<GeoJSON.Geometry, WarningFeatureProperties>
  pfma: GeoJSON.FeatureCollection<GeoJSON.Geometry, { id: string; name: string }>
  rca: GeoJSON.FeatureCollection<GeoJSON.Geometry, {
    id: string
    objectId: number
    name: string
    areaSqKm: number
    kind: 'RCA'
    status: 'closed'
    label: string
    summary: string
    source: string
  }>
  albacore: GeoJSON.FeatureCollection<GeoJSON.Point, AlbacoreFeatureProperties>
  bluewater: BluewaterCell[]
  depthGrid: DepthGridCache
  tasks: TaskStatus[]
}
