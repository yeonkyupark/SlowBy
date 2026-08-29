/**
 * SlowBy — GitHub 무서버 동기화 엔진
 *
 * 1. 사진: `photo-repo` (https://github.com/yeonkyupark/photo-repo) 에 업로드
 * 2. 메타데이터: `SlowBy` 리포의 `public/data/travel_logs.json` 에 단일 커밋 병합
 * 3. 공개 열람: 일반 방문자는 토큰 없이 raw.githubusercontent.com 및 CDN으로 자동 동기화
 */

import { createClient } from './github.js'
import {
  getAllTravelLogsRaw,
  putTravelLogRaw,
  getTravelPhotoBlob,
  setLastSyncedAt,
  getLastSyncedAt,
} from './store.js'
import { exportToDbSchema } from './schema.js'

const LOGS_PATH = 'public/data/travel_logs.json'
const MAX_RETRIES = 3

/**
 * 원격 사진 raw URL 조립
 * @param {object} settings
 * @param {object} log
 * @param {'full'|'thumb'} kind
 */
export function getPhotoRawUrl(settings, log, kind) {
  const p = log?.photo
  if (!p) return null
  const path = p[kind]
  if (path && settings?.owner && settings?.photoRepo) {
    const enc = path.split('/').map(encodeURIComponent).join('/')
    return `https://raw.githubusercontent.com/${settings.owner}/${settings.photoRepo}/${settings.branch || 'main'}/${enc}`
  }
  return p[`${kind}Url`] ?? null
}

export function createSyncEngine(getSettings) {
  const listeners = new Set()
  const emit = (state) => listeners.forEach((fn) => fn(state))
  let isRunning = false

  function getClients() {
    const s = getSettings()
    if (!s.token) throw new Error('관리자 토큰(PAT)이 설정되지 않았습니다.')
    if (!s.owner || !s.repo) throw new Error('GitHub 계정 및 저장소 정보가 누락되었습니다.')
    const mainClient = createClient({ owner: s.owner, repo: s.repo, branch: s.branch, token: s.token })
    const photoClient = s.photoRepo
      ? createClient({ owner: s.owner, repo: s.photoRepo, branch: s.branch, token: s.token })
      : null
    return { mainClient, photoClient, settings: s }
  }

  /** 사진 파일들을 photo-repo에 업로드 */
  async function uploadPhotos(photoClient, logs, prefix = 'travel') {
    if (!photoClient) return { uploaded: 0, skipped: 0 }

    let uploaded = 0
    let skipped = 0

    for (const log of logs) {
      if (log.deleted) continue

      const year = (log.visitedAt || log.createdAt || 'misc').slice(0, 4)
      const paths = {
        full: `${prefix}/${year}/${log.id}.jpg`,
        thumb: `${prefix}/${year}/${log.id}_t.jpg`,
      }

      // 썸네일과 원본 Blob 확인
      const fullBlob = await getTravelPhotoBlob(log.id)
      if (!fullBlob && !log.thumb) continue

      const fullUpload = fullBlob
        ? await photoClient.putBlobIfAbsent(paths.full, fullBlob, `Upload photo ${log.id}`)
        : { skipped: true }
      const thumbUpload = log.thumb
        ? await photoClient.putBlobIfAbsent(paths.thumb, log.thumb, `Upload thumb ${log.id}`)
        : { skipped: true }

      if (fullUpload.skipped && thumbUpload.skipped) {
        skipped++
      } else {
        uploaded++
      }

      log.photo = {
        ...paths,
        fullUrl: photoClient.rawUrl(paths.full),
        thumbUrl: photoClient.rawUrl(paths.thumb),
      }
      await putTravelLogRaw(log)
    }

    return { uploaded, skipped }
  }

  /**
   * 일반 방문자용 공개 데이터 동기화 (토큰 불필요)
   */
  async function pullPublicData() {
    const s = getSettings()
    if (!s.owner || !s.repo) return { pulled: 0 }

    const reader = createClient({ owner: s.owner, repo: s.repo, branch: s.branch })
    const remote = await reader.readJson(LOGS_PATH).catch(() => null)
    if (!remote?.logs?.length) return { pulled: 0 }

    let pulled = 0
    const localMap = new Map((await getAllTravelLogsRaw()).map((l) => [l.id, l]))

    for (const r of remote.logs) {
      const local = localMap.get(r.id)
      if (local && (local.updatedAt || '') >= (r.updatedAt || '')) continue
      await putTravelLogRaw({ ...(local || {}), ...r, thumb: local?.thumb || null })
      pulled++
    }

    return { pulled }
  }

  /**
   * 관리자 동기화 (로컬 사진 photo-repo 푸시 -> travel_logs.json 커밋 -> 원격 변경점 풀)
   */
  async function runSync() {
    if (isRunning) return null
    isRunning = true
    emit({ phase: 'start' })

    try {
      const { mainClient, photoClient, settings } = getClients()

      // 1. 사진 업로드
      emit({ phase: 'photos' })
      const localLogs = await getAllTravelLogsRaw()
      const photoStats = await uploadPhotos(photoClient, localLogs, settings.photoPrefix || 'travel')

      // 2. travel_logs.json 병합 및 커밋
      emit({ phase: 'logs' })
      let merged = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const head = await mainClient.getFileJson(LOGS_PATH).catch(() => null)
        const sha = head?.sha ?? null
        const remote = head?.json ?? null

        const byId = new Map()
        for (const r of remote?.logs ?? []) byId.set(r.id, r)

        for (const log of await getAllTravelLogsRaw()) {
          const remoteItem = byId.get(log.id)
          const isLocalNewer = (log.updatedAt || '') >= (remoteItem?.updatedAt || '')
          if (isLocalNewer) {
            const sanitized = { ...log, thumb: null }
            byId.set(log.id, sanitized)
          }
        }

        const validLogs = [...byId.values()].sort((a, b) =>
          (b.visitedAt || b.createdAt || '').localeCompare(a.visitedAt || a.createdAt || ''),
        )

        merged = {
          version: 1,
          appName: 'SlowBy',
          updatedAt: new Date().toISOString(),
          logs: exportToDbSchema(validLogs),
        }

        try {
          await mainClient.putJson(LOGS_PATH, merged, {
            message: `[SlowBy] 여행 기록 동기화 (${validLogs.filter((l) => !l.deleted).length}개)`,
            sha,
          })
          break
        } catch (e) {
          if (attempt === MAX_RETRIES - 1) throw e
        }
      }

      // 3. 최신 변경사항 로컬 반영
      emit({ phase: 'pull' })
      let pulled = 0
      const currentLocal = new Map((await getAllTravelLogsRaw()).map((l) => [l.id, l]))
      for (const r of merged?.logs ?? []) {
        const local = currentLocal.get(r.id)
        if (local && (local.updatedAt || '') >= (r.updatedAt || '')) continue
        await putTravelLogRaw({ ...(local || {}), ...r, thumb: local?.thumb || null })
        pulled++
      }

      const syncTime = new Date().toISOString()
      await setLastSyncedAt(syncTime)
      emit({ phase: 'done', at: syncTime, photoStats, pulled })
      return { syncTime, photoStats, pulled }
    } catch (e) {
      emit({ phase: 'error', message: e.message })
      throw e
    } finally {
      isRunning = false
    }
  }

  return {
    runSync,
    pullPublicData,
    onStateChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getLastSyncedAt,
    get isRunning() {
      return isRunning
    },
  }
}
