import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gridPath = path.join(root, 'public', 'data', 'forecast-grid.json')
const outPath = path.join(root, 'public', 'data', 'depth-grid.json')
const source = 'CHS NONNA 100 WCS'

function mercatorMeters(lng, lat) {
  const x = (lng * 20037508.34) / 180
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * 20037508.34 / 180
  return { x, y }
}

async function fetchDepth(cell) {
  const { x, y } = mercatorMeters(cell.lng, cell.lat)
  const radiusM = 80
  const params = new URLSearchParams({
    service: 'WCS',
    version: '2.0.1',
    request: 'GetCoverage',
    coverageId: 'nonna__NONNA 100 Coverage',
    format: 'text/plain',
  })
  params.append('subset', `x(${x - radiusM},${x + radiusM})`)
  params.append('subset', `y(${y - radiusM},${y + radiusM})`)

  try {
    const response = await fetch(`https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs?${params.toString()}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    const valueLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^-?\d+(\.\d+)?([Ee][+-]?\d+)?$/.test(line))
      .at(-1)
    const rawElevationM = valueLine ? Number(valueLine) : Number.NaN
    if (!Number.isFinite(rawElevationM) || Math.abs(rawElevationM) > 1e20) {
      return { id: cell.id, lat: cell.lat, lng: cell.lng, status: 'nodata' }
    }
    return {
      id: cell.id,
      lat: cell.lat,
      lng: cell.lng,
      status: 'ok',
      depthM: Number((rawElevationM < 0 ? Math.abs(rawElevationM) : 0).toFixed(1)),
      rawElevationM: Number(rawElevationM.toFixed(2)),
    }
  } catch (error) {
    return { id: cell.id, lat: cell.lat, lng: cell.lng, status: 'error', message: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function main() {
  const grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'))
  const points = []
  const concurrency = 8
  let next = 0

  async function worker() {
    while (next < grid.length) {
      const index = next
      next += 1
      points[index] = await fetchDepth(grid[index])
      if ((index + 1) % 50 === 0) console.log(`sampled ${index + 1}/${grid.length}`)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  fs.writeFileSync(outPath, `${JSON.stringify({
    source,
    sourceUrl: 'https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs',
    resolutionM: 100,
    note: 'Static cache sampled from CHS NONNA WCS for app forecast grid. Non-navigation.',
    generatedAt: new Date().toISOString(),
    points,
  })}\n`)

  const ok = points.filter((point) => point.status === 'ok').length
  console.log(`wrote ${outPath}; ok=${ok}/${points.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
