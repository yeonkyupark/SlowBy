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
  getPhotoBlobs,
  setLastSyncedAt,
  getLastSyncedAt,
} from './store.js'
import { exportToDbSchema, photoList, photoMirror } from './schema.js'
import { DEFAULT_SETTINGS } from './settings.js'

const LOGS_PATH = 'public/data/travel_logs.json'
const MAX_RETRIES = 4
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 원격 사진 raw URL 조립 (공개 열람 모드 지원)
 * @param {object} settings
 * @param {object} log
 * @param {'full'|'thumb'} kind
 */
export function getPhotoRawUrl(settings, log, kind) {
  const p = log?.photo ?? log?.photoUrl
  if (!p) return null

  const owner = settings?.owner || DEFAULT_SETTINGS.owner
  const photoRepo = settings?.photoRepo || DEFAULT_SETTINGS.photoRepo
  const branch = settings?.branch || DEFAULT_SETTINGS.branch

  // 1. p가 이미 URL 문자열인 경우
  if (typeof p === 'string') {
    if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
      return p
    }
    const enc = p.split('/').map(encodeURIComponent).join('/')
    return `https://raw.githubusercontent.com/${owner}/${photoRepo}/${branch}/${enc}`
  }

  // 2. p가 객체인 경우 ({ full, thumb, fullUrl, thumbUrl 등 })
  const path = p[kind] || p[kind === 'thumb' ? 'full' : 'thumb']
  if (path) {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
      return path
    }
    const enc = path.split('/').map(encodeURIComponent).join('/')
    return `https://raw.githubusercontent.com/${owner}/${photoRepo}/${branch}/${enc}`
  }

  return p[`${kind}Url`] ?? p.thumbUrl ?? p.fullUrl ?? p.url ?? null
}

/**
 * 원격 기록을 로컬 위에 덮는다. 로컬 전용 필드(thumb, pendingDeletes)는 지키되,
 * 다른 기기에서 대표 사진이 바뀌었으면 로컬 썸네일은 낡았으므로 버린다.
 */
function mergeRemote(local, remote) {
  const sameCover = photoList(local)[0]?.id === photoList(remote)[0]?.id
  return {
    ...(local || {}),
    ...remote,
    thumb: sameCover ? local?.thumb || null : null,
    pendingDeletes: local?.pendingDeletes ?? [],
  }
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

  /**
   * 로컬에만 있는 사진을 photo-repo 에 올리고, 기록의 `photos`/`photo` 에 원격 경로를 채운다.
   *
   * 사진마다 파일이 따로다: `{prefix}/{year}/{사진 id}.jpg` 와 `_t.jpg`.
   * 사진 id 는 교체할 때마다 새로 발급되므로 같은 경로를 덮어쓸 일이 없다.
   */
  async function uploadPhotos(photoClient, logs, prefix = 'travel') {
    if (!photoClient) return { uploaded: 0, skipped: 0 }

    let uploaded = 0
    let skipped = 0
    // 리포 전체 경로를 한 번에 받아 두면 사진마다 존재 확인 요청을 보내지 않아도 된다.
    const existing = await photoClient.listPaths().catch(() => null)
    const putIfMissing = (path, blob, message) =>
      existing?.has(path)
        ? { skipped: true, path }
        : photoClient.putBlobIfAbsent(path, blob, message)

    for (const log of logs) {
      if (log.deleted) continue

      const year = (log.visitedAt || log.createdAt || 'misc').slice(0, 4)
      const entries = photoList(log)
      let changed = false

      for (const [i, entry] of entries.entries()) {
        const local = await getPhotoBlobs(entry.id)
        const fullBlob = local?.blob ?? null
        // 이전 버전 데이터는 대표 썸네일이 기록 자체에 있다.
        const thumbBlob = local?.thumb ?? (i === 0 ? log.thumb : null) ?? null
        if (!fullBlob && !thumbBlob) continue // 원격에만 있는 사진

        const paths = {
          full: entry.full || `${prefix}/${year}/${entry.id}.jpg`,
          thumb: entry.thumb || `${prefix}/${year}/${entry.id}_t.jpg`,
        }
        const fullUpload = fullBlob
          ? await putIfMissing(paths.full, fullBlob, `Upload photo ${entry.id}`)
          : { skipped: true }
        const thumbUpload = thumbBlob
          ? await putIfMissing(paths.thumb, thumbBlob, `Upload thumb ${entry.id}`)
          : { skipped: true }

        if (fullUpload.skipped && thumbUpload.skipped) skipped++
        else uploaded++

        const next = {
          ...entry,
          ...paths,
          fullUrl: photoClient.rawUrl(paths.full),
          thumbUrl: photoClient.rawUrl(paths.thumb),
        }
        if (next.full !== entry.full || next.thumb !== entry.thumb || next.fullUrl !== entry.fullUrl) {
          entries[i] = next
          changed = true
        }
      }

      if (changed || (entries.length && !log.photos?.length)) {
        log.photos = entries
        log.photo = photoMirror(entries[0])
        await putTravelLogRaw(log)
      }
    }

    return { uploaded, skipped }
  }

  /** 교체·삭제된 사진 파일을 photo-repo 에서 지운다. 성공한 경로만 대기 목록에서 뺀다. */
  async function removeDeletedPhotos(photoClient) {
    if (!photoClient) return 0
    const logs = await getAllTravelLogsRaw()
    // 다른 기기의 더 새 기록이 아직 그 사진을 쓰고 있으면 지우지 않는다.
    const inUse = new Set(
      logs
        .filter((l) => !l.deleted)
        .flatMap((l) => photoList(l).flatMap((p) => [p.full, p.thumb]))
        .filter(Boolean),
    )
    let removed = 0
    for (const log of logs) {
      const pending = log.pendingDeletes ?? []
      if (!pending.length) continue
      const left = []
      for (const path of pending) {
        if (inUse.has(path)) continue
        try {
          if (await photoClient.deleteFile(path, `Delete photo ${path}`)) removed++
        } catch {
          left.push(path) // 다음 동기화 때 다시 시도
        }
      }
      await putTravelLogRaw({ ...log, pendingDeletes: left })
    }
    return removed
  }

  /**
   * 일반 방문자용 공개 데이터 동기화 (토큰 불필요)
   */
  async function pullPublicData() {
    const s = getSettings()
    const owner = s.owner || DEFAULT_SETTINGS.owner
    const repo = s.repo || DEFAULT_SETTINGS.repo
    const branch = s.branch || DEFAULT_SETTINGS.branch

    const reader = createClient({ owner, repo, branch })
    const remote = await reader.readJson(LOGS_PATH).catch(() => null)
    if (!remote?.logs?.length) return { pulled: 0 }

    let pulled = 0
    const localMap = new Map((await getAllTravelLogsRaw()).map((l) => [l.id, l]))

    for (const r of remote.logs) {
      const local = localMap.get(r.id)
      if (local && (local.updatedAt || '') >= (r.updatedAt || '')) continue
      await putTravelLogRaw(mergeRemote(local, r))
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
        const head = await mainClient.getFileJson(LOGS_PATH) // catch 제거: 404만 null 반환
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
          // 409(sha 불일치)·422(sha 누락)는 읽은 sha 가 낡았다는 뜻 — 잠시 뒤 다시 읽어 병합한다.
          // 그 외 오류(권한 등)는 재시도해도 같으므로 바로 던진다.
          const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.message))
          if (!conflict || attempt === MAX_RETRIES - 1) throw e
          await sleep(1000 * 2 ** attempt)
        }
      }

      // 3. 최신 변경사항 로컬 반영
      emit({ phase: 'pull' })
      let pulled = 0
      const currentLocal = new Map((await getAllTravelLogsRaw()).map((l) => [l.id, l]))
      for (const r of merged?.logs ?? []) {
        const local = currentLocal.get(r.id)
        if (local && (local.updatedAt || '') >= (r.updatedAt || '')) continue
        await putTravelLogRaw(mergeRemote(local, r))
        pulled++
      }

      // 4. 새 JSON 이 더는 가리키지 않게 된 뒤에 옛 사진 파일을 지운다.
      //    먼저 지우면 커밋이 실패했을 때 공개 페이지에 깨진 사진이 남는다.
      photoStats.removed = await removeDeletedPhotos(photoClient)

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
