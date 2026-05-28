import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const SERVICE = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/CSSP/CSSP_Base_Public/MapServer'
const BBOX = '-126.25,48.78,-124.72,49.38'
const OUTPUT = path.resolve('public/data/tofino-shellfish.geojson')

const SPECIES_FIELDS = [
  ['BUTTER_CLAM', 'Butter clam'],
  ['GEODUCK_CLAM', 'Geoduck'],
  ['HORSE_CLAM', 'Horse clam'],
  ['LITTLENECK_CLAM', 'Littleneck clam'],
  ['MANILA_CLAM', 'Manila clam'],
  ['NUTTALLS_COCKLE', "Nuttall's cockle"],
  ['PACIFIC_RAZOR_CLAM', 'Razor clam'],
  ['SOFTSHELL_CLAM', 'Softshell clam'],
  ['VARNISH_CLAM', 'Varnish clam'],
  ['BLUE_MUSSEL', 'Blue mussel'],
  ['CALIFORNIA_MUSSEL', 'California mussel'],
  ['PACIFIC_OYSTER', 'Pacific oyster'],
  ['PINK_SCALLOP', 'Pink scallop'],
  ['SPINY_SCALLOP', 'Spiny scallop'],
  ['WEATHERVANE_SCALLOP', 'Weathervane scallop'],
]

async function queryLayer(layer, offset = '0.00005') {
  const url = new URL(`${SERVICE}/${layer}/query`)
  url.searchParams.set('f', 'geojson')
  url.searchParams.set('where', '1=1')
  url.searchParams.set('outFields', '*')
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('geometry', BBOX)
  url.searchParams.set('geometryType', 'esriGeometryEnvelope')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('geometryPrecision', '5')
  url.searchParams.set('maxAllowableOffset', offset)
  url.searchParams.set('resultRecordCount', '2000')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Layer ${layer} request failed: ${response.status}`)
  const json = await response.json()
  if (json.error) throw new Error(`Layer ${layer} query failed: ${json.error.message}`)
  return json.features ?? []
}

function cleanupText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function speciesStatus(props, wanted) {
  return SPECIES_FIELDS
    .filter(([field]) => props[field] === wanted)
    .map(([, label]) => label)
}

function normalizeHarvestArea(feature) {
  const props = feature.properties ?? {}
  const name = cleanupText(props.DISPLAY_EN || props.PLACE_NAME_EN || 'DFO harvest area')
  return {
    ...feature,
    properties: {
      id: `cssp-harvest-${props.OBJECTID}`,
      sourceObjectId: props.OBJECTID,
      layerType: 'harvest-area',
      status: 'reference',
      label: name,
      name,
      subarea: name,
      summary: cleanupText(props.GEO_DESCRIPTION_EN || 'DFO CSSP harvest area reference boundary.'),
      source: 'DFO CSSP Shellfish Harvest Areas',
      sourceUrl: `${SERVICE}/0`,
    },
  }
}

function normalizeClassification(feature) {
  const props = feature.properties ?? {}
  const className = cleanupText(props.CLASS_EN || props.CLASS_CODE || 'Classification')
  const prohibited = props.CLASS_CODE === 'P' || className.toLowerCase().includes('prohibited')
  return {
    ...feature,
    properties: {
      id: `cssp-class-${props.OBJECTID}`,
      sourceObjectId: props.OBJECTID,
      layerType: 'classification',
      status: prohibited ? 'prohibited' : 'approved',
      label: prohibited ? 'CSSP 禁采分类' : 'CSSP Approved',
      name: className,
      summary: prohibited
        ? 'CSSP classification is Prohibited. Treat this as closed for bivalve shellfish harvesting.'
        : 'CSSP classification is Approved, but current biotoxin/sanitary closures and species rules still override it.',
      source: 'DFO CSSP Classification',
      sourceUrl: `${SERVICE}/6`,
    },
  }
}

function normalizeClosure(feature) {
  const props = feature.properties ?? {}
  const allClosed = props.ALL_BIVALVES === 1
  const closedSpecies = allClosed ? [] : speciesStatus(props, 1)
  const openSpecies = allClosed ? [] : speciesStatus(props, 0)
  const place = cleanupText(props.PLACE_NAME_EN || props.SECTOR || props.PO_NUM || 'DFO closure')
  const status = allClosed ? 'closed-all-bivalves' : 'species-specific-closure'
  const label = allClosed ? '贝类全关' : '物种限制'
  const summary = cleanupText(
    allClosed
      ? props.SPECIES_DESCRIPTION_EN || 'All bivalve shellfish are closed in this polygon.'
      : props.GEO_SHORT_DESCRIPTION_EN || props.SPECIES_DESCRIPTION_EN || 'Some bivalve species are closed in this polygon.',
  )

  return {
    ...feature,
    properties: {
      id: `cssp-closure-${props.OBJECTID}`,
      sourceObjectId: props.OBJECTID,
      layerType: 'operational-closure',
      status,
      label,
      name: place,
      subarea: cleanupText(props.SECTOR || props.PLACE_NAME_EN || ''),
      allBivalvesClosed: allClosed,
      closedSpecies,
      openSpecies,
      reasonCode: props.REASON,
      publicNoticeUrl: props.PUBLIC_NOTICE_URL,
      poNum: props.PO_NUM,
      issued: props.ISSUANCE_DATE_EN,
      enforced: props.ENFORCE_DATE_EN,
      summary,
      legalDescription: cleanupText(props.GEO_DESCRIPTION_EN),
      source: 'DFO CSSP Operational Prohibitions',
      sourceUrl: `${SERVICE}/20`,
    },
  }
}

const [harvestAreas, classifications, operationalClosures] = await Promise.all([
  queryLayer(0),
  queryLayer(6),
  queryLayer(20),
])

const features = [
  ...classifications.map(normalizeClassification),
  ...harvestAreas.map(normalizeHarvestArea),
  ...operationalClosures.map(normalizeClosure),
]

const data = {
  type: 'FeatureCollection',
  name: 'Tofino Area 24 CSSP shellfish sample',
  source: 'DFO CSSP Base Public MapServer',
  sourceUrl: SERVICE,
  generatedAt: new Date().toISOString(),
  bbox: BBOX.split(',').map(Number),
  note: 'Display and decision-support sample only. Harvesters must verify DFO notices, Area 24 regulations, licensed aquaculture boundaries, park/protected-area restrictions, licence conditions and beach signs before harvesting.',
  area24SourceUrl: 'https://www.pac.dfo-mpo.gc.ca/fm-gp/rec/tidal-maree/a-s24-eng.html',
  speciesRules: {
    bivalves: {
      sourceUpdated: '2026-05-25',
      note: 'DFO Area 24 lists open bivalve species by subarea; CSSP closure polygons override candidate open areas.',
    },
    seaCucumber: {
      status: 'open',
      areas: '24,124',
      gear: 'hand picking, hand picking while diving',
      dailyLimit: 12,
      sourceUpdated: '2026-04-01',
      warning: 'Closed in Pacific Rim National Park for diving/hand picking methods; protected areas and local closures override this general Area 24 rule.',
    },
  },
  features,
}

await writeFile(OUTPUT, `${JSON.stringify(data)}\n`, 'utf8')
console.log(`Wrote ${features.length} shellfish features to ${OUTPUT}`)
