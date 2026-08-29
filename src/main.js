/**
 * SlowBy (슬로비) — 여행 기록 서비스 메인 애플리케이션 진입점
 */

import './style.css'
import { createMap, TILE_NAMES } from './map.js'
import { getAllTravelLogs } from './store.js'
import { loadSettings, openSettingsModal, isAdminAuthenticated } from './settings.js'
import { createSyncEngine, getPhotoRawUrl } from './sync.js'
import { openTravelEditor } from './editor.js'
import { openTravelViewer } from './viewer.js'
import { createSidebar } from './feed.js'
import { createClient } from './github.js'
import { iconEl, iconHtml } from './icons.js'

function renderShell(isAdmin) {
  const app = document.getElementById('app')
  app.textContent = ''
  app.className = 'slowby-app'

  // 상단 헤더
  const header = document.createElement('header')
  header.className = 'topbar'

  const brand = document.createElement('div')
  brand.className = 'brand'
  const logo = iconEl('logo', 22, 'brand-logo-icon')
  const title = document.createElement('span')
  title.className = 'brand-title'
  title.textContent = 'SlowBy'
  const badge = document.createElement('span')
  badge.className = 'brand-sub-badge'
  badge.textContent = '슬로비'
  brand.append(logo, title, badge)
  header.append(brand)

  const tools = document.createElement('div')
  tools.className = 'topbar-tools'

  // 지도 레이어 전환
  const tileGroup = document.createElement('div')
  tileGroup.className = 'seg-group'
  tools.append(tileGroup)

  const fitBtn = document.createElement('button')
  fitBtn.type = 'button'
  fitBtn.className = 'btn btn-sm fit-btn'
  fitBtn.innerHTML = `${iconHtml('crosshair', 13)} <span class="btn-text">전체보기</span>`
  tools.append(fitBtn)

  header.append(tools)

  // 메인 스테이지
  const stage = document.createElement('div')
  stage.className = 'stage'

  const mapwrap = document.createElement('div')
  mapwrap.className = 'mapwrap'
  const mapEl = document.createElement('div')
  mapEl.className = 'map'
  mapwrap.append(mapEl)

  // 모바일 전용 플로팅 등록 버튼 (FAB)
  if (isAdmin) {
    const fabBtn = document.createElement('button')
    fabBtn.type = 'button'
    fabBtn.className = 'mobile-fab'
    fabBtn.title = '새 여행 기록 등록'
    fabBtn.innerHTML = iconHtml('camera', 22)
    mapwrap.append(fabBtn)
  }

  stage.append(mapwrap)
  app.append(header, stage)

  return { app, header, brand, tools, tileGroup, fitBtn, stage, mapwrap, mapEl }
}

async function main() {
  let settings = loadSettings()
  let isAdmin = isAdminAuthenticated(settings)

  const { tileGroup, fitBtn, stage, mapEl, mapwrap } = renderShell(isAdmin)

  // 숨김 파일 입력창 (사진 업로드용)
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.multiple = true
  fileInput.hidden = true
  document.body.append(fileInput)

  let logs = []

  const photoUrlResolver = (log, kind) => getPhotoRawUrl(settings, log, kind)
  const syncEngine = createSyncEngine(() => settings)

  // 지도 초기화
  const mapView = createMap(mapEl, {
    getPhotoUrl: photoUrlResolver,
    onMarkerClick: (clickedLog) => {
      openTravelViewer({
        log: clickedLog,
        allLogs: logs,
        isAdmin,
        mapView,
        onEdit: (toEdit) => openEditorModal({ initialData: toEdit }),
        onDeleted: () => refreshData(),
        getPhotoUrl: photoUrlResolver,
      })
    },
  })

  fitBtn.onclick = () => mapView.fitAll()

  // 모바일 FAB 연결
  const fab = mapwrap.querySelector('.mobile-fab')
  if (fab) {
    fab.onclick = () => fileInput.click()
  }

  // 타일 레이어 버튼
  let currentTile = '일반'
  const tileButtons = TILE_NAMES.map((name) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `seg-btn ${name === currentTile ? 'is-active' : ''}`
    b.textContent = name
    b.onclick = () => {
      currentTile = name
      mapView.setTile(name)
      tileButtons.forEach((btn) => btn.classList.toggle('is-active', btn.textContent === name))
    }
    tileGroup.append(b)
    return b
  })

  function openEditorModal({ file = null, initialData = null } = {}) {
    openTravelEditor({
      file,
      initialData,
      mapView,
      onSaved: () => refreshData(),
    })
  }

  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || [])
    fileInput.value = ''
    if (!files.length) return

    for (const file of files) {
      await new Promise((resolve) => {
        openTravelEditor({
          file,
          mapView,
          onSaved: () => {
            refreshData()
            resolve()
          },
          onCancelled: () => resolve(),
        })
      })
    }
  }

  // 사이드바 피드 초기화
  const sidebar = createSidebar({
    containerEl: stage,
    isAdmin,
    onAddClick: () => fileInput.click(),
    onLogClick: (clickedLog) => {
      openTravelViewer({
        log: clickedLog,
        allLogs: logs,
        isAdmin,
        mapView,
        onEdit: (toEdit) => openEditorModal({ initialData: toEdit }),
        onDeleted: () => refreshData(),
        getPhotoUrl: photoUrlResolver,
      })
    },
    onFilterChange: (filters) => {
      applyFilters(filters)
    },
    onOpenSettings: () => {
      openSettingsModal({
        onSave: (next) => {
          settings = next
          isAdmin = isAdminAuthenticated(next)
          sidebar.setAdminMode(isAdmin)
          refreshData()
        },
        onCheck: async (cfg) => {
          const mk = (repo) =>
            createClient({ owner: cfg.owner, repo, branch: cfg.branch, token: cfg.token })
          const mainCli = mk(cfg.repo)
          const login = await mainCli.whoami()
          await mainCli.repoInfo()
          if (cfg.photoRepo) await mk(cfg.photoRepo).repoInfo()
          return { login }
        },
      })
    },
    onSyncRun: async () => {
      if (!isAdmin) {
        alert('동기화는 관리자 토큰(PAT)이 설정되어 있어야 실행할 수 있습니다. ⚙️ 버튼을 눌러 설정해주세요.')
        return
      }
      sidebar.setSyncStatus('동기화 진행 중…')
      try {
        const res = await syncEngine.runSync()
        sidebar.setSyncStatus(`동기화 완료 (${new Date(res.syncTime).toLocaleTimeString()})`)
        refreshData()
      } catch (e) {
        sidebar.setSyncStatus(`동기화 실패: ${e.message}`, true)
        alert(`동기화 실패: ${e.message}`)
      }
    },
    syncEngine,
    getPhotoUrl: photoUrlResolver,
  })

  syncEngine.onStateChange((st) => {
    if (st.phase === 'start') sidebar.setSyncStatus('동기화 시작…')
    else if (st.phase === 'photos') sidebar.setSyncStatus('사진 업로드 중…')
    else if (st.phase === 'logs') sidebar.setSyncStatus('여행 기록 커밋 중…')
    else if (st.phase === 'pull') sidebar.setSyncStatus('최신 변경 반영 중…')
    else if (st.phase === 'done') sidebar.setSyncStatus(`최신 동기화 완료 (${new Date(st.at).toLocaleTimeString()})`)
    else if (st.phase === 'error') sidebar.setSyncStatus(`동기화 오류: ${st.message}`, true)
  })

  function applyFilters(filters = sidebar.filters) {
    let filtered = [...logs]

    if (filters.category && filters.category !== 'all') {
      filtered = filtered.filter((l) => l.category === filters.category)
    }

    if (filters.query) {
      const q = filters.query.toLowerCase()
      filtered = filtered.filter((l) => {
        const title = (l.title || '').toLowerCase()
        const memo = (l.memo || '').toLowerCase()
        const addr = (l.address || '').toLowerCase()
        const tags = Array.isArray(l.tags) ? l.tags.join(' ').toLowerCase() : ''
        return title.includes(q) || memo.includes(q) || addr.includes(q) || tags.includes(q)
      })
    }

    if (filters.sort === 'latest') {
      filtered.sort((a, b) => (b.visitedAt || b.createdAt || '').localeCompare(a.visitedAt || a.createdAt || ''))
    } else if (filters.sort === 'oldest') {
      filtered.sort((a, b) => (a.visitedAt || a.createdAt || '').localeCompare(b.visitedAt || b.createdAt || ''))
    } else if (filters.sort === 'rating') {
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0))
    } else if (filters.sort === 'cost') {
      filtered.sort((a, b) => (b.cost || 0) - (a.cost || 0))
    }

    sidebar.renderLogs(filtered)
    mapView.setFilters({ category: filters.category, query: filters.query })
  }

  async function refreshData() {
    logs = await getAllTravelLogs()
    mapView.setLogs(logs)
    applyFilters()
  }

  // 초기 로드
  await refreshData()
  if (logs.length) {
    mapView.fitAll()
  }

  // 공개 데이터 자동 수신
  try {
    const pulled = await syncEngine.pullPublicData()
    if (pulled.pulled > 0) {
      await refreshData()
    }
  } catch {
    /* ignore offline */
  }

  // 드래그 앤 드롭 업로드
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return

    for (const file of files) {
      await new Promise((resolve) => {
        openTravelEditor({
          file,
          mapView,
          onSaved: () => {
            refreshData()
            resolve()
          },
          onCancelled: () => resolve(),
        })
      })
    }
  })
}

main()
