/**
 * SlowBy (슬로비) — 여행 통계 및 데이터 분석 / 백업 대시보드
 */

import { CATEGORIES } from './schema.js'
import { getTravelStats, getStorageUsage } from './store.js'
import { exportToJson, exportToCsv, exportToZip, importFromJson } from './export.js'
import { formatBytes } from './photos.js'
import { iconEl, iconHtml } from './icons.js'

export function renderStatsDashboard(containerEl, { onDataImported } = {}) {
  containerEl.textContent = ''

  const wrap = document.createElement('div')
  wrap.className = 'stats-container'

  const loading = document.createElement('p')
  loading.className = 'stats-loading'
  loading.textContent = '통계 데이터를 분석하고 있습니다…'
  wrap.append(loading)
  containerEl.append(wrap)

  async function load() {
    const [stats, usage] = await Promise.all([getTravelStats(), getStorageUsage()])
    wrap.textContent = ''

    // 1. 핵심 지표 요약 카드 그리드
    const kpiGrid = document.createElement('div')
    kpiGrid.className = 'stats-kpi-grid'

    const createKpi = (label, val, sub = '', iconName = 'stats') => {
      const card = document.createElement('div')
      card.className = 'kpi-card'
      const topRow = document.createElement('div')
      topRow.className = 'kpi-top-row'
      const l = document.createElement('div')
      l.className = 'kpi-label'
      l.textContent = label
      const ic = iconEl(iconName, 14, 'kpi-icon')
      topRow.append(l, ic)

      const v = document.createElement('div')
      v.className = 'kpi-value'
      v.textContent = val
      card.append(topRow, v)
      if (sub) {
        const s = document.createElement('div')
        s.className = 'kpi-sub'
        s.textContent = sub
        card.append(s)
      }
      return card
    }

    kpiGrid.append(
      createKpi('총 여행 기록', `${stats.totalCount}곳`, `총 ${stats.travelDaysCount}일간의 기록`, 'camera'),
      createKpi('평균 별점', `★ ${stats.averageRating}`, '전체 평점 평균', 'star'),
      createKpi('총 여행 지출', `₩${stats.totalCost.toLocaleString()}`, '등록된 지출 합계', 'wallet'),
      createKpi('방문 지역', `${stats.uniqueRegionsCount}개 지역`, '시/도/군 기준', 'location'),
    )
    wrap.append(kpiGrid)

    // 2. 카테고리별 방문 분포 차트
    const catSection = document.createElement('div')
    catSection.className = 'stats-section'
    const catTitle = document.createElement('h3')
    catTitle.className = 'stats-section-title'
    catTitle.innerHTML = `${iconHtml('stats', 14)} <span>범주별 방문 통계</span>`
    catSection.append(catTitle)

    const catList = document.createElement('div')
    catList.className = 'stats-cat-list'

    const maxCatCount = Math.max(1, ...Object.values(stats.byCategory))

    for (const [key, count] of Object.entries(stats.byCategory)) {
      if (count === 0) continue
      const cat = CATEGORIES[key] || CATEGORIES.spot

      const row = document.createElement('div')
      row.className = 'stats-cat-row'

      const label = document.createElement('span')
      label.className = 'stats-cat-label'
      label.innerHTML = `${iconHtml(cat.icon, 13)} <span>${cat.label}</span>`

      const barWrap = document.createElement('div')
      barWrap.className = 'stats-bar-wrap'
      const bar = document.createElement('div')
      bar.className = 'stats-bar-fill'
      bar.style.backgroundColor = cat.color
      const pct = ((count / maxCatCount) * 100).toFixed(1)
      bar.style.width = `${pct}%`
      barWrap.append(bar)

      const countBadge = document.createElement('span')
      countBadge.className = 'stats-cat-count'
      countBadge.textContent = `${count}곳`

      row.append(label, barWrap, countBadge)
      catList.append(row)
    }

    if (!catList.children.length) {
      const emptyMsg = document.createElement('p')
      emptyMsg.className = 'stats-empty'
      emptyMsg.textContent = '아직 등록된 여행 기록이 없습니다.'
      catList.append(emptyMsg)
    }
    catSection.append(catList)
    wrap.append(catSection)

    // 3. 데이터 관리 & DB 이관 백업 섹션
    const backupSection = document.createElement('div')
    backupSection.className = 'stats-section'
    const backupTitle = document.createElement('h3')
    backupTitle.className = 'stats-section-title'
    backupTitle.innerHTML = `${iconHtml('download', 14)} <span>데이터 백업 및 DB 이관</span>`
    backupSection.append(backupTitle)

    const backupDesc = document.createElement('p')
    backupDesc.className = 'stats-subtext'
    backupDesc.textContent =
      '모든 여행 기록을 표준 JSON(DB 덤프), CSV(엑셀 분석용) 또는 고화질 사진이 포함된 ZIP 파일로 내보낼 수 있습니다.'
    backupSection.append(backupDesc)

    const btnGrid = document.createElement('div')
    btnGrid.className = 'stats-btn-grid'

    const jsonBtn = document.createElement('button')
    jsonBtn.type = 'button'
    jsonBtn.className = 'btn'
    jsonBtn.innerHTML = `${iconHtml('download', 13)} <span>JSON (DB 덤프)</span>`
    jsonBtn.onclick = () => exportToJson()

    const csvBtn = document.createElement('button')
    csvBtn.type = 'button'
    csvBtn.className = 'btn'
    csvBtn.innerHTML = `${iconHtml('download', 13)} <span>CSV (Excel용)</span>`
    csvBtn.onclick = () => exportToCsv()

    const zipBtn = document.createElement('button')
    zipBtn.type = 'button'
    zipBtn.className = 'btn'
    zipBtn.innerHTML = `${iconHtml('download', 13)} <span>ZIP 전체 백업</span>`
    zipBtn.onclick = async () => {
      zipBtn.disabled = true
      zipBtn.textContent = '압축 중…'
      try {
        await exportToZip()
      } finally {
        zipBtn.disabled = false
        zipBtn.innerHTML = `${iconHtml('download', 13)} <span>ZIP 전체 백업</span>`
      }
    }

    const importBtn = document.createElement('button')
    importBtn.type = 'button'
    importBtn.className = 'btn'
    importBtn.innerHTML = `${iconHtml('sync', 13)} <span>백업 가져오기</span>`

    const fileIn = document.createElement('input')
    fileIn.type = 'file'
    fileIn.accept = '.json'
    fileIn.hidden = true
    fileIn.onchange = async () => {
      const file = fileIn.files?.[0]
      if (!file) return
      try {
        const count = await importFromJson(file)
        alert(`총 ${count}개의 여행 기록을 성공적으로 복원했습니다!`)
        onDataImported?.()
        load()
      } catch (err) {
        alert(`가져오기 실패: ${err.message}`)
      }
    }
    importBtn.onclick = () => fileIn.click()

    btnGrid.append(jsonBtn, csvBtn, zipBtn, importBtn)
    backupSection.append(btnGrid, fileIn)

    if (usage) {
      const usageEl = document.createElement('div')
      usageEl.className = 'stats-usage'
      usageEl.textContent = `로컬 IndexedDB 캐시: 약 ${formatBytes(usage.usedBytes)} 사용 중`
      backupSection.append(usageEl)
    }

    wrap.append(backupSection)
  }

  load()
}
