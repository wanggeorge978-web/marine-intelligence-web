import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  AlertTriangle,
  Anchor,
  AreaChart,
  Bell,
  CheckCircle2,
  ChevronRight,
  CloudSun,
  Database,
  Fish,
  Gauge,
  Layers,
  LocateFixed,
  Map,
  MapPin,
  Plus,
  RefreshCcw,
  Route,
  Settings,
  ShipWheel,
  ThermometerSun,
  Trash2,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import './App.css'
import { loadAppData } from './dataLoader'
import { loadStoredSpots, saveStoredSpots } from './storage'
import type {
  AlbacoreFeatureProperties,
  ApiSourceStatus,
  AppData,
  CanadianStationData,
  ForecastGridCell,
  MarinePointForecast,
  OfficialStationReading,
  PageId,
  UserSpot,
  WarningFeatureProperties,
} from './types'

type OverlayMode = 'weather' | 'wind' | 'waves' | 'current' | 'tide' | 'sst'
type RiskTone = 'excellent' | 'good' | 'fair' | 'poor' | 'danger'
type WorkbenchPanel = 'forecast' | 'stations' | 'trust'

const pages: Array<{ id: PageId; label: string; icon: typeof Map }> = [
  { id: 'map', label: '海况地图', icon: Map },
  { id: 'rules', label: '区域规则', icon: Anchor },
  { id: 'warnings', label: '预警中心', icon: Bell },
  { id: 'bluewater', label: '蓝水与水温', icon: Waves },
  { id: 'albacore', label: '长鳍金枪鱼', icon: Fish },
  { id: 'spots', label: '我的钓点', icon: MapPin },
  { id: 'route', label: '航线快检', icon: Route },
  { id: 'trip', label: '出海简报', icon: ShipWheel },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'data-status', label: '数据状态', icon: Database },
]

const overlayModes: Array<{ id: OverlayMode; label: string; unit: string; icon: typeof Wind }> = [
  { id: 'weather', label: '天气', unit: '分', icon: CloudSun },
  { id: 'wind', label: '风', unit: '节', icon: Wind },
  { id: 'waves', label: '风浪', unit: '米', icon: Waves },
  { id: 'current', label: '水流', unit: '节', icon: Gauge },
  { id: 'tide', label: '潮汐', unit: '米', icon: AreaChart },
  { id: 'sst', label: '水温', unit: 'C', icon: ThermometerSun },
]

const workbenchPanels: Array<{ id: WorkbenchPanel; label: string; icon: typeof Wind }> = [
  { id: 'forecast', label: '点位预报', icon: CloudSun },
  { id: 'stations', label: '官方站点', icon: Gauge },
  { id: 'trust', label: '数据可信度', icon: Database },
]

const defaultCenter: [number, number] = [-125.62, 48.89]

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

function getInitialPage(): PageId {
  const raw = window.location.hash.replace('#/', '') as PageId
  return pages.some((page) => page.id === raw) ? raw : 'map'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function windDirectionName(value: string) {
  const map: Record<string, string> = {
    N: '北风',
    NE: '东北风',
    E: '东风',
    SE: '东南风',
    S: '南风',
    SW: '西南风',
    W: '西风',
    NW: '西北风',
  }
  return map[value] ?? value
}

function tideName(value: MarinePointForecast['water']['tide']) {
  return { flood: '涨潮', ebb: '退潮', slack: '平潮' }[value]
}

function pressureName(value: MarinePointForecast['weather']['pressureTrend']) {
  return { rising: '气压上升', steady: '气压稳定', falling: '气压下降' }[value]
}

function statusName(value: string) {
  return {
    open: '开放',
    restricted: '限制',
    closed: '关闭',
    ok: '正常',
    stale: '过期',
    demo: '待接入',
    watch: '关注',
    advisory: '提醒',
    warning: '警告',
    done: '完成',
    mvp: 'MVP',
    planned: '计划',
  }[value] ?? value
}

function scoreLabel(score: number) {
  if (score >= 82) return '强烈推荐'
  if (score >= 70) return '可以出钓'
  if (score >= 55) return '勉强可钓'
  return '不建议'
}

function toneClass(tone: RiskTone) {
  return `tone-${tone}`
}

function scoreTone(score: number): RiskTone {
  if (score >= 86) return 'excellent'
  if (score >= 72) return 'good'
  if (score >= 56) return 'fair'
  if (score >= 40) return 'poor'
  return 'danger'
}

function windTone(windKts: number): RiskTone {
  if (windKts <= 7) return 'excellent'
  if (windKts <= 12) return 'good'
  if (windKts <= 17) return 'fair'
  if (windKts <= 23) return 'poor'
  return 'danger'
}

function waveTone(waveM: number): RiskTone {
  if (waveM <= 0.7) return 'excellent'
  if (waveM <= 1.2) return 'good'
  if (waveM <= 1.8) return 'fair'
  if (waveM <= 2.6) return 'poor'
  return 'danger'
}

function currentTone(currentKts: number): RiskTone {
  if (currentKts <= 0.4) return 'fair'
  if (currentKts <= 1.2) return 'excellent'
  if (currentKts <= 1.8) return 'good'
  if (currentKts <= 2.6) return 'poor'
  return 'danger'
}

function tideTone(tideHeightM: number): RiskTone {
  const height = Math.abs(tideHeightM)
  if (height <= 0.6) return 'excellent'
  if (height <= 1.2) return 'good'
  if (height <= 1.8) return 'fair'
  if (height <= 2.5) return 'poor'
  return 'danger'
}

function sstTone(sstC: number): RiskTone {
  if (sstC >= 11 && sstC <= 15) return 'excellent'
  if (sstC >= 8 && sstC <= 17) return 'good'
  if (sstC >= 6 && sstC <= 19) return 'fair'
  return 'poor'
}

function overlayTone(mode: OverlayMode, forecast: ForecastGridCell): RiskTone {
  if (mode === 'weather') return scoreTone(forecast.score)
  if (mode === 'wind') return windTone(forecast.weather.windKts)
  if (mode === 'waves') return waveTone(forecast.marine.waveM)
  if (mode === 'current') return currentTone(forecast.water.currentKts)
  if (mode === 'tide') return tideTone(forecast.marine.tideHeightM)
  return sstTone(forecast.water.sstC)
}

function toneColor(tone: RiskTone) {
  return {
    excellent: '#00c853',
    good: '#7ed321',
    fair: '#ffd400',
    poor: '#ff8f00',
    danger: '#d7191c',
  }[tone]
}

function toneSoftColor(tone: RiskTone) {
  return {
    excellent: 'rgba(0, 200, 83, 0.32)',
    good: 'rgba(126, 211, 33, 0.28)',
    fair: 'rgba(255, 212, 0, 0.28)',
    poor: 'rgba(255, 143, 0, 0.30)',
    danger: 'rgba(215, 25, 28, 0.34)',
  }[tone]
}

function toneLabel(tone: RiskTone) {
  return {
    excellent: '很好',
    good: '良好',
    fair: '谨慎',
    poor: '偏差',
    danger: '危险',
  }[tone]
}

function weatherCodeName(code?: number) {
  if (code === undefined) return '未知'
  if (code === 0) return '晴'
  if ([1, 2, 3].includes(code)) return '多云'
  if ([45, 48].includes(code)) return '雾'
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪'
  if ([95, 96, 99].includes(code)) return '雷暴'
  return `天气码 ${code}`
}

function directionNameFromDegrees(degrees?: number) {
  if (degrees === undefined || Number.isNaN(degrees)) return '未知'
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return names[Math.round(degrees / 45) % 8]
}

function windDirectionDetail(degrees?: number) {
  if (degrees === undefined || Number.isNaN(degrees)) return '未知风向'
  return `${windDirectionName(directionNameFromDegrees(degrees))} ${Math.round(degrees)}°`
}

function kmhToKnots(value?: number) {
  return Number(((value ?? 0) * 0.539957).toFixed(1))
}

function pickMarineHeight(...values: Array<number | undefined>) {
  const candidates = values.filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0)
  if (!candidates.length) return 0
  const value = Math.max(...candidates)
  const rounded = Number(value.toFixed(1))
  if (value > 0 && rounded === 0) return 0.05
  return rounded
}

function formatMeters(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value > 0 && value < 0.1) return '<0.1'
  return value.toFixed(1)
}

function trendFromPressure(hourly?: { pressure_msl?: number[] }) {
  const values = hourly?.pressure_msl?.filter((value) => Number.isFinite(value)) ?? []
  if (values.length < 7) return 'steady'
  const delta = values[6] - values[0]
  if (delta > 1.2) return 'rising'
  if (delta < -1.2) return 'falling'
  return 'steady'
}

function tideFromSeaLevel(hourly?: { sea_level_height_msl?: number[] }) {
  const values = hourly?.sea_level_height_msl?.filter((value) => Number.isFinite(value)) ?? []
  if (values.length < 4) return 'slack'
  const delta = values[3] - values[0]
  if (delta > 0.04) return 'flood'
  if (delta < -0.04) return 'ebb'
  return 'slack'
}

function nearestHourlyIndex(times: string[] = [], currentTime?: string) {
  if (!times.length || !currentTime) return 0
  const current = new Date(currentTime).getTime()
  let best = 0
  let bestDelta = Number.POSITIVE_INFINITY
  times.forEach((time, index) => {
    const delta = Math.abs(new Date(time).getTime() - current)
    if (delta < bestDelta) {
      best = index
      bestDelta = delta
    }
  })
  return best
}

type NoaaStation = {
  id: string
  name: string
  lat: number
  lng: number
}

type CanadaTimeSeries = {
  code: string
  id: string
  nameEn?: string
  latitude?: number
  longitude?: number
}

type CanadaStation = {
  id: string
  code: string
  officialName: string
  latitude: number
  longitude: number
  operating: boolean
  type: string
  timeSeries: CanadaTimeSeries[]
}

type CanadaDataPoint = {
  eventDate: string
  qcFlagCode?: string
  value: number
}

type NoaaPrediction = {
  station: NoaaStation
  distanceKm: number
  value: number
  time: string
}

type NoaaCurrentPrediction = NoaaPrediction & {
  directionDeg: number
}

type FreeApiExtras = {
  sources: ApiSourceStatus[]
  airQuality?: {
    usAqi?: number
    pm25?: number
    pm10?: number
  }
  noaaTide?: NoaaPrediction
  noaaCurrent?: NoaaCurrentPrediction
  canadaStations?: CanadianStationData
  nwsAlerts?: Array<{ event?: string; severity?: string }>
}

let noaaWaterLevelStationsPromise: Promise<NoaaStation[]> | null = null
let noaaCurrentStationsPromise: Promise<NoaaStation[]> | null = null
let canadaWaterStationsPromise: Promise<CanadaStation[]> | null = null
let canadaCurrentStationsPromise: Promise<CanadaStation[]> | null = null

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '')
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earthKm = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earthKm * Math.asin(Math.sqrt(h))
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 7000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status}`)
    return response.json() as Promise<T>
  } finally {
    window.clearTimeout(timer)
  }
}

async function fetchNoaaStations(type: 'waterlevels' | 'currentpredictions') {
  const url = `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=${type}`
  const data = await fetchJsonWithTimeout<{ stations?: NoaaStation[] }>(url, 10000)
  return (data.stations ?? []).filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lng))
}

async function fetchCanadaStations(timeSeriesCode: string) {
  const url = `https://api-sine.dfo-mpo.gc.ca/api/v1/stations?time-series-code=${timeSeriesCode}`
  const data = await fetchJsonWithTimeout<CanadaStation[]>(url, 10000)
  return data.filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
}

async function fetchCanadaWaterStations() {
  const [observed, predicted] = await Promise.all([
    fetchCanadaStations('wlo'),
    fetchCanadaStations('wlp'),
  ])
  const byId = new globalThis.Map<string, CanadaStation>()
  observed.concat(predicted).forEach((station) => byId.set(station.id, station))
  return [...byId.values()]
}

async function fetchCanadaCurrentStations() {
  const [observedSpeed, predictedSpeed, events] = await Promise.all([
    fetchCanadaStations('wcs1').catch((): CanadaStation[] => []),
    fetchCanadaStations('wcsp1').catch((): CanadaStation[] => []),
    fetchCanadaStations('wcp1-events').catch((): CanadaStation[] => []),
  ])
  const byId = new globalThis.Map<string, CanadaStation>()
  observedSpeed.concat(predictedSpeed, events).forEach((station) => byId.set(station.id, station))
  return [...byId.values()]
}

function nearestStation(stations: NoaaStation[], lat: number, lng: number, maxKm: number): { station: NoaaStation; distanceKm: number } | null {
  let best: { station: NoaaStation; distanceKm: number } | null = null
  for (const station of stations) {
    const distanceKm = haversineKm({ lat, lng }, station)
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) {
      best = { station, distanceKm }
    }
  }
  return best
}

function nearestCanadaStation(stations: CanadaStation[], lat: number, lng: number, maxKm: number): { station: CanadaStation; distanceKm: number } | null {
  let best: { station: CanadaStation; distanceKm: number } | null = null
  for (const station of stations) {
    const distanceKm = haversineKm({ lat, lng }, { lat: station.latitude, lng: station.longitude })
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) {
      best = { station, distanceKm }
    }
  }
  return best
}

function nearestCanadaStations(stations: CanadaStation[], lat: number, lng: number, maxKm: number, limit: number) {
  return stations
    .map((station) => ({
      station,
      distanceKm: haversineKm({ lat, lng }, { lat: station.latitude, lng: station.longitude }),
    }))
    .filter((item) => item.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
}

function nearestTimedItem<T extends { t?: string; Time?: string }>(items: T[] = []) {
  const now = Date.now()
  return items.reduce<T | undefined>((best, item) => {
    const itemTime = new Date(item.t ?? item.Time ?? '').getTime()
    const bestTime = new Date(best?.t ?? best?.Time ?? '').getTime()
    if (!Number.isFinite(itemTime)) return best
    if (!best || Math.abs(itemTime - now) < Math.abs(bestTime - now)) return item
    return best
  }, undefined)
}

function nearestCanadaDataPoint(items: CanadaDataPoint[] = []) {
  const now = Date.now()
  return items.reduce<CanadaDataPoint | undefined>((best, item) => {
    const itemTime = new Date(item.eventDate).getTime()
    const bestTime = new Date(best?.eventDate ?? '').getTime()
    if (!Number.isFinite(itemTime)) return best
    if (!best || Math.abs(itemTime - now) < Math.abs(bestTime - now)) return item
    return best
  }, undefined)
}

function nearestCanadaDataPointAt(items: CanadaDataPoint[] = [], targetIso?: string) {
  const targetTime = new Date(targetIso ?? '').getTime()
  if (!Number.isFinite(targetTime)) return nearestCanadaDataPoint(items)
  return items.reduce<CanadaDataPoint | undefined>((best, item) => {
    const itemTime = new Date(item.eventDate).getTime()
    const bestTime = new Date(best?.eventDate ?? '').getTime()
    if (!Number.isFinite(itemTime)) return best
    if (!best || Math.abs(itemTime - targetTime) < Math.abs(bestTime - targetTime)) return item
    return best
  }, undefined)
}

function combineCanadaCurrentPredictionSeries(speedSeries: CanadaDataPoint[] = [], directionSeries: CanadaDataPoint[] = []) {
  return speedSeries
    .filter((point) => Number.isFinite(point.value))
    .map((speedPoint) => {
      const directionPoint = nearestCanadaDataPointAt(directionSeries, speedPoint.eventDate)
      return {
        value: speedPoint.value,
        directionDeg: directionPoint?.value,
        time: speedPoint.eventDate,
        qcFlagCode: speedPoint.qcFlagCode,
      }
    })
}

function utcIso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function hasTimeSeries(station: CanadaStation, code: string) {
  return station.timeSeries.some((series) => series.code === code)
}

async function fetchCanadaStationSeries(stationId: string, code: string, fromHours: number, toHours: number, resolution = 'SIXTY_MINUTES') {
  const params = new URLSearchParams({
    'time-series-code': code,
    from: utcIso(fromHours),
    to: utcIso(toHours),
    resolution,
  })
  return fetchJsonWithTimeout<CanadaDataPoint[]>(
    `https://api-sine.dfo-mpo.gc.ca/api/v1/stations/${stationId}/data?${params}`,
    9000,
  )
}

async function fetchCanadaWaterReading(lat: number, lng: number) {
  canadaWaterStationsPromise ??= fetchCanadaWaterStations()
  const stations = await canadaWaterStationsPromise
  const nearest = nearestCanadaStation(stations, lat, lng, 250)
  if (!nearest) return undefined
  const { station, distanceKm } = nearest
  const [observed, prediction] = await Promise.all([
    hasTimeSeries(station, 'wlo') ? fetchCanadaStationSeries(station.id, 'wlo', -6, 1).then(nearestCanadaDataPoint).catch(() => undefined) : Promise.resolve(undefined),
    hasTimeSeries(station, 'wlp') ? fetchCanadaStationSeries(station.id, 'wlp', -1, 12).then(nearestCanadaDataPoint).catch(() => undefined) : Promise.resolve(undefined),
  ])
  if (!observed && !prediction) return undefined
  return {
    stationCode: station.code,
    stationName: station.officialName,
    distanceKm,
    observed: observed ? { value: observed.value, time: observed.eventDate, qcFlagCode: observed.qcFlagCode } : undefined,
    prediction: prediction ? { value: prediction.value, time: prediction.eventDate, qcFlagCode: prediction.qcFlagCode } : undefined,
  }
}

async function fetchCanadaCurrentReading(lat: number, lng: number) {
  canadaCurrentStationsPromise ??= fetchCanadaCurrentStations()
  const stations = await canadaCurrentStationsPromise
  const nearest = nearestCanadaStation(stations, lat, lng, 140)
  if (!nearest) return undefined
  const { station, distanceKm } = nearest
  return fetchCanadaCurrentStationReading(station, distanceKm)
}

async function fetchCanadaCurrentStationReading(station: CanadaStation, distanceKm: number) {
  const [observedSpeedSeries, observedDirectionSeries, predictedSpeedSeries, predictedDirectionSeries] = await Promise.all([
    hasTimeSeries(station, 'wcs1') ? fetchCanadaStationSeries(station.id, 'wcs1', -6, 1).then(nearestCanadaDataPoint).catch(() => undefined) : Promise.resolve(undefined),
    hasTimeSeries(station, 'wcd1') ? fetchCanadaStationSeries(station.id, 'wcd1', -6, 1).then(nearestCanadaDataPoint).catch(() => undefined) : Promise.resolve(undefined),
    hasTimeSeries(station, 'wcsp1') ? fetchCanadaStationSeries(station.id, 'wcsp1', -1, 30, 'FIFTEEN_MINUTES').catch((): CanadaDataPoint[] => []) : Promise.resolve([]),
    hasTimeSeries(station, 'wcdp1') ? fetchCanadaStationSeries(station.id, 'wcdp1', -1, 30, 'FIFTEEN_MINUTES').catch((): CanadaDataPoint[] => []) : Promise.resolve([]),
  ])
  const predictedSpeed = nearestCanadaDataPoint(predictedSpeedSeries)
  const predictedDirection = nearestCanadaDataPointAt(predictedDirectionSeries, predictedSpeed?.eventDate)
  const predictionSeries = combineCanadaCurrentPredictionSeries(predictedSpeedSeries, predictedDirectionSeries)
  const observedSpeed = observedSpeedSeries
  const observedDirection = observedDirectionSeries
  if (!observedSpeed && !predictedSpeed) return undefined
  return {
    stationCode: station.code,
    stationName: station.officialName,
    distanceKm,
    lat: station.latitude,
    lng: station.longitude,
    observed: observedSpeed ? {
      value: observedSpeed.value,
      directionDeg: observedDirection?.value,
      time: observedSpeed.eventDate,
      qcFlagCode: observedSpeed.qcFlagCode,
    } : undefined,
    prediction: predictedSpeed ? {
      value: predictedSpeed.value,
      directionDeg: predictedDirection?.value,
      time: predictedSpeed.eventDate,
      qcFlagCode: predictedSpeed.qcFlagCode,
    } : undefined,
    predictionSeries,
  }
}

async function fetchCanadaCurrentStationMarkers(lat: number, lng: number) {
  canadaCurrentStationsPromise ??= fetchCanadaCurrentStations()
  const stations = await canadaCurrentStationsPromise
  const nearest = nearestCanadaStations(stations, lat, lng, 180, 6)
  const readings = await Promise.all(nearest.map(({ station, distanceKm }) => fetchCanadaCurrentStationReading(station, distanceKm).catch(() => undefined)))
  return readings.filter((reading): reading is NonNullable<typeof reading> => Boolean(reading))
}

async function fetchCanadaStationData(lat: number, lng: number): Promise<CanadianStationData | undefined> {
  const [waterLevel, current, currentStations] = await Promise.all([
    fetchCanadaWaterReading(lat, lng),
    fetchCanadaCurrentReading(lat, lng),
    fetchCanadaCurrentStationMarkers(lat, lng),
  ])
  if (!waterLevel && !current && !currentStations.length) return undefined
  return { waterLevel, current, currentStations }
}

async function fetchOpenMeteoAirQuality(lat: number, lng: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'us_aqi,pm2_5,pm10',
    timezone: 'auto',
  })
  const data = await fetchJsonWithTimeout<{
    current?: { us_aqi?: number; pm2_5?: number; pm10?: number }
  }>(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`)
  return {
    usAqi: data.current?.us_aqi,
    pm25: data.current?.pm2_5,
    pm10: data.current?.pm10,
  }
}

async function fetchNoaaTidePrediction(lat: number, lng: number): Promise<NoaaPrediction | null> {
  noaaWaterLevelStationsPromise ??= fetchNoaaStations('waterlevels')
  const stations = await noaaWaterLevelStationsPromise
  const nearest = nearestStation(stations, lat, lng, 350)
  if (!nearest) return null
  const params = new URLSearchParams({
    product: 'predictions',
    application: 'marine-intelligence-web',
    begin_date: todayYmd(),
    range: '48',
    datum: 'MLLW',
    station: nearest.station.id,
    time_zone: 'lst_ldt',
    units: 'metric',
    format: 'json',
  })
  const data = await fetchJsonWithTimeout<{ predictions?: Array<{ t: string; v: string }> }>(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`,
  )
  const item = nearestTimedItem(data.predictions)
  const value = Number(item?.v)
  if (!item || !Number.isFinite(value)) return null
  return { station: nearest.station, distanceKm: nearest.distanceKm, value: Number(value.toFixed(2)), time: item.t }
}

async function fetchNoaaCurrentPrediction(lat: number, lng: number): Promise<NoaaCurrentPrediction | null> {
  noaaCurrentStationsPromise ??= fetchNoaaStations('currentpredictions')
  const stations = await noaaCurrentStationsPromise
  const nearest = nearestStation(stations, lat, lng, 250)
  if (!nearest) return null
  const params = new URLSearchParams({
    product: 'currents_predictions',
    application: 'marine-intelligence-web',
    begin_date: todayYmd(),
    range: '48',
    station: nearest.station.id,
    time_zone: 'lst_ldt',
    units: 'metric',
    format: 'json',
  })
  const data = await fetchJsonWithTimeout<{
    current_predictions?: { cp?: Array<{ Time: string; Velocity_Major: number; meanFloodDir?: number; meanEbbDir?: number }> }
  }>(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`)
  const item = nearestTimedItem(data.current_predictions?.cp)
  const velocityCms = Number(item?.Velocity_Major)
  if (!item || !Number.isFinite(velocityCms)) return null
  return {
    station: nearest.station,
    distanceKm: nearest.distanceKm,
    value: Number((Math.abs(velocityCms) * 0.0194384).toFixed(1)),
    directionDeg: Math.round(velocityCms >= 0 ? item.meanFloodDir ?? 0 : item.meanEbbDir ?? 0),
    time: item.Time,
  }
}

async function fetchNwsAlerts(lat: number, lng: number) {
  const params = new URLSearchParams({ point: `${lat.toFixed(4)},${lng.toFixed(4)}` })
  const data = await fetchJsonWithTimeout<{
    features?: Array<{ properties?: { event?: string; severity?: string } }>
  }>(`https://api.weather.gov/alerts/active?${params}`)
  return (data.features ?? []).map((feature) => ({
    event: feature.properties?.event,
    severity: feature.properties?.severity,
  }))
}

async function fetchFreeApiExtras(lat: number, lng: number): Promise<FreeApiExtras> {
  const extras: FreeApiExtras = { sources: [] }
  const [airQuality, canadaStations, noaaTide, noaaCurrent, nwsAlerts] = await Promise.allSettled([
    fetchOpenMeteoAirQuality(lat, lng),
    fetchCanadaStationData(lat, lng),
    fetchNoaaTidePrediction(lat, lng),
    fetchNoaaCurrentPrediction(lat, lng),
    fetchNwsAlerts(lat, lng),
  ])

  if (airQuality.status === 'fulfilled') {
    extras.airQuality = airQuality.value
    extras.sources.push({ name: 'Open-Meteo Air Quality', status: 'ok', detail: `AQI ${airQuality.value.usAqi ?? 'N/A'} / PM2.5 ${airQuality.value.pm25 ?? 'N/A'}` })
  } else {
    extras.sources.push({ name: 'Open-Meteo Air Quality', status: 'failed', detail: '空气质量接口未返回' })
  }

  if (canadaStations.status === 'fulfilled' && canadaStations.value) {
    extras.canadaStations = canadaStations.value
    const waterName = canadaStations.value.waterLevel?.stationName
    const currentName = canadaStations.value.current?.stationName
    extras.sources.push({
      name: 'DFO/CHS Canada Stations',
      status: 'ok',
      detail: [waterName ? `水位 ${waterName}` : '', currentName ? `潮流 ${currentName}` : ''].filter(Boolean).join(' / '),
    })
  } else {
    extras.sources.push({
      name: 'DFO/CHS Canada Stations',
      status: canadaStations.status === 'rejected' ? 'failed' : 'limited',
      detail: '附近未命中加拿大官方水位/潮流站',
    })
  }

  if (noaaTide.status === 'fulfilled' && noaaTide.value) {
    extras.noaaTide = noaaTide.value
    extras.sources.push({ name: 'NOAA CO-OPS Tide', status: 'ok', detail: `${noaaTide.value.station.name} ${noaaTide.value.value} m，约 ${Math.round(noaaTide.value.distanceKm)} km` })
  } else {
    extras.sources.push({ name: 'NOAA CO-OPS Tide', status: noaaTide.status === 'rejected' ? 'failed' : 'limited', detail: '附近 350 km 未命中美国 NOAA 潮位站' })
  }

  if (noaaCurrent.status === 'fulfilled' && noaaCurrent.value) {
    extras.noaaCurrent = noaaCurrent.value
    extras.sources.push({ name: 'NOAA CO-OPS Current', status: 'ok', detail: `${noaaCurrent.value.station.name} ${noaaCurrent.value.value} kt，约 ${Math.round(noaaCurrent.value.distanceKm)} km` })
  } else {
    extras.sources.push({ name: 'NOAA CO-OPS Current', status: noaaCurrent.status === 'rejected' ? 'failed' : 'limited', detail: '附近 250 km 未命中美国 NOAA 潮流站' })
  }

  if (nwsAlerts.status === 'fulfilled') {
    extras.nwsAlerts = nwsAlerts.value
    extras.sources.push({ name: 'NWS Alerts', status: 'ok', detail: nwsAlerts.value.length ? `${nwsAlerts.value.length} 条美国天气预警` : '无美国 NWS 活跃预警' })
  } else {
    extras.sources.push({ name: 'NWS Alerts', status: 'limited', detail: '该坐标可能不在美国 NWS 覆盖范围' })
  }

  return extras
}

async function fetchRealForecast(lng: number, lat: number): Promise<ForecastGridCell> {
  const weatherParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: '7',
  })
  const marineParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,swell_wave_height,swell_wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature,sea_level_height_msl',
    hourly: 'wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,swell_wave_height,swell_wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature,sea_level_height_msl',
    timezone: 'auto',
    forecast_days: '7',
  })
  const [weatherResponse, marineResponse, extras] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${weatherParams}`),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${marineParams}`),
    fetchFreeApiExtras(lat, lng),
  ])
  if (!weatherResponse.ok || !marineResponse.ok) {
    throw new Error('真实天气/海洋预报接口请求失败')
  }
  const weather = await weatherResponse.json()
  const marine = await marineResponse.json()
  const weatherIndex = nearestHourlyIndex(weather.hourly?.time, weather.current?.time)
  const marineIndex = nearestHourlyIndex(marine.hourly?.time, marine.current?.time)
  const currentKts = kmhToKnots(marine.current?.ocean_current_velocity)
  const waveM = pickMarineHeight(marine.current?.wave_height, marine.current?.wind_wave_height, marine.current?.swell_wave_height)
  const windKts = Number((weather.current?.wind_speed_10m ?? 0).toFixed(1))
  const seaLevel = Number((marine.current?.sea_level_height_msl ?? 0).toFixed(2))
  const canadaTideHeight = extras.canadaStations?.waterLevel?.prediction?.value ?? extras.canadaStations?.waterLevel?.observed?.value
  const bestTideHeight = canadaTideHeight ?? extras.noaaTide?.value ?? seaLevel
  const sst = Number((marine.current?.sea_surface_temperature ?? marine.hourly?.sea_surface_temperature?.[marineIndex] ?? 0).toFixed(1))
  const currentDirDeg = Math.round(marine.current?.ocean_current_direction ?? 0)
  const windDirDeg = Math.round(weather.current?.wind_direction_10m ?? weather.hourly?.wind_direction_10m?.[weatherIndex] ?? 0)
  const score = Math.max(20, Math.min(95, Math.round(92 - Math.max(0, windKts - 10) * 2.2 - Math.max(0, waveM - 1.2) * 10 - Math.max(0, currentKts - 1.8) * 8)))
  const timeline = Array.from({ length: 8 }, (_, itemIndex) => {
    const weatherHour = weatherIndex + itemIndex * 3
    const marineHour = marineIndex + itemIndex * 3
    const tWind = Number((weather.hourly?.wind_speed_10m?.[weatherHour] ?? windKts).toFixed(1))
    const tWave = pickMarineHeight(
      marine.hourly?.wave_height?.[marineHour],
      marine.hourly?.wind_wave_height?.[marineHour],
      marine.hourly?.swell_wave_height?.[marineHour],
    )
    const tCurrent = kmhToKnots(marine.hourly?.ocean_current_velocity?.[marineHour])
    const tTide = Number((marine.hourly?.sea_level_height_msl?.[marineHour] ?? seaLevel).toFixed(2))
    return {
      isoTime: weather.hourly?.time?.[weatherHour] ?? marine.hourly?.time?.[marineHour],
      time: (weather.hourly?.time?.[weatherHour] ?? marine.hourly?.time?.[marineHour] ?? '').slice(11, 16),
      bite: Math.max(5, Math.min(95, Math.round(score - Math.max(0, tWind - 12) * 2 - Math.max(0, tWave - 1.5) * 8))),
      windKts: tWind,
      windDirDeg: Math.round(weather.hourly?.wind_direction_10m?.[weatherHour] ?? windDirDeg),
      currentKts: tCurrent,
      waveM: tWave,
      tideHeightM: tTide,
    }
  })

  return {
    id: `open-meteo-${lng.toFixed(4)}-${lat.toFixed(4)}`,
    gridX: 0,
    gridY: 0,
    name: `点击位置 ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat,
    lng,
    area: 'Open-Meteo 实时点预报',
    updatedAt: weather.current?.time ?? new Date().toISOString(),
    score,
    weather: {
      condition: weatherCodeName(weather.current?.weather_code),
      airTempC: Number((weather.current?.temperature_2m ?? weather.hourly?.temperature_2m?.[weatherIndex] ?? 0).toFixed(1)),
      windKts,
      windDir: directionNameFromDegrees(windDirDeg),
      windDirDeg,
      pressureTrend: trendFromPressure(weather.hourly),
    },
    water: {
      currentKts,
      currentDirDeg,
      swellM: Number((marine.current?.swell_wave_height ?? marine.current?.wave_height ?? 0).toFixed(1)),
      swellPeriodS: Number((marine.current?.wave_period ?? 0).toFixed(1)),
      tide: tideFromSeaLevel(marine.hourly),
      sstC: sst,
      clarity: '真实 API 未提供水色',
    },
    marine: {
      waveM,
      wavePeriodS: Number((marine.current?.wave_period ?? 0).toFixed(1)),
      swellDirDeg: Math.round(marine.current?.swell_wave_direction ?? marine.current?.wave_direction ?? 0),
      tideHeightM: bestTideHeight,
      salinityPsu: 0,
      visibilityKm: 0,
      precipMm: Number((weather.current?.precipitation ?? 0).toFixed(1)),
      pressureHpa: Number((weather.current?.pressure_msl ?? 0).toFixed(1)),
    },
    fish: {
      target: '按真实天气/海况判断目标鱼',
      biteWindow: '查看下方分时预测',
      tactic: `此点已接入 Open-Meteo 天气/海洋/空气质量、加拿大 DFO/CHS 水位与潮流站、NOAA CO-OPS、NWS。海流速度使用 Open-Meteo 海洋模型；加拿大/NOAA 潮流站只作为附近站点参考，不覆盖点击点海流。`,
      risk: '免费 API 有区域覆盖和频率限制；真实出海仍需核对官方海况、潮汐、VHF 和当地法规。',
    },
    timeline,
    canadianStations: extras.canadaStations,
    apiSources: [
      { name: 'Open-Meteo Forecast', status: 'ok', detail: '天气、风、气压、降水' },
      { name: 'Open-Meteo Marine', status: 'ok', detail: '浪、海流、海表温度、海平面' },
      ...extras.sources,
    ],
  }
}

function currentInterpretation(forecast: ForecastGridCell) {
  if (forecast.water.currentKts >= 1.8) return '水流偏强，鱼会更贴结构和流边，底钓、漂流和抛锚都要保守。'
  if (forecast.water.currentKts <= 0.8) return '水流较缓，适合轻铅慢拖和近岸精细控线，但诱鱼扩散会弱一点。'
  return '水流强度适中，能把饵鱼和味道带起来，是拖钓和漂流搜索比较舒服的窗口。'
}

function weatherInterpretation(forecast: ForecastGridCell) {
  if (forecast.weather.windKts >= 14 || forecast.marine.waveM >= 1.8) return '风浪已经进入谨慎区间，外海线路建议早出早回或改近岸。'
  if (forecast.weather.windKts <= 7 && forecast.marine.waveM <= 0.9) return '风浪较轻，操船和控线压力小，适合扩大搜索范围。'
  return '风浪中等，可以作业，但要持续盯返程方向和下午风浪变化。'
}

function CurrentArrow({ degrees }: { degrees: number }) {
  return (
    <svg className="line-icon current-arrow" viewBox="0 0 24 24" style={{ transform: `rotate(${degrees}deg)` }} aria-label="水流方向">
      <path d="M12 20V4" />
      <path d="M6 10l6-6 6 6" />
    </svg>
  )
}

function TunaIcon() {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12c3.5-4.5 9.5-5.5 15-1.5" />
      <path d="M3 12c3.5 4.5 9.5 5.5 15 1.5" />
      <path d="M18 10.5l3-3v9l-3-3" />
      <path d="M9.5 9.5l-2-3" />
      <path d="M9.5 14.5l-2 3" />
      <path d="M6.7 12h.1" />
    </svg>
  )
}

function StatCard({ icon: Icon, label, value, detail, tone }: { icon: typeof Wind; label: string; value: string; detail: string; tone: RiskTone }) {
  return (
    <div className={`stat-card ${toneClass(tone)}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function selectedPointGeoJson(forecast: ForecastGridCell): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { score: forecast.score },
      geometry: { type: 'Point', coordinates: [forecast.lng, forecast.lat] },
    }],
  }
}

function stationPredictionAt(station: OfficialStationReading, isoTime?: string) {
  const series = station.predictionSeries ?? []
  if (!series.length || !isoTime) return station.prediction
  const targetTime = new Date(isoTime).getTime()
  if (!Number.isFinite(targetTime)) return station.prediction
  const ordered = series
    .filter((point) => Number.isFinite(new Date(point.time).getTime()) && Number.isFinite(point.value))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const previous = [...ordered].reverse().find((point) => new Date(point.time).getTime() <= targetTime)
  const next = ordered.find((point) => new Date(point.time).getTime() >= targetTime)
  if (previous && next && previous !== next) {
    const previousTime = new Date(previous.time).getTime()
    const nextTime = new Date(next.time).getTime()
    const ratio = (targetTime - previousTime) / Math.max(1, nextTime - previousTime)
    return {
      value: Number(((previous.value ?? 0) + ((next.value ?? previous.value ?? 0) - (previous.value ?? 0)) * ratio).toFixed(2)),
      directionDeg: interpolateDegrees(previous.directionDeg, next.directionDeg, ratio),
      time: new Date(targetTime).toISOString(),
      qcFlagCode: previous.qcFlagCode ?? next.qcFlagCode,
    }
  }
  return previous ?? next ?? station.prediction
}

function interpolateDegrees(start?: number, end?: number, ratio = 0) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return start ?? end
  const delta = ((((end as number) - (start as number)) % 360) + 540) % 360 - 180
  return Math.round((((start as number) + delta * ratio) + 360) % 360)
}

function stationPredictionLabel(time?: string) {
  if (!time) return '无预测时间'
  return new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function stationPredictionWindow(station?: OfficialStationReading) {
  const times = (station?.predictionSeries ?? [])
    .map((point) => new Date(point.time).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)
  if (!times.length) return undefined
  return { startMs: times[0], endMs: times[times.length - 1] }
}

function clampMinuteOffset(offset: number, station?: OfficialStationReading) {
  const window = stationPredictionWindow(station)
  if (!window) return 0
  const max = Math.max(0, Math.floor((window.endMs - window.startMs) / 60000))
  return Math.max(0, Math.min(max, offset))
}

function stationTimeFromOffset(station?: OfficialStationReading, offset = 0) {
  const window = stationPredictionWindow(station)
  if (!window) return undefined
  return new Date(window.startMs + clampMinuteOffset(offset, station) * 60000).toISOString()
}

function stationMinuteMax(station?: OfficialStationReading) {
  const window = stationPredictionWindow(station)
  if (!window) return 0
  return Math.max(0, Math.floor((window.endMs - window.startMs) / 60000))
}

function canadaCurrentGeoJson(forecast: ForecastGridCell, isoTime?: string): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const stations = forecast.canadianStations?.currentStations ?? []
  return {
    type: 'FeatureCollection',
    features: stations
      .filter((station) => station.lat !== undefined && station.lng !== undefined && station.prediction?.value !== undefined)
      .map((station) => {
        const prediction = stationPredictionAt(station, isoTime)
        return {
          type: 'Feature',
          properties: {
            code: station.stationCode,
            name: station.stationName,
            speed: prediction?.value ?? 0,
            direction: prediction?.directionDeg ?? 0,
            label: `${prediction?.value?.toFixed(1) ?? '—'} kt`,
            distance: Math.round(station.distanceKm),
            predictionTime: prediction?.time ?? '',
            predictionTimeLabel: stationPredictionLabel(prediction?.time),
          },
          geometry: { type: 'Point', coordinates: [station.lng as number, station.lat as number] },
        }
      }),
  }
}

function Shell({ page, setPage, children }: { page: PageId; setPage: (page: PageId) => void; children: React.ReactNode }) {
  return (
    <div className={`app-shell ${page === 'map' ? 'immersive-shell' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#/map" onClick={() => setPage('map')}>
          <span className="brand-mark"><Waves size={22} /></span>
          <span>
            <strong>海钓智能助手</strong>
            <small>全区域天气 风浪 水流 潮汐</small>
          </span>
        </a>
        <nav className="nav-list" aria-label="主导航">
          {pages.map((item) => {
            const Icon = item.icon
            return (
              <a className={page === item.id ? 'active' : ''} href={`#/${item.id}`} key={item.id} onClick={() => setPage(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>
        <div className="source-note">
          <AlertTriangle size={16} />
          <span>地图页已接入真实免费 API；规则和法规页仍需以后续官方源继续补全。真实出海前必须核对官方天气、潮汐、规则和船况。</span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}

function MapView({
  selected,
  setSelected,
}: {
  selected: ForecastGridCell
  setSelected: (forecast: ForecastGridCell) => void
}) {
  const mapNode = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const selectedRef = useRef(selected)
  const [mode, setMode] = useState<OverlayMode>('wind')
  const [searchText, setSearchText] = useState('')
  const [isLoadingPoint, setIsLoadingPoint] = useState(false)
  const [pointError, setPointError] = useState<string | null>(null)
  const [timelineIndex, setTimelineIndex] = useState(0)
  const [workbenchPanel, setWorkbenchPanel] = useState<WorkbenchPanel>('forecast')
  const [selectedStationCode, setSelectedStationCode] = useState<string | null>(null)
  const [stationMinuteOffset, setStationMinuteOffset] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorPoint, setInspectorPoint] = useState({ x: 28, y: 92 })

  const loadPoint = useCallback(async (lng: number, lat: number) => {
    setPointError(null)
    setIsLoadingPoint(true)
    try {
      const forecast = await fetchRealForecast(lng, lat)
      setSelected(forecast)
      setTimelineIndex(0)
      setSelectedStationCode(null)
      setStationMinuteOffset(0)
      setWorkbenchPanel('forecast')
      setInspectorOpen(true)
      const projected = mapRef.current?.project([lng, lat])
      if (projected) setInspectorPoint({ x: projected.x, y: projected.y })
    } catch (reason) {
      setPointError(reason instanceof Error ? reason.message : '真实预报接口请求失败')
    } finally {
      setIsLoadingPoint(false)
    }
  }, [setSelected])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: mapStyle,
      center: defaultCenter,
      zoom: 7.2,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map

    map.on('load', () => {
      const initialSelected = selectedRef.current
      const initialTone = scoreTone(initialSelected.score)
      map.addSource('selected-forecast-point', { type: 'geojson', data: selectedPointGeoJson(initialSelected) })
      map.addLayer({
        id: 'selected-forecast-halo',
        type: 'circle',
        source: 'selected-forecast-point',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 20, 10, 42],
          'circle-color': toneColor(initialTone),
          'circle-opacity': 0.24,
          'circle-stroke-width': 0,
        },
      })
      map.addLayer({
        id: 'selected-forecast-dot',
        type: 'circle',
        source: 'selected-forecast-point',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 9, 10, 16],
          'circle-color': toneColor(initialTone),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 4,
          'circle-opacity': 0.96,
        },
      })
      map.addLayer({
        id: 'selected-forecast-score',
        type: 'symbol',
        source: 'selected-forecast-point',
        layout: {
          'text-field': ['to-string', ['get', 'score']],
          'text-size': 12,
          'text-font': ['Open Sans Bold'],
          'text-anchor': 'center',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0, 0, 0, 0.18)',
          'text-halo-width': 1,
        },
      })
      map.addSource('canada-current-stations', { type: 'geojson', data: canadaCurrentGeoJson(initialSelected, initialSelected.timeline[0]?.isoTime) })
      map.addLayer({
        id: 'canada-current-arrows',
        type: 'symbol',
        source: 'canada-current-stations',
        layout: {
          'text-field': '➤',
          'text-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 18, 1.5, 26, 3, 34],
          'text-rotate': ['get', 'direction'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': ['interpolate', ['linear'], ['get', 'speed'], 0, '#2477ff', 1.2, '#2477ff', 2.0, '#ff8f00', 3.0, '#d7191c'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2.2,
        },
      })
      map.addLayer({
        id: 'canada-current-labels',
        type: 'symbol',
        source: 'canada-current-stations',
        layout: {
          'text-field': ['concat', ['get', 'label'], ' · ', ['get', 'code']],
          'text-size': 12,
          'text-offset': [0, 1.7],
          'text-anchor': 'top',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#10242b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
        },
      })
      const showCanadaCurrentPopup = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        if (!feature) return
        const props = feature.properties ?? {}
        if (props.code) {
          setSelectedStationCode(String(props.code))
          setWorkbenchPanel('stations')
          setInspectorOpen(true)
          setInspectorPoint({ x: event.point.x, y: event.point.y })
        }
      }
      map.on('click', 'canada-current-arrows', showCanadaCurrentPopup)
      map.on('click', 'canada-current-labels', showCanadaCurrentPopup)
      map.on('mouseenter', 'canada-current-arrows', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'canada-current-arrows', () => { map.getCanvas().style.cursor = '' })
      map.on('click', (event) => {
        const currentStationFeatures = map.queryRenderedFeatures(event.point, { layers: ['canada-current-arrows', 'canada-current-labels'] })
        if (currentStationFeatures.length) return
        setInspectorPoint({ x: event.point.x, y: event.point.y })
        void loadPoint(event.lngLat.lng, event.lngLat.lat)
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [loadPoint])

  const activeTimelineIndex = Math.min(timelineIndex, Math.max(0, selected.timeline.length - 1))
  const activeTimelineSlot = selected.timeline[activeTimelineIndex]
  const activeTimelineIso = activeTimelineSlot?.isoTime
  const currentStationList = selected.canadianStations?.currentStations ?? []
  const activeStation = currentStationList.find((station) => station.stationCode === selectedStationCode) ?? selected.canadianStations?.current ?? currentStationList[0]
  const activeStationMinuteOffset = clampMinuteOffset(stationMinuteOffset, activeStation)
  const stationMinuteIso = stationTimeFromOffset(activeStation, activeStationMinuteOffset)
  const effectiveStationTimeIso = workbenchPanel === 'stations' ? stationMinuteIso ?? activeTimelineIso : activeTimelineIso

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('selected-forecast-point') as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(selectedPointGeoJson(selected))
    }
    const canadaSource = map.getSource('canada-current-stations') as maplibregl.GeoJSONSource | undefined
    if (canadaSource) {
      canadaSource.setData(canadaCurrentGeoJson(selected, effectiveStationTimeIso))
    }
    const tone = scoreTone(selected.score)
    if (map.getLayer('selected-forecast-halo')) {
      map.setPaintProperty('selected-forecast-halo', 'circle-color', toneColor(tone))
    }
    if (map.getLayer('selected-forecast-dot')) {
      map.setPaintProperty('selected-forecast-dot', 'circle-color', toneColor(tone))
    }
  }, [selected, effectiveStationTimeIso])

  function searchLocation() {
    const parts = searchText
      .split(/[,\s]+/)
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value))
    if (parts.length >= 2) {
      const [lat, lng] = Math.abs(parts[0]) <= 90 ? [parts[0], parts[1]] : [parts[1], parts[0]]
      void loadPoint(lng, lat)
      setInspectorOpen(true)
      const projected = mapRef.current?.project([lng, lat])
      if (projected) setInspectorPoint({ x: projected.x, y: projected.y })
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 8.3, duration: 800 })
    }
  }

  function focusStation(station: OfficialStationReading) {
    if (station.lng === undefined || station.lat === undefined) return
    setSelectedStationCode(station.stationCode)
    setStationMinuteOffset(0)
    const projected = mapRef.current?.project([station.lng, station.lat])
    if (projected) setInspectorPoint({ x: projected.x, y: projected.y })
    mapRef.current?.flyTo({ center: [station.lng, station.lat], zoom: 10.5, duration: 700 })
    setWorkbenchPanel('stations')
  }

  const scoreRiskTone = scoreTone(selected.score)
  const activeTone = overlayTone(mode, selected)
  const layerLabel = overlayModes.find((item) => item.id === mode)?.label ?? '图层'
  const canadaStationCount = selected.canadianStations?.currentStations?.length ?? 0
  const okSourceCount = selected.apiSources?.filter((source) => source.status === 'ok').length ?? 0
  const sourceCount = selected.apiSources?.length ?? 0
  const mapStyleVars = {
    '--score-color': toneColor(scoreRiskTone),
    '--score-soft': toneSoftColor(scoreRiskTone),
    '--mode-color': toneColor(activeTone),
    '--mode-soft': toneSoftColor(activeTone),
  } as React.CSSProperties

  return (
    <section className={`windy-map-page ${toneClass(scoreRiskTone)} mode-${toneClass(activeTone)}`} style={mapStyleVars}>
      <div ref={mapNode} className="windy-map-canvas" />

      <div className="windy-topbar">
        <div className="windy-search">
          <MapPin size={18} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') searchLocation()
            }}
            placeholder={`${selected.lat.toFixed(3)}, ${selected.lng.toFixed(3)}`}
          />
          <button title="定位到输入坐标" onClick={searchLocation}><LocateFixed size={18} /></button>
        </div>
        <div className="windy-brand">
          <span><Waves size={22} /></span>
          <strong>海钓智能助手</strong>
        </div>
        <div className="windy-actions">
          <a href="#/data-status">T01-T22</a>
          <a href="#/rules">规则</a>
        </div>
      </div>

      <div className="windy-left-badges">
        <div className={toneClass(scoreRiskTone)}><strong>{selected.score}</strong><span>海钓评分</span></div>
        <div className={toneClass(windTone(selected.weather.windKts))}><strong>{selected.weather.windKts}</strong><span>风 kt</span></div>
        <div className={toneClass(waveTone(selected.marine.waveM))}><strong>{formatMeters(selected.marine.waveM)}</strong><span>浪 m</span></div>
        <div className={toneClass(currentTone(selected.water.currentKts))}><strong>{selected.water.currentKts}</strong><span>海流 kt</span></div>
      </div>

      <div className="windy-layer-rail">
        <button className="menu-round" title="菜单"><Layers size={24} /></button>
        {overlayModes.map((item) => {
          const Icon = item.icon
          return (
            <button className={mode === item.id ? 'active' : ''} key={item.id} onClick={() => setMode(item.id)} title={item.label}>
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="windy-color-legend">
        <div><strong>{layerLabel}</strong><span>{toneLabel(activeTone)}</span></div>
        <i />
        <small>好</small><small>谨慎</small><small>危险</small>
      </div>

      {(selected.canadianStations?.currentStations?.length ?? 0) > 0 && (
        <div className="canada-current-map-note">
          <strong>加拿大潮流站</strong>
          <span>蓝/橙/红箭头为 DFO/CHS 站点潮流预测，不是全海面模型</span>
        </div>
      )}

      {!inspectorOpen && (
        <button
          className="open-inspector-button"
          onClick={() => setInspectorOpen(true)}
          style={{ '--popup-x': `${inspectorPoint.x}px`, '--popup-y': `${inspectorPoint.y}px` } as React.CSSProperties}
        >
          <CloudSun size={18} />
          <span>查看此点预报</span>
        </button>
      )}

      {inspectorOpen && (
      <div
        className="forecast-popup map-inspector-window"
        style={{ '--popup-x': `${inspectorPoint.x}px`, '--popup-y': `${inspectorPoint.y}px` } as React.CSSProperties}
      >
        <button className="workbench-close" aria-label="关闭预报窗口" onClick={() => setInspectorOpen(false)}>
          <X size={18} />
        </button>
        <div className="workbench-header">
          <div>
            <strong>海况工作台</strong>
            <span>{stationPredictionLabel(effectiveStationTimeIso)} · {canadaStationCount} 个潮流站 · {okSourceCount}/{sourceCount} 个 API 正常</span>
          </div>
          <div className="workbench-tabs" role="tablist" aria-label="工作台模块">
            {workbenchPanels.map((panel) => {
              const Icon = panel.icon
              return (
                <button
                  aria-selected={workbenchPanel === panel.id}
                  className={workbenchPanel === panel.id ? 'active' : ''}
                  key={panel.id}
                  onClick={() => setWorkbenchPanel(panel.id)}
                  role="tab"
                >
                  <Icon size={16} />
                  <span>{panel.label}</span>
                </button>
              )
            })}
          </div>
        </div>
        <ForecastDetail
          forecast={selected}
          panel={workbenchPanel}
          stationTimeIso={effectiveStationTimeIso}
          activeStation={activeStation}
          stationMinuteOffset={activeStationMinuteOffset}
          stationMinuteMax={stationMinuteMax(activeStation)}
          onStationMinuteChange={setStationMinuteOffset}
          onSelectStation={(station) => {
            setSelectedStationCode(station.stationCode)
            setStationMinuteOffset(0)
          }}
          isLoading={isLoadingPoint}
          error={pointError}
          onFocusStation={focusStation}
        />
        <div className="time-scrubber">
          <div>
            <strong>预测时间</strong>
            <span>{activeTimelineSlot?.time ?? '--:--'} · 预报和潮流箭头同步</span>
          </div>
          <input
            aria-label="选择预测时间"
            type="range"
            min="0"
            max={Math.max(0, selected.timeline.length - 1)}
            step="1"
            value={activeTimelineIndex}
            onInput={(event) => setTimelineIndex(Number(event.currentTarget.value))}
            onChange={(event) => setTimelineIndex(Number(event.target.value))}
          />
        </div>
        <div className="popup-hour-strip" aria-label="分时预报">
          {selected.timeline.map((slot, index) => (
            <button className={index === activeTimelineIndex ? 'active-time' : ''} key={`popup-${slot.time}`} onClick={() => setTimelineIndex(index)}>
              <strong>{slot.time}</strong>
              <span>{slot.bite}</span>
              <small>{slot.windKts}kt · {formatMeters(slot.waveM)}m</small>
            </button>
          ))}
        </div>
      </div>
      )}
    </section>
  )
}

function formatStationTime(value?: string) {
  if (!value) return '无时间'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function qcName(code?: string) {
  if (code === '1') return 'QC 通过'
  if (code === '2') return 'QC 未评估'
  if (code === '3') return 'QC 可疑'
  return 'QC 未知'
}

function stationClockLabel(time?: string) {
  if (!time) return '--:--'
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function stationDayLabel(time?: string) {
  if (!time) return '无日期'
  return new Date(time).toLocaleDateString('zh-CN', { weekday: 'short', month: '2-digit', day: '2-digit' })
}

function CurrentStationDetail({
  station,
  stationTimeIso,
  minuteOffset,
  minuteMax,
  onMinuteChange,
}: {
  station?: OfficialStationReading
  stationTimeIso?: string
  minuteOffset: number
  minuteMax: number
  onMinuteChange: (offset: number) => void
}) {
  if (!station) {
    return <div className="current-station-empty">附近没有可用的 DFO/CHS 潮流预测站。</div>
  }
  const prediction = stationPredictionAt(station, stationTimeIso)
  const series = station.predictionSeries ?? []
  const window = stationPredictionWindow(station)
  const maxSpeed = Math.max(1, ...series.map((point) => point.value ?? 0))
  const width = 420
  const height = 92
  const points = series
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.time).getTime()) && window)
    .map((point) => {
      const time = new Date(point.time).getTime()
      const x = window ? ((time - window.startMs) / Math.max(1, window.endMs - window.startMs)) * width : 0
      const y = height - ((point.value ?? 0) / maxSpeed) * (height - 10) - 5
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const activeTime = new Date(stationTimeIso ?? '').getTime()
  const activeX = window && Number.isFinite(activeTime) ? ((activeTime - window.startMs) / Math.max(1, window.endMs - window.startMs)) * width : 0
  const strongest = [...series].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0]
  const nextStrong = series.find((point) => new Date(point.time).getTime() > activeTime && (point.value ?? 0) >= maxSpeed * 0.75)
  return (
    <div className="current-station-detail">
      <div className="current-station-title">
        <div>
          <span>DFO/CHS 潮流预测站</span>
          <strong>{station.stationName}</strong>
          <small>{station.stationCode} · {Math.round(station.distanceKm)} km · 官方 15 分钟点，分钟级插值</small>
        </div>
        <div className="station-fav">★</div>
      </div>
      <div className="current-dial-row">
        <div className="current-speed-dial">
          <div className="dial-arrow" style={{ transform: `rotate(${prediction?.directionDeg ?? 0}deg)` }}>➤</div>
          <strong>{prediction?.value?.toFixed(2) ?? '--'}</strong>
          <span>kts</span>
        </div>
        <div className="current-curve">
          <div className="curve-meta">
            <span>{stationClockLabel(stationTimeIso)}</span>
            <strong>{prediction?.directionDeg?.toFixed(0) ?? '--'}°</strong>
            <span>{stationDayLabel(stationTimeIso)}</span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="潮流速度曲线">
            <rect width={width} height={height} rx="6" />
            <line x1="0" x2={width} y1={height * 0.58} y2={height * 0.58} />
            <polyline points={points} />
            <line className="now-line" x1={activeX} x2={activeX} y1="0" y2={height} />
          </svg>
          <div className="curve-events">
            <span>最强 {stationClockLabel(strongest?.time)} · {strongest?.value?.toFixed(2) ?? '--'} kt</span>
            <span>后续强流 {stationClockLabel(nextStrong?.time)} · {nextStrong?.value?.toFixed(2) ?? '--'} kt</span>
          </div>
        </div>
      </div>
      <input
        aria-label="分钟级潮流时间"
        type="range"
        min="0"
        max={minuteMax}
        step="1"
        value={Math.min(minuteOffset, minuteMax)}
        onInput={(event) => onMinuteChange(Number(event.currentTarget.value))}
        onChange={(event) => onMinuteChange(Number(event.target.value))}
      />
    </div>
  )
}

function ForecastDetail({
  forecast,
  panel,
  stationTimeIso,
  activeStation,
  stationMinuteOffset,
  stationMinuteMax,
  onStationMinuteChange,
  onSelectStation,
  isLoading,
  error,
  onFocusStation,
}: {
  forecast: ForecastGridCell
  panel: WorkbenchPanel
  stationTimeIso?: string
  activeStation?: OfficialStationReading
  stationMinuteOffset: number
  stationMinuteMax: number
  onStationMinuteChange: (offset: number) => void
  onSelectStation?: (station: OfficialStationReading) => void
  isLoading?: boolean
  error?: string | null
  onFocusStation?: (station: OfficialStationReading) => void
}) {
  const breakdown = [
    { label: '天气', value: `${forecast.weather.condition} / ${forecast.weather.airTempC} C`, note: `${pressureName(forecast.weather.pressureTrend)}，气压 ${forecast.marine.pressureHpa} hPa，降水 ${forecast.marine.precipMm} mm。` },
    { label: '风浪', value: `${forecast.weather.windKts} 节 / ${formatMeters(forecast.marine.waveM)} 米`, note: weatherInterpretation(forecast) },
    { label: '海流', value: `${forecast.water.currentKts} 节`, note: currentInterpretation(forecast) },
    { label: '海平面', value: `${tideName(forecast.water.tide)} ${forecast.marine.tideHeightM} 米`, note: `Open-Meteo 提供 sea_level_height_msl，可作为潮位趋势参考；水流方向 ${forecast.water.currentDirDeg} 度。` },
    { label: '水温', value: `${forecast.water.sstC} C`, note: `${forecast.water.clarity}。Open-Meteo Marine API 提供海表温度，不提供水色/能见度。` },
  ]
  const apiSources = forecast.apiSources ?? []
  const canada = forecast.canadianStations
  const okSourceCount = apiSources.filter((source) => source.status === 'ok').length
  const sourceStatusText = isLoading
    ? '正在更新 API'
    : error
      ? '接口有错误'
      : `${okSourceCount}/${apiSources.length || 0} 个 API 正常`
  const waterLevelSummary = canada?.waterLevel
    ? `${canada.waterLevel.stationName} ${canada.waterLevel.prediction?.value?.toFixed(2) ?? canada.waterLevel.observed?.value?.toFixed(2) ?? '--'} m`
    : '无附近水位站'
  const activeCurrentPrediction = canada?.current ? stationPredictionAt(canada.current, stationTimeIso) : undefined
  const currentStationSummary = canada?.current
    ? `${canada.current.stationName} ${activeCurrentPrediction?.value?.toFixed(1) ?? canada.current.observed?.value?.toFixed(1) ?? '--'} kt`
    : '无附近潮流站'
  const nearbyCurrentStations = canada?.currentStations ?? []
  return (
    <div className="panel detail-panel">
      <div className="detail-top">
        <div>
          <p className="eyebrow">真实 API 点预报</p>
          <h2>{forecast.name}</h2>
        </div>
        <div className={`score-pill ${toneClass(scoreTone(forecast.score))}`}><strong>{forecast.score}</strong><span>{scoreLabel(forecast.score)}</span></div>
      </div>
      <div className="stats-grid">
        <StatCard icon={Wind} label="风" value={`${forecast.weather.windKts} 节`} detail={windDirectionDetail(forecast.weather.windDirDeg)} tone={windTone(forecast.weather.windKts)} />
        <StatCard icon={Waves} label="浪" value={`${formatMeters(forecast.marine.waveM)} 米`} detail={`${forecast.marine.wavePeriodS} 秒周期`} tone={waveTone(forecast.marine.waveM)} />
        <StatCard icon={Gauge} label="海流" value={`${forecast.water.currentKts} 节`} detail={`${forecast.water.currentDirDeg} 度 / ${tideName(forecast.water.tide)}`} tone={currentTone(forecast.water.currentKts)} />
        <StatCard icon={ThermometerSun} label="水温" value={`${forecast.water.sstC} C`} detail={forecast.water.clarity} tone={sstTone(forecast.water.sstC)} />
      </div>
      {panel === 'forecast' && (
        <div className="workbench-panel point-panel">
          <div className="current-row">
            <CurrentArrow degrees={forecast.water.currentDirDeg} />
            <span>{forecast.lat.toFixed(3)}, {forecast.lng.toFixed(3)} · {forecast.weather.condition} · 气压 {forecast.marine.pressureHpa} hPa · 降水 {forecast.marine.precipMm} mm · {forecast.fish.tactic}</span>
          </div>
          <div className="analysis-strip">
            {breakdown.slice(0, 4).map((item) => (
              <div key={item.label}>
                <strong>{item.label}</strong>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {panel === 'stations' && (
        <div className="workbench-panel station-workbench">
          <div className="station-summary">
            <div><strong>水位 / 潮汐</strong><span>{waterLevelSummary}</span></div>
            <div><strong>潮流站</strong><span>{currentStationSummary}</span></div>
          </div>
          <CurrentStationDetail
            station={activeStation}
            stationTimeIso={stationTimeIso}
            minuteOffset={stationMinuteOffset}
            minuteMax={stationMinuteMax}
            onMinuteChange={onStationMinuteChange}
          />
          <div className="station-grid">
            {canada?.waterLevel && (
              <div className="station-card">
                <span>水位 / 潮汐</span>
                <strong>{canada.waterLevel.stationName}</strong>
                <small>{canada.waterLevel.stationCode} · {Math.round(canada.waterLevel.distanceKm)} km</small>
                <p>观测：{canada.waterLevel.observed?.value?.toFixed(2) ?? '—'} m · {formatStationTime(canada.waterLevel.observed?.time)} · {qcName(canada.waterLevel.observed?.qcFlagCode)}</p>
                <p>预测：{canada.waterLevel.prediction?.value?.toFixed(2) ?? '—'} m · {formatStationTime(canada.waterLevel.prediction?.time)} · {qcName(canada.waterLevel.prediction?.qcFlagCode)}</p>
              </div>
            )}
            {canada?.current && (
              <div className="station-card">
                <span>最近潮流站</span>
                <strong>{canada.current.stationName}</strong>
                <small>{canada.current.stationCode} · {Math.round(canada.current.distanceKm)} km</small>
                <p>观测：{canada.current.observed?.value?.toFixed(1) ?? '—'} kt · {canada.current.observed?.directionDeg?.toFixed(0) ?? '—'}° · {formatStationTime(canada.current.observed?.time)}</p>
                <p>当前时间预测：{activeCurrentPrediction?.value?.toFixed(1) ?? '—'} kt · {activeCurrentPrediction?.directionDeg?.toFixed(0) ?? '—'}° · {formatStationTime(activeCurrentPrediction?.time)}</p>
              </div>
            )}
          </div>
          <div className="station-list">
            {nearbyCurrentStations.map((station) => {
              const prediction = stationPredictionAt(station, stationTimeIso)
              return (
                <button key={station.stationCode} onClick={() => {
                  onSelectStation?.(station)
                  onFocusStation?.(station)
                }}>
                  <span>{station.stationName}</span>
                  <strong>{prediction?.value?.toFixed(1) ?? '—'} kt</strong>
                  <small>{prediction?.directionDeg?.toFixed(0) ?? '—'}° · {Math.round(station.distanceKm)} km · {stationPredictionLabel(prediction?.time)}</small>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {panel === 'trust' && (
        <div className="workbench-panel trust-panel">
        <div className="trust-summary">
          <strong>{sourceStatusText}</strong>
          <span>免费 API 聚合结果；模型海流、站点潮流、水位潮汐按来源分开判断。</span>
        </div>
        <div className="current-row">
          <CurrentArrow degrees={forecast.water.currentDirDeg} />
          <span>{forecast.lat.toFixed(3)}, {forecast.lng.toFixed(3)} · {forecast.weather.condition} · 气压 {forecast.marine.pressureHpa} hPa · 降水 {forecast.marine.precipMm} mm · {forecast.fish.tactic}</span>
        </div>
        <div className="accuracy-warning">
          {isLoading ? '正在请求真实天气、海洋、空气质量、NOAA 与 NWS 数据...' : error ? `接口错误：${error}` : '免费 API 已实时聚合；模型和站点数据均非航海保证，出海前仍需核对官方海况、潮汐、VHF 和当地法规。'}
        </div>
        <div className="api-source-strip">
          {apiSources.map((source) => (
            <span className={`source-${source.status}`} key={source.name} title={source.detail}>
              {source.name}
            </span>
          ))}
        </div>
        <div className="source-grid">
          {apiSources.map((source) => (
            <div className={`source-card source-${source.status}`} key={`${source.name}-card`}>
              <strong>{source.name}</strong>
              <span>{source.status}</span>
              <p>{source.detail}</p>
            </div>
          ))}
        </div>
        </div>
      )}
      <div className="analysis-list">
        <div className="mini-title"><Gauge size={18} /><strong>点击点详情</strong></div>
        {breakdown.map((item) => (
          <div className="analysis-row wide" key={item.label}>
            <div><strong>{item.label}</strong><p>{item.note}</p></div>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
      <div className="timeline">
        <div className="mini-title"><AreaChart size={18} /><strong>分时预报</strong></div>
        {forecast.timeline.map((slot) => (
          <div className="timeline-row forecast" key={slot.time}>
            <span>{slot.time}</span>
            <meter min="0" max="100" value={slot.bite} />
            <strong>{slot.bite}</strong>
            <small>{slot.windKts} 节风 / {formatMeters(slot.waveM)} 米浪 / {slot.currentKts} 节流 / 潮高 {slot.tideHeightM} 米</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function Dashboard({ selected, setSelected }: { selected: ForecastGridCell; setSelected: (forecast: ForecastGridCell) => void }) {
  return (
    <MapView selected={selected} setSelected={setSelected} />
  )
}

function RulesPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="区域规则" eyebrow="PFMA 与鱼种限制检查" icon={Anchor}>
      <div className="table-panel panel">
        <div className="table-grid table-head"><span>区域</span><span>鱼种</span><span>状态</span><span>摘要</span></div>
        {data.rules.map((rule) => (
          <div className="table-grid" key={rule.id}>
            <strong>{rule.area}</strong><span>{rule.species}</span><span className={`status ${rule.status}`}>{statusName(rule.status)}</span><span>{rule.summary}</span>
          </div>
        ))}
      </div>
    </PageScaffold>
  )
}

function WarningsPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="预警中心" eyebrow="天气、贝类污染与航线风险" icon={Bell}>
      <div className="card-list">
        {data.warnings.features.map((feature) => {
          const props = feature.properties as WarningFeatureProperties
          return (
            <article className="panel warning-card" key={props.id}>
              <div className={`severity ${props.severity}`}><AlertTriangle size={18} />{statusName(props.severity)}</div>
              <h2>{props.title}</h2><p>{props.details}</p><small>更新时间 {formatDate(props.updatedAt)}</small>
            </article>
          )
        })}
      </div>
    </PageScaffold>
  )
}

function BluewaterPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="蓝水与水温" eyebrow="温度断层、水色与外海信号" icon={Waves}>
      <div className="bluewater-grid">
        {data.bluewater.map((cell) => (
          <article className="panel water-card" key={cell.id}>
            <div className="water-swatch" />
            <div><h2>{cell.zone}</h2><p>{cell.note}</p><div className="tag-row"><span>{cell.sstC} C</span><span>{cell.breakStrength} 断层</span><span>{cell.color}</span></div></div>
          </article>
        ))}
      </div>
    </PageScaffold>
  )
}

function AlbacorePage({ data }: { data: AppData }) {
  const ranked = [...data.albacore.features].sort((a, b) => (b.properties as AlbacoreFeatureProperties).score - (a.properties as AlbacoreFeatureProperties).score)
  return (
    <PageScaffold title="长鳍金枪鱼" eyebrow="外海金枪鱼搜索评分" icon={Fish}>
      <div className="card-list">
        {ranked.map((feature, index) => {
          const props = feature.properties as AlbacoreFeatureProperties
          return (
            <article className="panel albacore-card" key={props.id}>
              <div className="rank"><TunaIcon /><strong>#{index + 1}</strong></div>
              <div><h2>{props.name}</h2><p>{props.note}</p><div className="tag-row"><span>评分 {props.score}</span><span>{props.tempC} C</span><span>{props.travelNm} 海里</span><span>叶绿素 {props.chlorophyll}</span></div></div>
            </article>
          )
        })}
      </div>
    </PageScaffold>
  )
}

function SpotsPage({ spots, setSpots, selected }: { spots: UserSpot[]; setSpots: (spots: UserSpot[]) => void; selected: ForecastGridCell }) {
  const [name, setName] = useState('')
  function addSpot() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSpots([{ id: crypto.randomUUID(), name: trimmed, lat: selected.lat, lng: selected.lng, target: selected.fish.target, notes: `从 ${selected.name} 保存`, createdAt: new Date().toISOString() }, ...spots])
    setName('')
  }
  return (
    <PageScaffold title="我的钓点" eyebrow="点击任意海域后可保存成个人钓点" icon={MapPin}>
      <div className="panel form-panel">
        <div><h2>保存当前点击位置</h2><p>{selected.name}，坐标 {selected.lat.toFixed(3)}, {selected.lng.toFixed(3)}</p></div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入钓点名称" />
        <button className="primary-button" onClick={addSpot}><Plus size={18} />添加钓点</button>
      </div>
      <div className="card-list">
        {spots.map((spot) => (
          <article className="panel spot-card" key={spot.id}>
            <MapPin size={18} /><div><h2>{spot.name}</h2><p>{spot.notes}；目标鱼 {spot.target}</p><small>{spot.lat.toFixed(3)}, {spot.lng.toFixed(3)}</small></div>
            <button className="icon-button" title="删除钓点" onClick={() => setSpots(spots.filter((item) => item.id !== spot.id))}><Trash2 size={17} /></button>
          </article>
        ))}
      </div>
    </PageScaffold>
  )
}

function RoutePage({ data }: { data: AppData }) {
  const [from, setFrom] = useState(data.forecasts[0].id)
  const [to, setTo] = useState(data.forecasts[1].id)
  const start = data.forecasts.find((item) => item.id === from) ?? data.forecasts[0]
  const end = data.forecasts.find((item) => item.id === to) ?? data.forecasts[1]
  const avgWind = Math.round((start.weather.windKts + end.weather.windKts) / 2)
  const avgCurrent = ((start.water.currentKts + end.water.currentKts) / 2).toFixed(1)
  const routeScore = Math.max(24, Math.round((start.score + end.score) / 2 - avgWind * 1.1))
  return (
    <PageScaffold title="航线快检" eyebrow="按起点终点估算风浪水流风险" icon={Route}>
      <div className="panel route-panel">
        <label>起点<select value={from} onChange={(event) => setFrom(event.target.value)}>{data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}</select></label>
        <ChevronRight size={20} />
        <label>终点<select value={to} onChange={(event) => setTo(event.target.value)}>{data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}</select></label>
      </div>
      <div className="panel score-panel">
        <Gauge size={26} />
        <div><p className="eyebrow">航线评分</p><h2>{routeScore} / 100</h2><p>平均风速 {avgWind} 节，平均水流 {avgCurrent} 节。建议优先上午出发，下午风浪建立前回港。</p><div className="route-result-grid"><span>操船压力：{avgWind >= 13 ? '偏高' : '可控'}</span><span>控线难度：{Number(avgCurrent) >= 1.8 ? '较难' : '中等'}</span><span>回程提醒：预留逆风逆流时间</span></div></div>
      </div>
    </PageScaffold>
  )
}

function TripPage({ selected, warnings }: { selected: ForecastGridCell; warnings: AppData['warnings'] }) {
  return (
    <PageScaffold title="出海简报" eyebrow="一屏完成出发前 go / no-go 判断" icon={ShipWheel}>
      <div className="brief-grid">
        <div className="panel brief-main">
          <p className="eyebrow">当前点击位置</p><h2>{selected.name}</h2><p>{selected.fish.tactic}</p>
          <div className="tag-row"><span>{selected.fish.biteWindow}</span><span>{selected.weather.windKts} 节 {windDirectionName(selected.weather.windDir)}</span><span>{selected.marine.waveM} 米浪</span><span>{selected.water.currentKts} 节流</span></div>
          <div className="brief-section"><strong>今天的关键判断</strong><p>{weatherInterpretation(selected)} {currentInterpretation(selected)}</p></div>
        </div>
        <div className="panel checklist"><h2>出发前检查</h2>{['官方法规已核对', '海上天气已核对', '油量和返程余量', 'VHF 与救生装备', '已告知岸上联系人'].map((item) => <label key={item}><input type="checkbox" />{item}</label>)}</div>
        <div className="panel"><h2>预警</h2><p>当前样例海域内有 {warnings.features.length} 个预警图层。真实出海前必须以官方发布为准。</p></div>
      </div>
    </PageScaffold>
  )
}

function SettingsPage() {
  return (
    <PageScaffold title="设置" eyebrow="单位、显示与离线能力" icon={Settings}>
      <div className="settings-grid">
        {['风速使用节', '浪高使用米', '温度使用摄氏度', '距离使用海里', 'Hash 路由适配 GitHub Pages', 'PWA 离线缓存基础数据'].map((item) => (
          <div className="panel setting-row" key={item}><span>{item}</span><input type="checkbox" defaultChecked /></div>
        ))}
      </div>
    </PageScaffold>
  )
}

function DataStatusPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="数据状态" eyebrow="静态 JSON 构建清单与 T01-T22" icon={Database}>
      <div className="panel data-panel">
        <div className="data-build"><CheckCircle2 size={24} /><div><h2>{data.manifest.build}</h2><p>{data.manifest.coverage}</p><small>生成时间 {formatDate(data.manifest.generatedAt)}</small></div></div>
        {data.manifest.sources.map((source) => (
          <div className="source-row" key={source.name}><strong>{source.name}</strong><span>{source.owner}</span><span className={`status ${source.status}`}>{statusName(source.status)}</span><small>{source.freshness}</small></div>
        ))}
      </div>
      <div className="task-grid">
        {data.tasks.map((task) => (
          <article className="panel task-card" key={task.id}>
            <div><strong>{task.id}</strong><span className={`status ${task.status}`}>{statusName(task.status)}</span></div>
            <h2>{task.title}</h2><p>{task.detail}</p>
          </article>
        ))}
      </div>
    </PageScaffold>
  )
}

function PageScaffold({ title, eyebrow, icon: Icon, children }: { title: string; eyebrow: string; icon: typeof Anchor; children: React.ReactNode }) {
  return (
    <section className="content-page">
      <header className="page-header">
        <div className="page-icon"><Icon size={24} /></div>
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
      </header>
      {children}
    </section>
  )
}

function App() {
  const [page, setPage] = useState<PageId>(getInitialPage)
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ForecastGridCell | null>(null)
  const [spots, setSpotsState] = useState<UserSpot[]>([])

  useEffect(() => {
    const handleHash = () => setPage(getInitialPage())
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  useEffect(() => {
    Promise.all([loadAppData(), fetchRealForecast(defaultCenter[0], defaultCenter[1])])
      .then(([loaded, forecast]) => {
        setData(loaded)
        setSelected(forecast)
      })
      .catch((reason: Error) => setError(reason.message))
    loadStoredSpots().then(setSpotsState).catch(() => setSpotsState([]))
  }, [])

  useEffect(() => {
    saveStoredSpots(spots).catch(() => undefined)
  }, [spots])

  if (error) {
    return <div className="loading-state"><AlertTriangle size={28} /><h1>数据加载失败</h1><p>{error}</p></div>
  }
  if (!data || !selected) {
    return <div className="loading-state"><RefreshCcw size={28} className="spin" /><h1>正在加载真实免费 API 海况</h1></div>
  }

  return (
    <Shell page={page} setPage={setPage}>
      {page === 'map' && <Dashboard selected={selected} setSelected={setSelected} />}
      {page === 'rules' && <RulesPage data={data} />}
      {page === 'warnings' && <WarningsPage data={data} />}
      {page === 'bluewater' && <BluewaterPage data={data} />}
      {page === 'albacore' && <AlbacorePage data={data} />}
      {page === 'spots' && <SpotsPage spots={spots} setSpots={setSpotsState} selected={selected} />}
      {page === 'route' && <RoutePage data={data} />}
      {page === 'trip' && <TripPage selected={selected} warnings={data.warnings} />}
      {page === 'settings' && <SettingsPage />}
      {page === 'data-status' && <DataStatusPage data={data} />}
    </Shell>
  )
}

export default App
