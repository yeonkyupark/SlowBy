/**
 * SlowBy — IndexedDB 로컬 저장소 및 통계 집계 모듈
 *
 * 브라우저 로컬 데이터베이스에 여행 기록 및 고화질 사진을 안전하게 보관합니다.
 * 오프라인 환경에서도 100% 동작하며, 향후 서버 DB(PostgreSQL/Supabase 등)로의
 * 마이그레이션이 용이하도록 표준화된 인터페이스를 제공합니다.
 */

import { createTravelLogRecord, CATEGORIES, photoList } from './schema.js'

const DB_NAME = 'slowby_travel'
const DB_VERSION = 1
const STORE_LOGS = 'travel_logs'
const STORE_PHOTOS = 'travel_photos'
const STORE_META = 'meta'

let dbPromise = null

function getDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        const store = db.createObjectStore(STORE_LOGS, { keyPath: 'id' })
        store.createIndex('visitedAt', 'visitedAt')
        store.createIndex('category', 'category')
        store.createIndex('updatedAt', 'updatedAt')
        store.createIndex('rating', 'rating')
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 초기화 실패'))
    req.onblocked = () => reject(new Error('다른 탭에서 이전 버전의 DB를 사용 중입니다.'))
  })
  return dbPromise
}

function runTx(storeName, mode, callback) {
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const req = callback(tx.objectStore(storeName))
        tx.oncomplete = () => resolve(req?.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('트랜잭션 중단됨'))
      }),
  )
}

/**
 * 여행 기록 및 원본 사진 저장 (생성 또는 수정)
 * @param {object} logData
 * @param {Blob|null} photoBlob
 * @returns {Promise<object>}
 */
export async function saveTravelLog(logData, photoBlob = null) {
  const record = createTravelLogRecord(logData)
  await runTx(STORE_LOGS, 'readwrite', (s) => s.put(record))
  if (photoBlob) {
    await runTx(STORE_PHOTOS, 'readwrite', (s) => s.put({ id: record.id, blob: photoBlob }))
  }
  return record
}

/**
 * 사진 Blob 들을 저장한다. 사진마다 행 하나 — `{ id: 사진 id, blob: 원본, thumb: 썸네일 }`.
 * @param {Array<{id: string, blob: Blob|null, thumb: Blob|null}>} rows
 */
export async function savePhotoBlobs(rows) {
  if (!rows.length) return
  await runTx(STORE_PHOTOS, 'readwrite', (s) => {
    for (const r of rows) s.put({ id: r.id, blob: r.blob ?? null, thumb: r.thumb ?? null })
  })
}

/** @param {string[]} ids */
export async function deletePhotoBlobs(ids) {
  if (!ids.length) return
  await runTx(STORE_PHOTOS, 'readwrite', (s) => {
    for (const id of ids) s.delete(id)
  })
}

/**
 * 사진 1장의 로컬 Blob. 이전 버전 행에는 thumb 가 없다(기록의 `thumb` 에 있었다).
 * @returns {Promise<{blob: Blob|null, thumb: Blob|null}|null>}
 */
export async function getPhotoBlobs(photoId) {
  const row = await runTx(STORE_PHOTOS, 'readonly', (s) => s.get(photoId))
  return row ? { blob: row.blob ?? null, thumb: row.thumb ?? null } : null
}

/**
 * 삭제되지 않은 활성 여행 기록 전체 조회 (방문일시 내림차순 정렬)
 * @returns {Promise<Array<object>>}
 */
export async function getAllTravelLogs() {
  const rows = await runTx(STORE_LOGS, 'readonly', (s) => s.getAll())
  return (rows ?? [])
    .filter((log) => !log.deleted)
    .sort((a, b) => (b.visitedAt || b.createdAt || '').localeCompare(a.visitedAt || a.createdAt || ''))
}

/**
 * 특정 여행 기록 1건 조회
 * @param {string} id
 */
export async function getTravelLog(id) {
  return runTx(STORE_LOGS, 'readonly', (s) => s.get(id))
}

/**
 * 여행 기록 소프트 삭제
 * @param {string} id
 */
export async function deleteTravelLog(id) {
  const rec = await getTravelLog(id)
  if (!rec) return
  const photos = photoList(rec)
  const remotePaths = photos.flatMap((p) => [p.full, p.thumb]).filter(Boolean)
  const updated = {
    ...rec,
    deleted: true,
    thumb: null,
    photos: [],
    photo: null,
    // 사진 리포의 파일은 다음 동기화 때 지운다.
    pendingDeletes: [...new Set([...(rec.pendingDeletes ?? []), ...remotePaths])],
    updatedAt: new Date().toISOString(),
  }
  await runTx(STORE_LOGS, 'readwrite', (s) => s.put(updated))
  await deletePhotoBlobs([...new Set([id, ...photos.map((p) => p.id)])])
}

/**
 * 동기화용 원시 데이터 전체 조회 (소프트 삭제 포함)
 */
export async function getAllTravelLogsRaw() {
  return (await runTx(STORE_LOGS, 'readonly', (s) => s.getAll())) ?? []
}

/**
 * 원격 동기화 데이터를 로컬에 직접 삽입 (updatedAt 갱신 없이 보존)
 */
export async function putTravelLogRaw(log) {
  return runTx(STORE_LOGS, 'readwrite', (s) => s.put(log))
}

/** 동기화 타임스탬프 관리 */
export async function setLastSyncedAt(isoString) {
  await runTx(STORE_META, 'readwrite', (s) => s.put({ key: 'lastSyncedAt', value: isoString }))
}

export async function getLastSyncedAt() {
  const r = await runTx(STORE_META, 'readonly', (s) => s.get('lastSyncedAt'))
  return r?.value ?? null
}

/**
 * 여행 기록 통계 데이터 집계 (대시보드 및 분석용)
 */
export async function getTravelStats() {
  const logs = await getAllTravelLogs()
  const totalCount = logs.length

  const byCategory = {}
  for (const cat of Object.keys(CATEGORIES)) {
    byCategory[cat] = 0
  }

  let totalCost = 0
  let ratedCount = 0
  let ratingSum = 0
  const regions = new Set()
  const dates = new Set()

  for (const log of logs) {
    if (byCategory[log.category] !== undefined) {
      byCategory[log.category]++
    } else {
      byCategory.etc = (byCategory.etc || 0) + 1
    }

    if (log.cost) totalCost += Number(log.cost) || 0
    if (log.rating > 0) {
      ratingSum += log.rating
      ratedCount++
    }
    if (log.region) regions.add(log.region)
    if (log.visitedAt) dates.add(log.visitedAt.slice(0, 10))
  }

  return {
    totalCount,
    byCategory,
    totalCost,
    averageRating: ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : '0.0',
    uniqueRegionsCount: regions.size,
    travelDaysCount: dates.size,
  }
}

/** 브라우저 스토리지 용량 추정 */
export async function getStorageUsage() {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est) return null
    return { usedBytes: est.usage ?? 0, quotaBytes: est.quota ?? 0 }
  } catch {
    return null
  }
}
