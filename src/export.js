/**
 * SlowBy — 데이터 내보내기, 가져오기 및 DB 마이그레이션 모듈
 *
 * JSON / CSV / ZIP 포맷 지원으로 데이터 백업 및 향후 RDBMS/PostgreSQL 등으로의
 * 원활한 데이터 이관(Migration)을 지원합니다.
 */

import { getAllTravelLogs, getPhotoBlobs, saveTravelLog } from './store.js'
import { exportToDbSchema, CATEGORIES, photoList } from './schema.js'
import { getPhotoRawUrl } from './sync.js'
import { loadSettings } from './settings.js'

/**
 * JSON 파일로 다운로드 (DB 이관용 표준 덤프)
 */
export async function exportToJson() {
  const logs = await getAllTravelLogs()
  const dbData = exportToDbSchema(logs)
  const payload = {
    appName: 'SlowBy',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    totalCount: dbData.length,
    logs: dbData,
  }

  const jsonStr = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  downloadBlob(blob, `slowby_backup_${new Date().toISOString().slice(0, 10)}.json`)
}

/**
 * CSV 파일로 다운로드 (스프레드시트 및 데이터 분석용)
 */
export async function exportToCsv() {
  const logs = await getAllTravelLogs()
  const headers = [
    'ID',
    '방문일시',
    '범주',
    '제목',
    '평점',
    '위도',
    '경도',
    '주소',
    '지역',
    '지출비용(KRW)',
    '날씨',
    '동행',
    '태그',
    '메모',
  ]

  const escapeCsv = (val) => {
    if (val == null) return ''
    const str = String(val).replace(/"/g, '""')
    return `"${str}"`
  }

  const rows = logs.map((log) => [
    escapeCsv(log.id),
    escapeCsv(log.visitedAt),
    escapeCsv(CATEGORIES[log.category]?.label || log.category),
    escapeCsv(log.title),
    escapeCsv(log.rating || ''),
    escapeCsv(log.lat),
    escapeCsv(log.lng),
    escapeCsv(log.address),
    escapeCsv(log.region),
    escapeCsv(log.cost || ''),
    escapeCsv(log.weather || ''),
    escapeCsv(log.companion || ''),
    escapeCsv(Array.isArray(log.tags) ? log.tags.join(',') : ''),
    escapeCsv(log.memo),
  ])

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `slowby_travel_logs_${new Date().toISOString().slice(0, 10)}.csv`)
}

/** 내용으로 확장자를 정한다. 업로드 파일은 이름이 `.jpg` 여도 내용은 대개 WebP 다. */
function imageExt(bytes) {
  const tag = String.fromCharCode(...bytes.subarray(8, 12))
  if (tag === 'WEBP') return 'webp'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  return 'jpg'
}

/**
 * 사진 1장의 바이트. 로컬(아직 업로드 전)에 있으면 그것을, 없으면 사진 리포에서 받는다.
 * 동기화가 끝난 사진은 로컬에서 지워지므로 대부분 원격에서 온다.
 */
async function photoBytes(entry, settings) {
  const local = (await getPhotoBlobs(entry.id).catch(() => null))?.blob
  if (local) return new Uint8Array(await local.arrayBuffer())
  const url = getPhotoRawUrl(settings, { photo: entry }, 'full')
  if (!url) return null
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null)
  return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null
}

/**
 * ZIP 파일로 내보내기 (JSON 데이터 + 기록의 모든 사진)
 * @param {{onProgress?: (done: number, total: number) => void}} [opts]
 * @returns {Promise<{photos: number, missing: number}>}
 */
export async function exportToZip({ onProgress } = {}) {
  const { zip } = await import('fflate')
  const logs = await getAllTravelLogs()
  const dbData = exportToDbSchema(logs)
  const settings = loadSettings()

  const zipEntries = {}
  zipEntries['travel_logs.json'] = new TextEncoder().encode(
    JSON.stringify({ appName: 'SlowBy', logs: dbData }, null, 2),
  )

  const jobs = logs.flatMap((log) =>
    photoList(log).map((entry) => ({ entry, year: (log.visitedAt || 'misc').slice(0, 4) })),
  )
  let done = 0
  let missing = 0
  onProgress?.(0, jobs.length)
  // 동시에 4장씩 받는다 — 순서대로 받으면 사진이 많을 때 너무 느리다.
  const queue = [...jobs]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const bytes = await photoBytes(job.entry, settings)
        if (bytes) zipEntries[`photos/${job.year}/${job.entry.id}.${imageExt(bytes)}`] = bytes
        else missing++
        onProgress?.(++done, jobs.length)
      }
    }),
  )

  await new Promise((resolve, reject) => {
    zip(zipEntries, { level: 0 }, (err, data) => {
      if (err) return reject(err)
      const blob = new Blob([data], { type: 'application/zip' })
      downloadBlob(blob, `slowby_full_backup_${new Date().toISOString().slice(0, 10)}.zip`)
      resolve()
    })
  })
  return { photos: jobs.length - missing, missing }
}

/**
 * JSON 백업 파일 가져오기 (Import)
 * @param {File} file
 */
export async function importFromJson(file) {
  const text = await file.text()
  const parsed = JSON.parse(text)
  const logs = parsed.logs || (Array.isArray(parsed) ? parsed : [])
  let importedCount = 0

  for (const item of logs) {
    if (item.id) {
      await saveTravelLog(item)
      importedCount++
    }
  }
  return importedCount
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
