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
} from 'lucide-react'
import './App.css'
import { loadAppData } from './dataLoader'
import { loadStoredSpots, saveStoredSpots } from './storage'
import type {
  AlbacoreFeatureProperties,
  ApiSourceStatus,
  AppData,
  ForecastGridCell,
  MarinePointForecast,
  PageId,
  UserSpot,
  WarningFeatureProperties,
} from './types'

type OverlayMode = 'weather' | 'wind' | 'waves' | 'current' | 'tide' | 'sst'

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

function kmhToKnots(value?: number) {
  return Number(((value ?? 0) * 0.539957).toFixed(1))
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
  nwsAlerts?: Array<{ event?: string; severity?: string }>
}

let noaaWaterLevelStationsPromise: Promise<NoaaStation[]> | null = null
let noaaCurrentStationsPromise: Promise<NoaaStation[]> | null = null

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
  const [airQuality, noaaTide, noaaCurrent, nwsAlerts] = await Promise.allSettled([
    fetchOpenMeteoAirQuality(lat, lng),
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
  const waveM = Number((marine.current?.wave_height ?? 0).toFixed(1))
  const windKts = Number((weather.current?.wind_speed_10m ?? 0).toFixed(1))
  const seaLevel = Number((marine.current?.sea_level_height_msl ?? 0).toFixed(2))
  const bestCurrentKts = extras.noaaCurrent?.value ?? currentKts
  const bestCurrentDir = extras.noaaCurrent?.directionDeg ?? Math.round(marine.current?.ocean_current_direction ?? 0)
  const bestTideHeight = extras.noaaTide?.value ?? seaLevel
  const sst = Number((marine.current?.sea_surface_temperature ?? marine.hourly?.sea_surface_temperature?.[marineIndex] ?? 0).toFixed(1))
  const score = Math.max(20, Math.min(95, Math.round(92 - Math.max(0, windKts - 10) * 2.2 - Math.max(0, waveM - 1.2) * 10 - Math.max(0, bestCurrentKts - 1.8) * 8)))
  const timeline = Array.from({ length: 8 }, (_, itemIndex) => {
    const weatherHour = weatherIndex + itemIndex * 3
    const marineHour = marineIndex + itemIndex * 3
    const tWind = Number((weather.hourly?.wind_speed_10m?.[weatherHour] ?? windKts).toFixed(1))
    const tWave = Number((marine.hourly?.wave_height?.[marineHour] ?? waveM).toFixed(1))
    const tCurrent = kmhToKnots(marine.hourly?.ocean_current_velocity?.[marineHour])
    const tTide = Number((marine.hourly?.sea_level_height_msl?.[marineHour] ?? seaLevel).toFixed(2))
    return {
      time: (weather.hourly?.time?.[weatherHour] ?? marine.hourly?.time?.[marineHour] ?? '').slice(11, 16),
      bite: Math.max(5, Math.min(95, Math.round(score - Math.max(0, tWind - 12) * 2 - Math.max(0, tWave - 1.5) * 8))),
      windKts: tWind,
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
      windDir: directionNameFromDegrees(weather.current?.wind_direction_10m),
      pressureTrend: trendFromPressure(weather.hourly),
    },
    water: {
      currentKts: bestCurrentKts,
      currentDirDeg: bestCurrentDir,
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
      tactic: `此点已接入 Open-Meteo 天气/海洋/空气质量，NOAA CO-OPS 潮位/潮流站，以及 NWS 美国天气预警。${extras.noaaCurrent ? '海流优先使用附近 NOAA 潮流站预测。' : '海流当前使用 Open-Meteo 海洋模型。'}`,
      risk: '免费 API 有区域覆盖和频率限制；真实出海仍需核对官方海况、潮汐、VHF 和当地法规。',
    },
    timeline,
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

function StatCard({ icon: Icon, label, value, detail }: { icon: typeof Wind; label: string; value: string; detail: string }) {
  return (
    <div className="stat-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
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
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [mode, setMode] = useState<OverlayMode>('wind')
  const [searchText, setSearchText] = useState('')
  const [isLoadingPoint, setIsLoadingPoint] = useState(false)
  const [pointError, setPointError] = useState<string | null>(null)

  const loadPoint = useCallback(async (lng: number, lat: number) => {
    setPointError(null)
    setIsLoadingPoint(true)
    try {
      const forecast = await fetchRealForecast(lng, lat)
      setSelected(forecast)
    } catch (reason) {
      setPointError(reason instanceof Error ? reason.message : '真实预报接口请求失败')
    } finally {
      setIsLoadingPoint(false)
    }
  }, [setSelected])

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
      map.on('click', (event) => {
        void loadPoint(event.lngLat.lng, event.lngLat.lat)
      })
    })

    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [loadPoint])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#13272e' }).setLngLat([selected.lng, selected.lat]).addTo(map)
    } else {
      markerRef.current.setLngLat([selected.lng, selected.lat])
    }
  }, [selected])

  function searchLocation() {
    const parts = searchText
      .split(/[,\s]+/)
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value))
    if (parts.length >= 2) {
      const [lat, lng] = Math.abs(parts[0]) <= 90 ? [parts[0], parts[1]] : [parts[1], parts[0]]
      void loadPoint(lng, lat)
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 8.3, duration: 800 })
    }
  }

  return (
    <section className="windy-map-page">
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
        <div><strong>{selected.score}</strong><span>海钓评分</span></div>
        <div><strong>{selected.weather.windKts}</strong><span>风 kt</span></div>
        <div><strong>{selected.water.currentKts}</strong><span>海流 kt</span></div>
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

      <div className="windy-bottom-sheet">
        <ForecastDetail forecast={selected} isLoading={isLoadingPoint} error={pointError} />
        <div className="timeline-days">
          {['周二 19', '周三 20', '周四 21', '周五 22', '周六 23', '周日 24'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="meteo-grid">
          <span className="row-label">小时</span>
          {selected.timeline.map((slot) => <b key={`t-${slot.time}`}>{slot.time}</b>)}
          <span className="row-label">天气</span>
          {selected.timeline.map((slot) => <span key={`w-${slot.time}`}>☀</span>)}
          <span className="row-label">风 kt</span>
          {selected.timeline.map((slot) => <em key={`wind-${slot.time}`}>{slot.windKts}</em>)}
          <span className="row-label">浪 m</span>
          {selected.timeline.map((slot) => <em key={`wave-${slot.time}`}>{slot.waveM}</em>)}
          <span className="row-label">海流 kt</span>
          {selected.timeline.map((slot) => <em key={`cur-${slot.time}`}>{slot.currentKts}</em>)}
          <span className="row-label">海平面 m</span>
          {selected.timeline.map((slot) => <em key={`tide-${slot.time}`}>{slot.tideHeightM}</em>)}
        </div>
      </div>
    </section>
  )
}

function ForecastDetail({ forecast, isLoading, error }: { forecast: ForecastGridCell; isLoading?: boolean; error?: string | null }) {
  const breakdown = [
    { label: '天气', value: `${forecast.weather.condition} / ${forecast.weather.airTempC} C`, note: `${pressureName(forecast.weather.pressureTrend)}，气压 ${forecast.marine.pressureHpa} hPa，降水 ${forecast.marine.precipMm} mm。` },
    { label: '风浪', value: `${forecast.weather.windKts} 节 / ${forecast.marine.waveM} 米`, note: weatherInterpretation(forecast) },
    { label: '海流', value: `${forecast.water.currentKts} 节`, note: currentInterpretation(forecast) },
    { label: '海平面', value: `${tideName(forecast.water.tide)} ${forecast.marine.tideHeightM} 米`, note: `Open-Meteo 提供 sea_level_height_msl，可作为潮位趋势参考；水流方向 ${forecast.water.currentDirDeg} 度。` },
    { label: '水温', value: `${forecast.water.sstC} C`, note: `${forecast.water.clarity}。Open-Meteo Marine API 提供海表温度，不提供水色/能见度。` },
  ]
  const apiSources = forecast.apiSources ?? []
  return (
    <div className="panel detail-panel">
      <div className="detail-top">
        <div>
          <p className="eyebrow">真实 API 点预报</p>
          <h2>{forecast.name}</h2>
        </div>
        <div className="score-pill"><strong>{forecast.score}</strong><span>{scoreLabel(forecast.score)}</span></div>
      </div>
      <div className="stats-grid">
        <StatCard icon={Wind} label="风" value={`${forecast.weather.windKts} 节`} detail={windDirectionName(forecast.weather.windDir)} />
        <StatCard icon={Waves} label="浪" value={`${forecast.marine.waveM} 米`} detail={`${forecast.marine.wavePeriodS} 秒周期`} />
        <StatCard icon={Gauge} label="海流" value={`${forecast.water.currentKts} 节`} detail={`${forecast.water.currentDirDeg} 度 / ${tideName(forecast.water.tide)}`} />
        <StatCard icon={ThermometerSun} label="水温" value={`${forecast.water.sstC} C`} detail={forecast.water.clarity} />
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
            <small>{slot.windKts} 节风 / {slot.waveM} 米浪 / {slot.currentKts} 节流 / 潮高 {slot.tideHeightM} 米</small>
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
