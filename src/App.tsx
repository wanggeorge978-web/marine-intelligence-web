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
  { id: 'map', label: 'Map Intelligence', icon: Map },
  { id: 'rules', label: 'Area Rules', icon: Anchor },
  { id: 'warnings', label: 'Warning Center', icon: Bell },
  { id: 'bluewater', label: 'Bluewater & SST', icon: Waves },
  { id: 'albacore', label: 'Albacore Explorer', icon: Fish },
  { id: 'spots', label: 'My Spots', icon: MapPin },
  { id: 'route', label: 'Route Quick Check', icon: Route },
  { id: 'trip', label: 'Trip Brief', icon: ShipWheel },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'data-status', label: 'Data Status', icon: Database },
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

function scoreLabel(score: number) {
  if (score >= 82) return 'Prime'
  if (score >= 70) return 'Good'
  if (score >= 55) return 'Workable'
  return 'Poor'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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
            <strong>Marine Intelligence</strong>
            <small>Fishing weather and current MVP</small>
          </span>
        </a>
        <nav className="nav-list" aria-label="Main">
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
          <span>Demo intelligence only. Not for navigation. Verify official sources before departure.</span>
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
  const [layers, setLayers] = useState({
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
            <p className="eyebrow">Live-style static intelligence</p>
            <h1>Map Intelligence</h1>
          </div>
          <button className="icon-button" title="Recenter map" onClick={() => mapRef.current?.flyTo({ center: defaultCenter, zoom: 7.5 })}>
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
            <strong>Layers</strong>
          </div>
          {Object.entries(layers).map(([key, value]) => (
            <label className="switch-row" key={key}>
              <span>{key}</span>
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
        <StatCard icon={Wind} label="Wind" value={`${forecast.weather.windKts} kt`} detail={forecast.weather.windDir} />
        <StatCard icon={Waves} label="Current" value={`${forecast.water.currentKts} kt`} detail={forecast.water.tide} />
        <StatCard icon={ThermometerSun} label="SST" value={`${forecast.water.sstC} C`} detail={forecast.water.clarity} />
        <StatCard icon={CloudSun} label="Weather" value={forecast.weather.condition} detail={forecast.weather.pressureTrend} />
      </div>

      <div className="current-row">
        <CurrentArrow degrees={forecast.water.currentDirDeg} />
        <span>Current set {forecast.water.currentDirDeg} deg, swell {forecast.water.swellM} m at {forecast.water.swellPeriodS}s.</span>
      </div>

      <div className="callout">
        <Fish size={18} />
        <div>
          <strong>{forecast.fish.target}</strong>
          <span>{forecast.fish.tactic}</span>
        </div>
      </div>

      <div className="timeline">
        <div className="mini-title">
          <AreaChart size={18} />
          <strong>Bite window timeline</strong>
        </div>
        {forecast.timeline.map((slot) => (
          <div className="timeline-row" key={slot.time}>
            <span>{slot.time}</span>
            <meter min="0" max="100" value={slot.bite} />
            <strong>{slot.bite}</strong>
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
          <p className="eyebrow">Static MVP build</p>
          <h1>Fishing weather, current, rules, and offshore signals in one fast page.</h1>
        </div>
        <div className="hero-metrics">
          <div><strong>{data.forecasts.length}</strong><span>forecast points</span></div>
          <div><strong>{data.rules.length}</strong><span>rule records</span></div>
          <div><strong>{data.warnings.features.length}</strong><span>warnings</span></div>
        </div>
      </section>

      <MapView data={data} selected={selected} setSelected={setSelected} />
    </div>
  )
}

function RulesPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="Area Rules" eyebrow="PFMA and species checks" icon={Anchor}>
      <div className="table-panel panel">
        <div className="table-grid table-head">
          <span>Area</span><span>Species</span><span>Status</span><span>Summary</span>
        </div>
        {data.rules.map((rule) => (
          <div className="table-grid" key={rule.id}>
            <strong>{rule.area}</strong>
            <span>{rule.species}</span>
            <span className={`status ${rule.status}`}>{rule.status}</span>
            <span>{rule.summary}</span>
          </div>
        ))}
      </div>
    </PageScaffold>
  )
}

function WarningsPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="Warning Center" eyebrow="Weather, shellfish, and route risk" icon={Bell}>
      <div className="card-list">
        {data.warnings.features.map((feature) => {
          const props = feature.properties as WarningFeatureProperties
          return (
            <article className="panel warning-card" key={props.id}>
              <div className={`severity ${props.severity}`}><AlertTriangle size={18} />{props.severity}</div>
              <h2>{props.title}</h2>
              <p>{props.details}</p>
              <small>Updated {formatDate(props.updatedAt)}</small>
            </article>
          )
        })}
      </div>
    </PageScaffold>
  )
}

function BluewaterPage({ data }: { data: AppData }) {
  return (
    <PageScaffold title="Bluewater & SST" eyebrow="Temperature breaks and water color" icon={Waves}>
      <div className="bluewater-grid">
        {data.bluewater.map((cell) => (
          <article className="panel water-card" key={cell.id}>
            <div className="water-swatch" />
            <div>
              <h2>{cell.zone}</h2>
              <p>{cell.note}</p>
              <div className="tag-row">
                <span>{cell.sstC} C</span>
                <span>{cell.breakStrength} break</span>
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
    <PageScaffold title="Albacore Explorer" eyebrow="Offshore tuna score" icon={Fish}>
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
                  <span>Score {props.score}</span>
                  <span>{props.tempC} C</span>
                  <span>{props.travelNm} nm</span>
                  <span>Chl {props.chlorophyll}</span>
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
        notes: `Saved from ${selected.name}`,
        createdAt: new Date().toISOString(),
      },
      ...spots,
    ])
    setName('')
  }

  return (
    <PageScaffold title="My Spots" eyebrow="LocalStorage plus IndexedDB" icon={MapPin}>
      <div className="panel form-panel">
        <div>
          <h2>Save current point</h2>
          <p>{selected.name} at {selected.lat.toFixed(2)}, {selected.lng.toFixed(2)}</p>
        </div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Spot name" />
        <button className="primary-button" onClick={addSpot}><Plus size={18} />Add spot</button>
      </div>

      <div className="card-list">
        {spots.map((spot) => (
          <article className="panel spot-card" key={spot.id}>
            <MapPin size={18} />
            <div>
              <h2>{spot.name}</h2>
              <p>{spot.notes}; target {spot.target}</p>
              <small>{spot.lat.toFixed(3)}, {spot.lng.toFixed(3)}</small>
            </div>
            <button
              className="icon-button"
              title="Delete spot"
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
    <PageScaffold title="Route Quick Check" eyebrow="Simple MVP route risk" icon={Route}>
      <div className="panel route-panel">
        <label>
          From
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}
          </select>
        </label>
        <ChevronRight size={20} />
        <label>
          To
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            {data.forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.name}</option>)}
          </select>
        </label>
      </div>
      <div className="panel score-panel">
        <Gauge size={26} />
        <div>
          <p className="eyebrow">Route score</p>
          <h2>{routeScore} / 100</h2>
          <p>Average wind {avgWind} kt, current {avgCurrent} kt. Best departure bias: morning before wind build.</p>
        </div>
      </div>
    </PageScaffold>
  )
}

function TripPage({ selected, warnings }: { selected: MarinePointForecast; warnings: AppData['warnings'] }) {
  return (
    <PageScaffold title="Trip Brief" eyebrow="One-screen go/no-go summary" icon={ShipWheel}>
      <div className="brief-grid">
        <div className="panel brief-main">
          <p className="eyebrow">Selected point</p>
          <h2>{selected.name}</h2>
          <p>{selected.fish.tactic}</p>
          <div className="tag-row">
            <span>{selected.fish.biteWindow}</span>
            <span>{selected.weather.windKts} kt {selected.weather.windDir}</span>
            <span>{selected.water.swellM} m swell</span>
          </div>
        </div>
        <div className="panel checklist">
          <h2>Pre-departure checks</h2>
          {['Official rules', 'Marine forecast', 'Fuel range', 'VHF and safety kit', 'Float plan'].map((item) => (
            <label key={item}><input type="checkbox" />{item}</label>
          ))}
        </div>
        <div className="panel">
          <h2>Warnings</h2>
          <p>{warnings.features.length} demo warning layers intersect the sample operating region.</p>
        </div>
      </div>
    </PageScaffold>
  )
}

function SettingsPage() {
  return (
    <PageScaffold title="Settings" eyebrow="Units and display" icon={Settings}>
      <div className="settings-grid">
        {['Knots', 'Celsius', 'Nautical miles', 'Hash routing', 'Offline spots'].map((item) => (
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
    <PageScaffold title="Data Status" eyebrow="Static JSON build manifest" icon={Database}>
      <div className="panel data-panel">
        <div className="data-build">
          <CheckCircle2 size={24} />
          <div>
            <h2>{data.manifest.build}</h2>
            <p>{data.manifest.coverage}</p>
            <small>Generated {formatDate(data.manifest.generatedAt)}</small>
          </div>
        </div>
        {data.manifest.sources.map((source) => (
          <div className="source-row" key={source.name}>
            <strong>{source.name}</strong>
            <span>{source.owner}</span>
            <span className={`status ${source.status}`}>{source.status}</span>
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
        <h1>Data load failed</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!data || !selected) {
    return (
      <div className="loading-state">
        <RefreshCcw size={28} className="spin" />
        <h1>Loading marine intelligence</h1>
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
