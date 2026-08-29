/**
 * SlowBy — 데이터 내보내기, 가져오기 및 DB 마이그레이션 모듈
 *
 * JSON / CSV / ZIP 포맷 지원으로 데이터 백업 및 향후 RDBMS/PostgreSQL 등으로의
 * 원활한 데이터 이관(Migration)을 지원합니다.
 */

import { getAllTravelLogs, getTravelPhotoBlob, saveTravelLog } from './store.js'
import { exportToDbSchema, CATEGORIES } from './schema.js'

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

/**
 * ZIP 파일로 내보내기 (JSON 데이터 + 고해상도 원본 사진 일체 포함)
 */
export async function exportToZip() {
  const { zip } = await import('fflate')
  const logs = await getAllTravelLogs()
  const dbData = exportToDbSchema(logs)

  const zipEntries = {}
  zipEntries['travel_logs.json'] = new TextEncoder().encode(
    JSON.stringify({ appName: 'SlowBy', logs: dbData }, null, 2),
  )

  for (const log of logs) {
    const photoBlob = await getTravelPhotoBlob(log.id)
    if (photoBlob) {
      const buffer = new Uint8Array(await photoBlob.arrayBuffer())
      const year = (log.visitedAt || 'misc').slice(0, 4)
      zipEntries[`photos/${year}/${log.id}.jpg`] = buffer
    }
  }

  return new Promise((resolve, reject) => {
    zip(zipEntries, { level: 0 }, (err, data) => {
      if (err) return reject(err)
      const blob = new Blob([data], { type: 'application/zip' })
      downloadBlob(blob, `slowby_full_backup_${new Date().toISOString().slice(0, 10)}.zip`)
      resolve()
    })
  })
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
