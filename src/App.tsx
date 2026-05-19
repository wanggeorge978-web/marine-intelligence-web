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
  MarinePointForecast,
  PageId,
  UserSpot,
  WarningFeatureProperties,
} from './types'

const pages: Array<{
  id: PageId
  label: string
  icon: typeof Map
}> = [
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

const layerLabels: Record<keyof LayerState, string> = {
  forecasts: '钓点评分',
  warnings: '预警范围',
  pfma: 'PFMA 区域',
  albacore: '长鳍金枪鱼热区',
}

type LayerState = {
  forecasts: boolean
  warnings: boolean
  pfma: boolean
  albacore: boolean
}

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

function scoreLabel(score: number) {
  if (score >= 82) return '强烈推荐'
  if (score >= 70) return '可以出钓'
  if (score >= 55) return '勉强可钓'
  return '不建议'
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
  return {
    flood: '涨潮',
    ebb: '退潮',
    slack: '平潮',
  }[value]
}

function pressureName(value: MarinePointForecast['weather']['pressureTrend']) {
  return {
    rising: '气压上升',
    steady: '气压稳定',
    falling: '气压下降',
  }[value]
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
  }[value] ?? value
}

function currentInterpretation(forecast: MarinePointForecast) {
  if (forecast.water.currentKts >= 1.8) {
    return '水流偏强，鱼会更贴结构和流边，适合找断层、礁边、潮线；底钓和抛锚要保守。'
  }
  if (forecast.water.currentKts <= 0.8) {
    return '水流较缓，适合精细控线、轻铅慢拖，也适合检查蟹笼和近岸结构点。'
  }
  return '水流强度适中，能把饵鱼和味道带起来，是拖钓和漂流搜索比较舒服的窗口。'
}

function weatherInterpretation(forecast: MarinePointForecast) {
  if (forecast.weather.windKts >= 14) {
    return '风速已经接近影响舒适度的区间，下午外海会更颠，建议优先早出早回。'
  }
  if (forecast.weather.windKts <= 7) {
    return '风力较轻，操船和控线压力小，适合把窗口拉长一点观察水色和鸟况。'
  }
  return '风力中等，仍可作业，但要盯着风向和回港角度，避免返程顶风顶浪。'
}

function scoreBreakdown(forecast: MarinePointForecast) {
  const water = Math.round(40 - Math.abs(forecast.water.currentKts - 1.3) * 9)
  const weather = Math.round(30 - Math.max(0, forecast.weather.windKts - 6) * 1.2)
  const fish = Math.round(forecast.score - water - weather)
  return [
    { label: '水流/潮汐', value: Math.max(8, water), note: currentInterpretation(forecast) },
    { label: '风浪/气压', value: Math.max(8, weather), note: weatherInterpretation(forecast) },
    { label: '鱼情窗口', value: Math.max(8, fish), note: `目标鱼：${forecast.fish.target}；推荐窗口：${forecast.fish.biteWindow}` },
  ]
}

function CurrentArrow({ degrees }: { degrees: number }) {
  return (
    <svg
      className="line-icon current-arrow"
      viewBox="0 0 24 24"
      style={{ transform: `rotate(${degrees}deg)` }}
      aria-label="current direction"
    >
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

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Wind
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="stat-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function Shell({ page, setPage, children }: {
  page: PageId
  setPage: (page: PageId) => void
  children: React.ReactNode
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/map" onClick={() => setPage('map')}>
          <span className="brand-mark"><Waves size={22} /></span>
          <span>
            <strong>海钓智能助手</strong>
            <small>天气 水流 鱼情 规则</small>
          </span>
        </a>
        <nav className="nav-list" aria-label="主导航">
          {pages.map((item) => {
            const Icon = item.icon
            return (
              <a
                className={page === item.id ? 'active' : ''}
                href={`#/${item.id}`}
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>
        <div className="source-note">
          <AlertTriangle size={16} />
          <span>当前为演示数据，不可用于航海导航或法规判断。出海前必须核对官方天气、海况和 DFO 规则。</span>
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
  selected: MarinePointForecast
  setSelected: (forecast: MarinePointForecast) => void
}) {
  const mapNode = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [layers, setLayers] = useState<LayerState>({
    forecasts: true,
    warnings: true,
    pfma: true,
    albacore: true,
  })

  const forecastGeojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: data.forecasts.map((forecast) => ({
        type: 'Feature',
        properties: {
          id: forecast.id,
          name: forecast.name,
          score: forecast.score,
          current: forecast.water.currentKts,
        },
        geometry: { type: 'Point', coordinates: [forecast.lng, forecast.lat] },
      })),
    }),
    [data.forecasts],
  )

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapNode.current,
      style: mapStyle,
      center: defaultCenter,
      zoom: 7.5,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map

    map.on('load', () => {
      map.addSource('pfma', { type: 'geojson', data: data.pfma })
      map.addLayer({
        id: 'pfma-fill',
        type: 'fill',
        source: 'pfma',
        paint: { 'fill-color': '#4b9cd3', 'fill-opacity': 0.16 },
      })
      map.addLayer({
        id: 'pfma-line',
        type: 'line',
        source: 'pfma',
        paint: { 'line-color': '#2364aa', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      })

      map.addSource('warnings', { type: 'geojson', data: data.warnings })
      map.addLayer({
        id: 'warnings-fill',
        type: 'fill',
        source: 'warnings',
        paint: { 'fill-color': '#e4572e', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'warnings-line',
        type: 'line',
        source: 'warnings',
        paint: { 'line-color': '#c92818', 'line-width': 2 },
      })

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

      map.addSource('marine-points', { type: 'geojson', data: forecastGeojson })
      map.addLayer({
        id: 'marine-points-circle',
        type: 'circle',
        source: 'marine-points',
        paint: {
          'circle-color': ['step', ['get', 'score'], '#d64545', 65, '#f2a541', 78, '#20a39e'],
          'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 60, 11, 90, 18],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'marine-points-label',
        type: 'symbol',
        source: 'marine-points',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 1.55],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#152024', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      })

      map.on('click', 'marine-points-circle', (event) => {
        const id = event.features?.[0]?.properties?.id
        const forecast = data.forecasts.find((item) => item.id === id)
        if (forecast) setSelected(forecast)
      })

      map.on('mouseenter', 'marine-points-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'marine-points-circle', () => {
        map.getCanvas().style.cursor = ''
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [data.albacore, data.forecasts, data.pfma, data.warnings, forecastGeojson, setSelected])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.flyTo({ center: [selected.lng, selected.lat], zoom: 8.5, duration: 800 })
  }, [selected])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const visibility = (value: boolean) => (value ? 'visible' : 'none')
    ;['marine-points-circle', 'marine-points-label'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(layers.forecasts))
    })
    ;['warnings-fill', 'warnings-line'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(layers.warnings))
    })
    ;['pfma-fill', 'pfma-line'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(layers.pfma))
    })
    if (map.getLayer('albacore-circle')) {
      map.setLayoutProperty('albacore-circle', 'visibility', visibility(layers.albacore))
    }
  }, [layers])

  return (
    <section className="page-grid map-page">
      <div className="panel map-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">地图情报层</p>
            <h1>海况地图</h1>
          </div>
          <button className="icon-button" title="回到默认海域" onClick={() => mapRef.current?.flyTo({ center: defaultCenter, zoom: 7.5 })}>
            <LocateFixed size={18} />
          </button>
        </div>
        <div className="map-frame">
          <div ref={mapNode} className="map-canvas" />
        </div>
      </div>

      <aside className="side-stack">
        <div className="panel compact">
          <div className="mini-title">
            <Layers size={18} />
            <strong>图层</strong>
          </div>
          {Object.entries(layers).map(([key, value]) => (
            <label className="switch-row" key={key}>
              <span>{layerLabels[key as keyof LayerState]}</span>
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => setLayers((current) => ({ ...current, [key]: event.target.checked }))}
              />
            </label>
          ))}
        </div>

        <PointDetail forecast={selected} />
      </aside>
    </section>
  )
}

function PointDetail({ forecast }: { forecast: MarinePointForecast }) {
  const breakdown = scoreBreakdown(forecast)
  return (
    <div className="panel detail-panel">
      <div className="detail-top">
        <div>
          <p className="eyebrow">{forecast.area}</p>
          <h2>{forecast.name}</h2>
        </div>
        <div className="score-pill">
          <strong>{forecast.score}</strong>
          <span>{scoreLabel(forecast.score)}</span>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon={Wind} label="风" value={`${forecast.weather.windKts} 节`} detail={windDirectionName(forecast.weather.windDir)} />
        <StatCard icon={Waves} label="流" value={`${forecast.water.currentKts} 节`} detail={tideName(forecast.water.tide)} />
        <StatCard icon={ThermometerSun} label="水温" value={`${forecast.water.sstC} C`} detail={forecast.water.clarity} />
        <StatCard icon={CloudSun} label="天气" value={forecast.weather.condition} detail={pressureName(forecast.weather.pressureTrend)} />
      </div>

      <div className="current-row">
        <CurrentArrow degrees={forecast.water.currentDirDeg} />
        <span>
          水流方向 {forecast.water.currentDirDeg} 度，浪高 {forecast.water.swellM} 米，周期 {forecast.water.swellPeriodS} 秒。
          {currentInterpretation(forecast)}
        </span>
      </div>

      <div className="callout">
        <Fish size={18} />
        <div>
          <strong>{forecast.fish.target}</strong>
          <span>{forecast.fish.tactic}</span>
          <span>风险：{forecast.fish.risk}</span>
        </div>
      </div>

      <div className="analysis-list">
        <div className="mini-title">
          <Gauge size={18} />
          <strong>评分拆解</strong>
        </div>
        {breakdown.map((item) => (
          <div className="analysis-row" key={item.label}>
            <div>
              <strong>{item.label}</strong>
              <p>{item.note}</p>
            </div>
            <span>{item.value}</span>
          </div>
        ))}
      </div>

      <div className="timeline">
        <div className="mini-title">
          <AreaChart size={18} />
          <strong>咬口时间线</strong>
        </div>
        {forecast.timeline.map((slot) => (
          <div className="timeline-row" key={slot.time}>
            <span>{slot.time}</span>
            <meter min="0" max="100" value={slot.bite} />
            <strong>{slot.bite}</strong>
            <small>{slot.windKts} 节风 / {slot.currentKts} 节流</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function Dashboard({
  data,
  selected,
  setSelected,
}: {
  data: AppData
  selected: MarinePointForecast
  setSelected: (forecast: MarinePointForecast) => void
}) {
  return (
    <div className="dashboard">
      <section className="hero-band">
        <div>
          <p className="eyebrow">网页版第一阶段</p>
          <h1>把天气、风浪、水流、潮汐、鱼情和法规检查放到一张中文海钓工作台里。</h1>
        </div>
        <div className="hero-metrics">
          <div><strong>{data.forecasts.length}</strong><span>海况点</span></div>
          <div><strong>{data.rules.length}</strong><span>规则记录</span></div>
          <div><strong>{data.warnings.features.length}</strong><span>预警图层</span></div>
        </div>
      </section>

      <MapView data={data} selected={selected} setSelected={setSelected} />
    </div>
  )
}

function RulesPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="区域规则" eyebrow="PFMA 与鱼种限制检查" icon={Anchor}>
      <div className="table-panel panel">
        <div className="table-grid table-head">
          <span>区域</span><span>鱼种</span><span>状态</span><span>摘要</span>
        </div>
        {data.rules.map((rule) => (
          <div className="table-grid" key={rule.id}>
            <strong>{rule.area}</strong>
            <span>{rule.species}</span>
            <span className={`status ${rule.status}`}>{statusName(rule.status)}</span>
            <span>{rule.summary}</span>
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
              <h2>{props.title}</h2>
              <p>{props.details}</p>
              <small>更新时间 {formatDate(props.updatedAt)}</small>
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
            <div>
              <h2>{cell.zone}</h2>
              <p>{cell.note}</p>
              <div className="tag-row">
                <span>{cell.sstC} C</span>
                <span>{cell.breakStrength} 断层</span>
                <span>{cell.color}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </PageScaffold>
  )
}

function AlbacorePage({ data }: { data: AppData }) {
  const ranked = [...data.albacore.features].sort(
    (a, b) => (b.properties as AlbacoreFeatureProperties).score - (a.properties as AlbacoreFeatureProperties).score,
  )
  return (
    <PageScaffold title="长鳍金枪鱼" eyebrow="外海金枪鱼搜索评分" icon={Fish}>
      <div className="card-list">
        {ranked.map((feature, index) => {
          const props = feature.properties as AlbacoreFeatureProperties
          return (
            <article className="panel albacore-card" key={props.id}>
              <div className="rank"><TunaIcon /><strong>#{index + 1}</strong></div>
              <div>
                <h2>{props.name}</h2>
                <p>{props.note}</p>
                <div className="tag-row">
                  <span>评分 {props.score}</span>
                  <span>{props.tempC} C</span>
                  <span>{props.travelNm} 海里</span>
                  <span>叶绿素 {props.chlorophyll}</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </PageScaffold>
  )
}

function SpotsPage({
  spots,
  setSpots,
  selected,
}: {
  spots: UserSpot[]
  setSpots: (spots: UserSpot[]) => void
  selected: MarinePointForecast
}) {
  const [name, setName] = useState('')

  function addSpot() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSpots([
      {
        id: crypto.randomUUID(),
        name: trimmed,
        lat: selected.lat,
        lng: selected.lng,
        target: selected.fish.target,
        notes: `从 ${selected.name} 保存`,
        createdAt: new Date().toISOString(),
      },
      ...spots,
    ])
    setName('')
  }

  return (
    <PageScaffold title="我的钓点" eyebrow="本地保存：localStorage + IndexedDB" icon={MapPin}>
      <div className="panel form-panel">
        <div>
          <h2>保存当前选中的钓点</h2>
          <p>{selected.name}，坐标 {selected.lat.toFixed(2)}, {selected.lng.toFixed(2)}</p>
        </div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入钓点名称" />
        <button className="primary-button" onClick={addSpot}><Plus size={18} />添加钓点</button>
      </div>

      <div className="card-list">
        {spots.map((spot) => (
          <article className="panel spot-card" key={spot.id}>
            <MapPin size={18} />
            <div>
              <h2>{spot.name}</h2>
              <p>{spot.notes}；目标鱼 {spot.target}</p>
              <small>{spot.lat.toFixed(3)}, {spot.lng.toFixed(3)}</small>
            </div>
            <button
              className="icon-button"
              title="删除钓点"
              onClick={() => setSpots(spots.filter((item) => item.id !== spot.id))}
            >
              <Trash2 size={17} />
            </button>
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
        <label>
          起点
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}
          </select>
        </label>
        <ChevronRight size={20} />
        <label>
          终点
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            {data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}
          </select>
        </label>
      </div>
      <div className="panel score-panel">
        <Gauge size={26} />
        <div>
          <p className="eyebrow">航线评分</p>
          <h2>{routeScore} / 100</h2>
          <p>平均风速 {avgWind} 节，平均水流 {avgCurrent} 节。建议优先上午出发，下午风浪建立前回港。</p>
          <div className="route-result-grid">
            <span>操船压力：{avgWind >= 13 ? '偏高' : '可控'}</span>
            <span>控线难度：{Number(avgCurrent) >= 1.8 ? '较难' : '中等'}</span>
            <span>回程提醒：预留逆风逆流时间</span>
          </div>
        </div>
      </div>
    </PageScaffold>
  )
}

function TripPage({ selected, warnings }: { selected: MarinePointForecast; warnings: AppData['warnings'] }) {
  return (
    <PageScaffold title="出海简报" eyebrow="一屏完成出发前 go / no-go 判断" icon={ShipWheel}>
      <div className="brief-grid">
        <div className="panel brief-main">
          <p className="eyebrow">当前钓点</p>
          <h2>{selected.name}</h2>
          <p>{selected.fish.tactic}</p>
          <div className="tag-row">
            <span>{selected.fish.biteWindow}</span>
            <span>{selected.weather.windKts} 节 {windDirectionName(selected.weather.windDir)}</span>
            <span>{selected.water.swellM} 米浪</span>
          </div>
          <div className="brief-section">
            <strong>今天的关键判断</strong>
            <p>{weatherInterpretation(selected)} {currentInterpretation(selected)}</p>
          </div>
        </div>
        <div className="panel checklist">
          <h2>出发前检查</h2>
          {['官方法规已核对', '海上天气已核对', '油量和返程余量', 'VHF 与救生装备', '已告知岸上联系人'].map((item) => (
            <label key={item}><input type="checkbox" />{item}</label>
          ))}
        </div>
        <div className="panel">
          <h2>预警</h2>
          <p>当前样例海域内有 {warnings.features.length} 个预警图层。真实出海前必须以官方发布为准。</p>
        </div>
      </div>
    </PageScaffold>
  )
}

function SettingsPage() {
  return (
    <PageScaffold title="设置" eyebrow="单位、显示与离线能力" icon={Settings}>
      <div className="settings-grid">
        {['风速使用节', '温度使用摄氏度', '距离使用海里', 'Hash 路由适配 GitHub Pages', '离线保存钓点'].map((item) => (
          <div className="panel setting-row" key={item}>
            <span>{item}</span>
            <input type="checkbox" defaultChecked />
          </div>
        ))}
      </div>
    </PageScaffold>
  )
}

function DataStatusPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="数据状态" eyebrow="静态 JSON 构建清单" icon={Database}>
      <div className="panel data-panel">
        <div className="data-build">
          <CheckCircle2 size={24} />
          <div>
            <h2>{data.manifest.build}</h2>
            <p>{data.manifest.coverage}</p>
            <small>生成时间 {formatDate(data.manifest.generatedAt)}</small>
          </div>
        </div>
        {data.manifest.sources.map((source) => (
          <div className="source-row" key={source.name}>
            <strong>{source.name}</strong>
            <span>{source.owner}</span>
            <span className={`status ${source.status}`}>{statusName(source.status)}</span>
            <small>{source.freshness}</small>
          </div>
        ))}
      </div>
    </PageScaffold>
  )
}

function PageScaffold({
  title,
  eyebrow,
  icon: Icon,
  children,
}: {
  title: string
  eyebrow: string
  icon: typeof Anchor
  children: React.ReactNode
}) {
  return (
    <section className="content-page">
      <header className="page-header">
        <div className="page-icon"><Icon size={24} /></div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </header>
      {children}
    </section>
  )
}

function App() {
  const [page, setPage] = useState<PageId>(getInitialPage)
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('ucluelet-bank')
  const [spots, setSpotsState] = useState<UserSpot[]>([])

  useEffect(() => {
    const handleHash = () => setPage(getInitialPage())
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  useEffect(() => {
    loadAppData().then(setData).catch((reason: Error) => setError(reason.message))
    loadStoredSpots().then(setSpotsState).catch(() => setSpotsState([]))
  }, [])

  useEffect(() => {
    saveStoredSpots(spots).catch(() => undefined)
  }, [spots])

  const selected = useMemo(() => {
    return data?.forecasts.find((forecast) => forecast.id === selectedId) ?? data?.forecasts[0]
  }, [data, selectedId])

  function setSelected(forecast: MarinePointForecast) {
    setSelectedId(forecast.id)
  }

  if (error) {
    return (
      <div className="loading-state">
        <AlertTriangle size={28} />
        <h1>数据加载失败</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!data || !selected) {
    return (
      <div className="loading-state">
        <RefreshCcw size={28} className="spin" />
        <h1>正在加载海钓情报</h1>
      </div>
    )
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
