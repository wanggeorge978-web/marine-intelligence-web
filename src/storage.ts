import { openDB } from 'idb'
import type { UserSpot } from './types'

const STORE_NAME = 'spots'

export async function getSpotDb() {
  return openDB('marine-intelligence-web', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
  })
}

export async function loadStoredSpots(): Promise<UserSpot[]> {
  const db = await getSpotDb()
  const spots = await db.getAll(STORE_NAME)
  if (spots.length > 0) return spots as UserSpot[]

  const localValue = localStorage.getItem('marine-intelligence-spots')
  return localValue ? (JSON.parse(localValue) as UserSpot[]) : []
}

export async function saveStoredSpots(spots: UserSpot[]) {
  localStorage.setItem('marine-intelligence-spots', JSON.stringify(spots))
  const db = await getSpotDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  await tx.store.clear()
  await Promise.all(spots.map((spot) => tx.store.put(spot)))
  await tx.done
}
