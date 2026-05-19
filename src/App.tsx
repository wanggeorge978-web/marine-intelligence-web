import { useEffect, useMemo, useRef, useState } from 'react'
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
    demo: '演示',
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

function overlayValue(cell: ForecastGridCell, mode: OverlayMode) {
  if (mode === 'weather') return cell.score
  if (mode === 'wind') return cell.weather.windKts
  if (mode === 'waves') return cell.marine.waveM
  if (mode === 'current') return cell.water.currentKts
  if (mode === 'tide') return cell.marine.tideHeightM
  return cell.water.sstC
}

function overlayLabel(cell: ForecastGridCell, mode: OverlayMode) {
  const modeInfo = overlayModes.find((item) => item.id === mode)
  const unit = modeInfo?.unit ?? ''
  const value = overlayValue(cell, mode)
  if (mode === 'weather') return `${Math.round(value)} 分`
  if (mode === 'tide') return `${value.toFixed(1)} ${unit}`
  return `${value.toFixed(1)} ${unit}`
}

function valueColorExpression(mode: OverlayMode): maplibregl.ExpressionSpecification {
  if (mode === 'weather') {
    return ['interpolate', ['linear'], ['get', 'value'], 35, '#c94c4c', 60, '#f2b705', 82, '#14a098']
  }
  if (mode === 'wind') {
    return ['interpolate', ['linear'], ['get', 'value'], 4, '#d9f0a3', 12, '#fdae61', 22, '#d7191c']
  }
  if (mode === 'waves') {
    return ['interpolate', ['linear'], ['get', 'value'], 0.3, '#9bd7f0', 1.5, '#2b83ba', 3.5, '#542788']
  }
  if (mode === 'current') {
    return ['interpolate', ['linear'], ['get', 'value'], 0.2, '#c7eae5', 1.4, '#35978f', 3.0, '#01665e']
  }
  if (mode === 'tide') {
    return ['interpolate', ['linear'], ['get', 'value'], -1.2, '#2166ac', 0, '#f7f7f7', 1.2, '#b2182b']
  }
  return ['interpolate', ['linear'], ['get', 'value'], 10, '#2166ac', 13.5, '#1a9850', 16.5, '#fdae61']
}

function gridToGeoJson(grid: ForecastGridCell[], mode: OverlayMode): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: grid.map((cell) => ({
      type: 'Feature',
      properties: {
        id: cell.id,
        value: overlayValue(cell, mode),
        label: overlayLabel(cell, mode),
        score: cell.score,
      },
      geometry: { type: 'Point', coordinates: [cell.lng, cell.lat] },
    })),
  }
}

function distanceScore(cell: ForecastGridCell, lng: number, lat: number) {
  const dx = (cell.lng - lng) * Math.cos((lat * Math.PI) / 180)
  const dy = cell.lat - lat
  return dx * dx + dy * dy
}

function nearestCell(grid: ForecastGridCell[], lng: number, lat: number) {
  return grid.reduce((best, cell) => (distanceScore(cell, lng, lat) < distanceScore(best, lng, lat) ? cell : best), grid[0])
}

function sampledForecast(grid: ForecastGridCell[], lng: number, lat: number): ForecastGridCell {
  const ranked = [...grid].sort((a, b) => distanceScore(a, lng, lat) - distanceScore(b, lng, lat)).slice(0, 4)
  const weights = ranked.map((cell) => 1 / Math.max(0.0001, distanceScore(cell, lng, lat)))
  const total = weights.reduce((sum, value) => sum + value, 0)
  const avg = (getter: (cell: ForecastGridCell) => number) =>
    ranked.reduce((sum, cell, index) => sum + getter(cell) * weights[index], 0) / total
  const base = nearestCell(grid, lng, lat)
  const score = Math.round(avg((cell) => cell.score))
  const windKts = Number(avg((cell) => cell.weather.windKts).toFixed(1))
  const currentKts = Number(avg((cell) => cell.water.currentKts).toFixed(1))
  const waveM = Number(avg((cell) => cell.marine.waveM).toFixed(1))
  const sstC = Number(avg((cell) => cell.water.sstC).toFixed(1))
  const tideHeightM = Number(avg((cell) => cell.marine.tideHeightM).toFixed(2))

  return {
    ...base,
    id: `sample-${lng.toFixed(3)}-${lat.toFixed(3)}`,
    name: `点击位置 ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat,
    lng,
    score,
    weather: {
      ...base.weather,
      windKts,
      airTempC: Number(avg((cell) => cell.weather.airTempC).toFixed(1)),
    },
    water: {
      ...base.water,
      currentKts,
      swellM: Number(avg((cell) => cell.water.swellM).toFixed(1)),
      sstC,
    },
    marine: {
      ...base.marine,
      waveM,
      tideHeightM,
      pressureHpa: Number(avg((cell) => cell.marine.pressureHpa).toFixed(1)),
      visibilityKm: Number(avg((cell) => cell.marine.visibilityKm).toFixed(1)),
      precipMm: Number(avg((cell) => cell.marine.precipMm).toFixed(1)),
      salinityPsu: Number(avg((cell) => cell.marine.salinityPsu).toFixed(1)),
    },
    fish: {
      ...base.fish,
      tactic: '这是点击位置附近 4 个网格的近似采样。先看风浪和水流是否安全，再看潮汐、水温和鱼情窗口。',
    },
    timeline: base.timeline.map((slot, index) => ({
      ...slot,
      bite: Math.round(avg((cell) => cell.timeline[index]?.bite ?? slot.bite)),
      windKts: Number(avg((cell) => cell.timeline[index]?.windKts ?? windKts).toFixed(1)),
      currentKts: Number(avg((cell) => cell.timeline[index]?.currentKts ?? currentKts).toFixed(1)),
      waveM: Number(avg((cell) => cell.timeline[index]?.waveM ?? waveM).toFixed(1)),
      tideHeightM: Number(avg((cell) => cell.timeline[index]?.tideHeightM ?? tideHeightM).toFixed(2)),
    })),
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
          <span>当前为全区域演示网格，不是官方海事预报。真实出海前必须核对官方天气、潮汐、规则和船况。</span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}

function MapView({
  data,
  selected,
  setSelected,
}: {
  data: AppData
  selected: ForecastGridCell
  setSelected: (forecast: ForecastGridCell) => void
}) {
  const mapNode = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [mode, setMode] = useState<OverlayMode>('wind')
  const [showAreas, setShowAreas] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)
  const [showBluewater, setShowBluewater] = useState(true)
  const [searchText, setSearchText] = useState('')
  const gridGeojson = useMemo(() => gridToGeoJson(data.forecastGrid, mode), [data.forecastGrid, mode])
  const activeMode = overlayModes.find((item) => item.id === mode) ?? overlayModes[0]

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
      map.addSource('forecast-grid', { type: 'geojson', data: gridGeojson })
      map.addLayer({
        id: 'forecast-grid-circles',
        type: 'circle',
        source: 'forecast-grid',
        paint: {
          'circle-color': valueColorExpression(mode),
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 7, 9, 14],
          'circle-opacity': 0.74,
          'circle-stroke-width': 0.6,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'forecast-grid-labels',
        type: 'symbol',
        source: 'forecast-grid',
        minzoom: 8,
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': '#152024', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
      })

      map.addSource('pfma', { type: 'geojson', data: data.pfma })
      map.addLayer({ id: 'pfma-fill', type: 'fill', source: 'pfma', paint: { 'fill-color': '#4b9cd3', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'pfma-line', type: 'line', source: 'pfma', paint: { 'line-color': '#2364aa', 'line-width': 1.4, 'line-dasharray': [2, 2] } })

      map.addSource('warnings', { type: 'geojson', data: data.warnings })
      map.addLayer({ id: 'warnings-fill', type: 'fill', source: 'warnings', paint: { 'fill-color': '#e4572e', 'fill-opacity': 0.14 } })
      map.addLayer({ id: 'warnings-line', type: 'line', source: 'warnings', paint: { 'line-color': '#c92818', 'line-width': 2 } })

      map.addSource('albacore', { type: 'geojson', data: data.albacore })
      map.addLayer({
        id: 'albacore-circle',
        type: 'circle',
        source: 'albacore',
        paint: {
          'circle-color': '#f2b705',
          'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 60, 8, 90, 16],
          'circle-opacity': 0.86,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#34290a',
        },
      })

      map.on('click', (event) => {
        const forecast = sampledForecast(data.forecastGrid, event.lngLat.lng, event.lngLat.lat)
        setSelected(forecast)
      })
      map.on('mouseenter', 'forecast-grid-circles', () => {
        map.getCanvas().style.cursor = 'crosshair'
      })
      map.on('mouseleave', 'forecast-grid-circles', () => {
        map.getCanvas().style.cursor = ''
      })
    })

    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [data.albacore, data.forecastGrid, data.pfma, data.warnings, gridGeojson, mode, setSelected])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('forecast-grid') as maplibregl.GeoJSONSource | undefined
    if (!map || !source) return
    source.setData(gridGeojson)
    if (map.getLayer('forecast-grid-circles')) {
      map.setPaintProperty('forecast-grid-circles', 'circle-color', valueColorExpression(mode))
    }
  }, [gridGeojson, mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const setVisibility = (ids: string[], value: boolean) => {
      ids.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value ? 'visible' : 'none')
      })
    }
    setVisibility(['pfma-fill', 'pfma-line'], showAreas)
    setVisibility(['warnings-fill', 'warnings-line'], showWarnings)
    setVisibility(['albacore-circle'], showBluewater)
  }, [showAreas, showWarnings, showBluewater])

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
      const forecast = sampledForecast(data.forecastGrid, lng, lat)
      setSelected(forecast)
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
        <div><strong>{selected.marine.waveM}</strong><span>浪 m</span></div>
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

      <div className="windy-detail">
        <ForecastDetail forecast={selected} />
      </div>

      <div className="windy-layer-card">
        <div className="mini-title">
          <Layers size={18} />
          <strong>{activeMode.label}</strong>
        </div>
        <div className="legend-bar"><span>低</span><div /><span>高</span></div>
        <label className="switch-row"><span>PFMA</span><input type="checkbox" checked={showAreas} onChange={(event) => setShowAreas(event.target.checked)} /></label>
        <label className="switch-row"><span>预警</span><input type="checkbox" checked={showWarnings} onChange={(event) => setShowWarnings(event.target.checked)} /></label>
        <label className="switch-row"><span>蓝水</span><input type="checkbox" checked={showBluewater} onChange={(event) => setShowBluewater(event.target.checked)} /></label>
      </div>

      <div className="windy-timeline">
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
          <span className="row-label">流 kt</span>
          {selected.timeline.map((slot) => <em key={`cur-${slot.time}`}>{slot.currentKts}</em>)}
          <span className="row-label">潮 m</span>
          {selected.timeline.map((slot) => <em key={`tide-${slot.time}`}>{slot.tideHeightM}</em>)}
        </div>
      </div>
    </section>
  )
}

function ForecastDetail({ forecast }: { forecast: ForecastGridCell }) {
  const breakdown = [
    { label: '天气', value: `${forecast.weather.condition} / ${forecast.weather.airTempC} C`, note: `${pressureName(forecast.weather.pressureTrend)}，气压 ${forecast.marine.pressureHpa} hPa，降水 ${forecast.marine.precipMm} mm。` },
    { label: '风浪', value: `${forecast.weather.windKts} 节 / ${forecast.marine.waveM} 米`, note: weatherInterpretation(forecast) },
    { label: '水流', value: `${forecast.water.currentKts} 节`, note: currentInterpretation(forecast) },
    { label: '潮汐', value: `${tideName(forecast.water.tide)} ${forecast.marine.tideHeightM} 米`, note: `潮高为样例相对值，结合水流方向 ${forecast.water.currentDirDeg} 度判断漂移和控线。` },
    { label: '水温', value: `${forecast.water.sstC} C`, note: `${forecast.water.clarity}，盐度 ${forecast.marine.salinityPsu} PSU，能见度 ${forecast.marine.visibilityKm} km。` },
  ]
  return (
    <div className="panel detail-panel">
      <div className="detail-top">
        <div>
          <p className="eyebrow">{forecast.area}</p>
          <h2>{forecast.name}</h2>
        </div>
        <div className="score-pill"><strong>{forecast.score}</strong><span>{scoreLabel(forecast.score)}</span></div>
      </div>
      <div className="stats-grid">
        <StatCard icon={Wind} label="风" value={`${forecast.weather.windKts} 节`} detail={windDirectionName(forecast.weather.windDir)} />
        <StatCard icon={Waves} label="浪" value={`${forecast.marine.waveM} 米`} detail={`${forecast.marine.wavePeriodS} 秒周期`} />
        <StatCard icon={Gauge} label="流" value={`${forecast.water.currentKts} 节`} detail={tideName(forecast.water.tide)} />
        <StatCard icon={ThermometerSun} label="水温" value={`${forecast.water.sstC} C`} detail={forecast.water.clarity} />
      </div>
      <div className="current-row">
        <CurrentArrow degrees={forecast.water.currentDirDeg} />
        <span>水流方向 {forecast.water.currentDirDeg} 度，浪向 {forecast.marine.swellDirDeg} 度。{forecast.fish.tactic}</span>
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

function Dashboard({ data, selected, setSelected }: { data: AppData; selected: ForecastGridCell; setSelected: (forecast: ForecastGridCell) => void }) {
  return (
    <MapView data={data} selected={selected} setSelected={setSelected} />
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
    loadAppData()
      .then((loaded) => {
        setData(loaded)
        setSelected(sampledForecast(loaded.forecastGrid, defaultCenter[0], defaultCenter[1]))
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
    return <div className="loading-state"><RefreshCcw size={28} className="spin" /><h1>正在加载全区域海况网格</h1></div>
  }

  return (
    <Shell page={page} setPage={setPage}>
      {page === 'map' && <Dashboard data={data} selected={selected} setSelected={setSelected} />}
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
