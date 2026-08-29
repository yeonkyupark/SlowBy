/**
 * SlowBy (슬로비) — 사이드바 여행 타임라인 피드 및 모바일 바텀시트
 */

import { CATEGORIES } from './schema.js'
import { renderStatsDashboard } from './stats.js'
import { iconEl, iconHtml } from './icons.js'

export function createSidebar({
  containerEl,
  isAdmin = false,
  onAddClick,
  onLogClick,
  onFilterChange,
  onOpenSettings,
  onSyncRun,
  syncEngine,
  getPhotoUrl,
}) {
  const panel = document.createElement('aside')
  panel.className = 'slowby-panel'

  // 모바일 하단 시트 제스처 핸들
  const handle = document.createElement('div')
  handle.className = 'sheet-handle'
  handle.innerHTML = '<span class="grip"></span>'
  panel.append(handle)

  let sheetState = 1 // 0: 최소(80px), 1: 중간(50vh), 2: 전체(88vh)
  const SHEET_CLASSES = ['is-peek', 'is-half', 'is-full']

  function applySheet(state) {
    sheetState = Math.max(0, Math.min(2, state))
    panel.classList.remove(...SHEET_CLASSES)
    panel.classList.add(SHEET_CLASSES[sheetState])
  }

  handle.onclick = () => {
    applySheet((sheetState + 1) % 3)
  }

  // 모바일 터치 드래그 제스처
  let startY = 0
  let isDragging = false
  handle.addEventListener(
    'touchstart',
    (e) => {
      startY = e.touches[0].clientY
      isDragging = true
    },
    { passive: true },
  )

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!isDragging) return
      const delta = e.touches[0].clientY - startY
      if (Math.abs(delta) > 50) {
        if (delta > 0 && sheetState > 0) {
          applySheet(sheetState - 1)
          isDragging = false
        } else if (delta < 0 && sheetState < 2) {
          applySheet(sheetState + 1)
          isDragging = false
        }
      }
    },
    { passive: true },
  )

  window.addEventListener('touchend', () => {
    isDragging = false
  })

  applySheet(sheetState)

  const body = document.createElement('div')
  body.className = 'panel-body'
  panel.append(body)

  // 1. 탭 내비게이션 (타임라인 / 통계)
  const tabNav = document.createElement('div')
  tabNav.className = 'panel-tabs'

  const tabTimeline = document.createElement('button')
  tabTimeline.type = 'button'
  tabTimeline.className = 'tab-btn is-active'
  tabTimeline.innerHTML = `${iconHtml('map', 14)} <span>여행 피드</span>`

  const tabStats = document.createElement('button')
  tabStats.type = 'button'
  tabStats.className = 'tab-btn'
  tabStats.innerHTML = `${iconHtml('stats', 14)} <span>통계 & 백업</span>`

  tabNav.append(tabTimeline, tabStats)
  body.append(tabNav)

  // 2. 컨텐츠 탭
  const timelineView = document.createElement('div')
  timelineView.className = 'tab-content timeline-view'

  const statsView = document.createElement('div')
  statsView.className = 'tab-content stats-view'
  statsView.style.display = 'none'

  body.append(timelineView, statsView)

  tabTimeline.onclick = () => {
    tabTimeline.classList.add('is-active')
    tabStats.classList.remove('is-active')
    timelineView.style.display = ''
    statsView.style.display = 'none'
  }

  tabStats.onclick = () => {
    tabStats.classList.add('is-active')
    tabTimeline.classList.remove('is-active')
    timelineView.style.display = 'none'
    statsView.style.display = ''
    renderStatsDashboard(statsView, { onDataImported: () => onFilterChange?.(currentFilters) })
  }

  // ── 타임라인 뷰 구성 ──
  // 관리자 전용 등록 & 동기화 헤더
  const headerAction = document.createElement('div')
  headerAction.className = 'feed-action-bar'

  if (isAdmin) {
    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'btn btn-primary add-log-btn'
    addBtn.innerHTML = `${iconHtml('camera', 16)} <span>사진으로 여행 기록</span>`
    addBtn.onclick = onAddClick
    headerAction.append(addBtn)
  }

  const syncRow = document.createElement('div')
  syncRow.className = 'sync-status-row'

  const syncBtn = document.createElement('button')
  syncBtn.type = 'button'
  syncBtn.className = 'btn-sm'
  syncBtn.innerHTML = `${iconHtml('sync', 12)} <span>동기화</span>`
  syncBtn.onclick = onSyncRun

  const gearBtn = document.createElement('button')
  gearBtn.type = 'button'
  gearBtn.className = 'icon-btn'
  gearBtn.title = '저장소 및 관리자 설정'
  gearBtn.append(iconEl('settings', 14))
  gearBtn.onclick = onOpenSettings

  const syncLabel = document.createElement('span')
  syncLabel.className = 'sync-label'
  syncLabel.textContent = isAdmin ? '관리자 모드' : '공개 열람 모드'

  syncRow.append(syncBtn, gearBtn, syncLabel)
  headerAction.append(syncRow)
  timelineView.append(headerAction)

  // 검색 및 정렬 바
  const searchRow = document.createElement('div')
  searchRow.className = 'search-sort-row'

  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.className = 'feed-search-input'
  searchInput.placeholder = '장소, 메모, 주소, #태그 검색...'

  const sortSelect = document.createElement('select')
  sortSelect.className = 'feed-sort-select'
  sortSelect.innerHTML = `
    <option value="latest">최신순</option>
    <option value="oldest">과거순</option>
    <option value="rating">별점순</option>
    <option value="cost">비용순</option>
  `

  searchRow.append(searchInput, sortSelect)
  timelineView.append(searchRow)

  // 카테고리 필터 칩 바
  const catFilterBar = document.createElement('div')
  catFilterBar.className = 'cat-filter-bar'

  const allChip = document.createElement('button')
  allChip.type = 'button'
  allChip.className = 'cat-filter-chip is-active'
  allChip.dataset.cat = 'all'
  allChip.textContent = '전체'
  catFilterBar.append(allChip)

  for (const [k, v] of Object.entries(CATEGORIES)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'cat-filter-chip'
    chip.dataset.cat = k
    chip.innerHTML = `${iconHtml(v.icon, 13)} <span>${v.label}</span>`
    catFilterBar.append(chip)
  }
  timelineView.append(catFilterBar)

  // 피드 리스트
  const feedList = document.createElement('div')
  feedList.className = 'feed-cards-list'
  timelineView.append(feedList)

  containerEl.append(panel)

  // ── 필터 및 상태 ──
  const currentFilters = {
    category: 'all',
    query: '',
    sort: 'latest',
  }

  function handleFilter() {
    onFilterChange?.(currentFilters)
  }

  catFilterBar.onclick = (e) => {
    const chip = e.target.closest('.cat-filter-chip')
    if (!chip) return
    catFilterBar.querySelectorAll('.cat-filter-chip').forEach((c) => c.classList.remove('is-active'))
    chip.classList.add('is-active')
    currentFilters.category = chip.dataset.cat
    handleFilter()
  }

  searchInput.oninput = () => {
    currentFilters.query = searchInput.value.trim()
    handleFilter()
  }

  sortSelect.onchange = () => {
    currentFilters.sort = sortSelect.value
    handleFilter()
  }

  const activeBlobUrls = new Set()

  function renderLogs(logs) {
    for (const u of activeBlobUrls) URL.revokeObjectURL(u)
    activeBlobUrls.clear()
    feedList.textContent = ''

    if (!logs.length) {
      const empty = document.createElement('div')
      empty.className = 'feed-empty'
      empty.innerHTML = `
        <div class="empty-icon">${iconHtml('camera', 36)}</div>
        <p class="empty-text">등록된 여행 기록이 없습니다.</p>
        ${isAdmin ? '<p class="empty-sub">상단의 "사진으로 여행 기록" 버튼을 눌러 첫 여행을 기록해보세요!</p>' : ''}
      `
      feedList.append(empty)
      return
    }

    // 날짜별 그룹화
    const groups = new Map()
    for (const log of logs) {
      const dateKey = log.visitedAt ? log.visitedAt.slice(0, 10) : '날짜 미지정'
      if (!groups.has(dateKey)) groups.set(dateKey, [])
      groups.get(dateKey).push(log)
    }

    for (const [dateKey, groupLogs] of groups.entries()) {
      const groupEl = document.createElement('div')
      groupEl.className = 'date-group'

      const dateHeader = document.createElement('div')
      dateHeader.className = 'date-group-header'
      if (dateKey !== '날짜 미지정') {
        const d = new Date(dateKey)
        const days = ['일', '월', '화', '수', '목', '금', '토']
        const dayStr = Number.isNaN(+d) ? '' : ` (${days[d.getDay()]})`
        dateHeader.innerHTML = `${iconHtml('calendar', 12)} <span>${dateKey}${dayStr}</span>`
      } else {
        dateHeader.innerHTML = `${iconHtml('calendar', 12)} <span>날짜 미지정</span>`
      }
      groupEl.append(dateHeader)

      for (const log of groupLogs) {
        const card = document.createElement('div')
        card.className = 'feed-card'
        card.onclick = () => onLogClick?.(log)

        // 썸네일
        const thumbWrap = document.createElement('div')
        thumbWrap.className = 'card-thumb-wrap'
        const cat = CATEGORIES[log.category] || CATEGORIES.spot

        let thumbSrc = null
        if (log.thumb) {
          thumbSrc = URL.createObjectURL(log.thumb)
          activeBlobUrls.add(thumbSrc)
        } else {
          thumbSrc = getPhotoUrl?.(log, 'thumb') || getPhotoUrl?.(log, 'full')
        }

        if (thumbSrc) {
          const img = document.createElement('img')
          img.src = thumbSrc
          img.alt = log.title || '사진'
          img.loading = 'lazy'
          thumbWrap.append(img)
        } else {
          thumbWrap.classList.add('is-fallback')
          thumbWrap.style.color = cat.color
          thumbWrap.innerHTML = iconHtml(cat.icon, 24)
        }
        card.append(thumbWrap)

        // 내용
        const info = document.createElement('div')
        info.className = 'card-info'

        const headRow = document.createElement('div')
        headRow.className = 'card-head-row'

        const pill = document.createElement('span')
        pill.className = 'cat-pill-sm'
        pill.style.backgroundColor = cat.bg
        pill.style.color = cat.color
        pill.style.borderColor = cat.border
        pill.innerHTML = `${iconHtml(cat.icon, 11)} <span>${cat.label}</span>`

        const title = document.createElement('b')
        title.className = 'card-title'
        title.textContent = log.title || '제목 없음'

        headRow.append(pill, title)
        info.append(headRow)

        if (log.memo) {
          const memo = document.createElement('p')
          memo.className = 'card-memo'
          memo.textContent = log.memo
          info.append(memo)
        }

        const footRow = document.createElement('div')
        footRow.className = 'card-foot-row'

        if (log.rating > 0) {
          const rating = document.createElement('span')
          rating.className = 'card-rating'
          rating.innerHTML = iconHtml('star', 12) + ` ${log.rating}`
          footRow.append(rating)
        }

        if (log.cost != null) {
          const cost = document.createElement('span')
          cost.className = 'card-cost'
          cost.textContent = `₩${Number(log.cost).toLocaleString()}`
          footRow.append(cost)
        }

        if (log.address) {
          const loc = document.createElement('span')
          loc.className = 'card-loc'
          loc.innerHTML = `${iconHtml('location', 11)} <span>${log.address.split(' ').slice(0, 3).join(' ')}</span>`
          footRow.append(loc)
        }

        info.append(footRow)
        card.append(info)
        groupEl.append(card)
      }

      feedList.append(groupEl)
    }
  }

  function setSyncStatus(text, isError = false) {
    syncLabel.textContent = text
    syncLabel.classList.toggle('is-error', isError)
  }

  return {
    renderLogs,
    setSyncStatus,
    setAdminMode(nextIsAdmin) {
      isAdmin = nextIsAdmin
      syncLabel.textContent = isAdmin ? '관리자 모드' : '공개 열람 모드'
      const existAdd = headerAction.querySelector('.add-log-btn')
      if (isAdmin && !existAdd) {
        const addBtn = document.createElement('button')
        addBtn.type = 'button'
        addBtn.className = 'btn btn-primary add-log-btn'
        addBtn.innerHTML = `${iconHtml('camera', 16)} <span>사진으로 여행 기록</span>`
        addBtn.onclick = onAddClick
        headerAction.prepend(addBtn)
      } else if (!isAdmin && existAdd) {
        existAdd.remove()
      }
    },
    get filters() {
      return currentFilters
    },
  }
}
