/**
 * SlowBy (슬로비) — 여행 기록 상세 뷰어 및 갤러리 모달 (Ambient Backdrop & Dynamic Aspect Ratio)
 */

import { CATEGORIES } from './schema.js'
import { getTravelPhotoBlob, deleteTravelLog } from './store.js'
import { iconEl, iconHtml } from './icons.js'

export function openTravelViewer({
  log,
  allLogs = [],
  isAdmin = false,
  mapView,
  onEdit,
  onDeleted,
  getPhotoUrl,
}) {
  const logsList = allLogs.length ? allLogs : [log]
  let currentIndex = logsList.findIndex((l) => l.id === log.id)
  if (currentIndex < 0) currentIndex = 0

  const back = document.createElement('div')
  back.className = 'modal-back'
  const box = document.createElement('div')
  box.className = 'modal viewer-modal'

  let currentBlobUrl = null
  let isCoverMode = false // false: contain (원본 비율 맞춤), true: cover (화면 꽉 채우기)

  const cleanup = () => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    back.remove()
    document.removeEventListener('keydown', onKey)
  }

  const onKey = (e) => {
    if (e.key === 'Escape') cleanup()
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
  }
  document.addEventListener('keydown', onKey)

  const step = (dir) => {
    if (logsList.length <= 1) return
    currentIndex = (currentIndex + dir + logsList.length) % logsList.length
    renderCurrent()
  }

  async function renderCurrent() {
    box.textContent = ''
    const currentLog = logsList[currentIndex]
    const cat = CATEGORIES[currentLog.category] || CATEGORIES.spot

    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }

    // 헤더
    const head = document.createElement('div')
    head.className = 'modal-head'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'viewer-title-wrap'
    const catBadge = document.createElement('span')
    catBadge.className = 'cat-pill'
    catBadge.style.backgroundColor = cat.bg
    catBadge.style.color = cat.color
    catBadge.style.borderColor = cat.border
    catBadge.innerHTML = `${iconHtml(cat.icon, 13)} <span>${cat.label}</span>`

    const titleText = document.createElement('b')
    titleText.textContent = currentLog.title || '제목 없음'
    titleWrap.append(catBadge, titleText)

    const navWrap = document.createElement('div')
    navWrap.className = 'viewer-nav-wrap'
    if (logsList.length > 1) {
      const pageInfo = document.createElement('span')
      pageInfo.className = 'viewer-counter'
      pageInfo.textContent = `${currentIndex + 1} / ${logsList.length}`
      navWrap.append(pageInfo)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'modal-x icon-btn'
    closeBtn.append(iconEl('close', 18))
    closeBtn.onclick = cleanup
    navWrap.append(closeBtn)

    head.append(titleWrap, navWrap)
    box.append(head)

    // 미디어 영역 (앰비언트 블러 배경 + 원본 비율 사진 + 토글 컨트롤)
    const mediaWrap = document.createElement('div')
    mediaWrap.className = `viewer-media ${isCoverMode ? 'is-cover-mode' : 'is-contain-mode'}`

    // 1. 앰비언트 블러 배경 레이어
    const ambientBg = document.createElement('div')
    ambientBg.className = 'viewer-ambient-bg'
    mediaWrap.append(ambientBg)

    // 2. 메인 사진 이미지
    const img = document.createElement('img')
    img.className = 'viewer-img'
    img.alt = currentLog.title || '여행 사진'

    const photoBlob = await getTravelPhotoBlob(currentLog.id)
    let photoSrc = null
    if (photoBlob) {
      currentBlobUrl = URL.createObjectURL(photoBlob)
      photoSrc = currentBlobUrl
    } else if (currentLog.thumb) {
      currentBlobUrl = URL.createObjectURL(currentLog.thumb)
      photoSrc = currentBlobUrl
    } else {
      photoSrc = getPhotoUrl?.(currentLog, 'full') || getPhotoUrl?.(currentLog, 'thumb')
    }

    if (photoSrc) {
      ambientBg.style.backgroundImage = `url("${photoSrc}")`
      img.src = photoSrc
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight && !isCoverMode) {
          mediaWrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`
        }
      }
      mediaWrap.append(img)

      // 비율 토글 버튼 (전체 맞춤 ↔ 화면 꽉 채우기)
      const toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      toggleBtn.className = 'media-fit-toggle'
      toggleBtn.title = isCoverMode ? '원본 비율로 보기' : '화면에 꽉 채우기'
      toggleBtn.innerHTML = isCoverMode
        ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
        : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`

      toggleBtn.onclick = (e) => {
        e.stopPropagation()
        isCoverMode = !isCoverMode
        mediaWrap.classList.toggle('is-cover-mode', isCoverMode)
        mediaWrap.classList.toggle('is-contain-mode', !isCoverMode)
        if (isCoverMode) {
          mediaWrap.style.aspectRatio = ''
        } else if (img.naturalWidth && img.naturalHeight) {
          mediaWrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`
        }
        toggleBtn.title = isCoverMode ? '원본 비율로 보기' : '화면에 꽉 채우기'
      }
      mediaWrap.append(toggleBtn)
    } else {
      mediaWrap.classList.add('no-photo')
      mediaWrap.innerHTML = `<div class="media-placeholder" style="color: ${cat.color}">${iconHtml(cat.icon, 48)}</div>`
    }

    // 좌우 내비게이션 화살표
    if (logsList.length > 1) {
      const prevBtn = document.createElement('button')
      prevBtn.className = 'viewer-arrow viewer-prev'
      prevBtn.append(iconEl('chevronLeft', 20))
      prevBtn.onclick = (e) => {
        e.stopPropagation()
        step(-1)
      }

      const nextBtn = document.createElement('button')
      nextBtn.className = 'viewer-arrow viewer-next'
      nextBtn.append(iconEl('chevronRight', 20))
      nextBtn.onclick = (e) => {
        e.stopPropagation()
        step(1)
      }

      mediaWrap.append(prevBtn, nextBtn)
    }
    box.append(mediaWrap)

    // 상세 본문 영역
    const body = document.createElement('div')
    body.className = 'viewer-body'

    // 메타 정보 바
    const metaBar = document.createElement('div')
    metaBar.className = 'viewer-metabar'

    if (currentLog.visitedAt) {
      const d = new Date(currentLog.visitedAt)
      const dateStr = Number.isNaN(+d)
        ? currentLog.visitedAt
        : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      const dateEl = document.createElement('span')
      dateEl.className = 'viewer-meta-item'
      dateEl.innerHTML = `${iconHtml('calendar', 13)} <span>${dateStr}</span>`
      metaBar.append(dateEl)
    }

    if (currentLog.rating > 0) {
      const ratingEl = document.createElement('span')
      ratingEl.className = 'viewer-meta-item is-rating'
      let starIcons = ''
      for (let i = 0; i < 5; i++) {
        starIcons += i < currentLog.rating ? iconHtml('star', 14) : iconHtml('starOutline', 14)
      }
      ratingEl.innerHTML = starIcons
      metaBar.append(ratingEl)
    }

    if (currentLog.address) {
      const addrEl = document.createElement('span')
      addrEl.className = 'viewer-meta-item'
      addrEl.innerHTML = `${iconHtml('location', 13)} <span>${currentLog.address}</span>`
      metaBar.append(addrEl)
    }

    body.append(metaBar)

    // 추가 칩 (비용, 날씨, 동행)
    const chipsBar = document.createElement('div')
    chipsBar.className = 'viewer-chips'

    if (currentLog.cost != null) {
      const costChip = document.createElement('span')
      costChip.className = 'v-chip'
      costChip.innerHTML = `${iconHtml('wallet', 12)} <span>₩${Number(currentLog.cost).toLocaleString()}</span>`
      chipsBar.append(costChip)
    }
    if (currentLog.weather) {
      const weatherChip = document.createElement('span')
      weatherChip.className = 'v-chip'
      weatherChip.innerHTML = `${iconHtml('sun', 12)} <span>${currentLog.weather}</span>`
      chipsBar.append(weatherChip)
    }
    if (currentLog.companion) {
      const compChip = document.createElement('span')
      compChip.className = 'v-chip'
      compChip.innerHTML = `${iconHtml('users', 12)} <span>${currentLog.companion}</span>`
      chipsBar.append(compChip)
    }
    if (chipsBar.children.length) body.append(chipsBar)

    // 해시태그
    if (Array.isArray(currentLog.tags) && currentLog.tags.length) {
      const tagsWrap = document.createElement('div')
      tagsWrap.className = 'viewer-tags'
      for (const t of currentLog.tags) {
        const tag = document.createElement('span')
        tag.className = 'v-tag'
        tag.textContent = `#${t}`
        tagsWrap.append(tag)
      }
      body.append(tagsWrap)
    }

    // 메모 본문
    if (currentLog.memo) {
      const memoBox = document.createElement('div')
      memoBox.className = 'viewer-memo'
      memoBox.textContent = currentLog.memo
      body.append(memoBox)
    }

    box.append(body)

    // 푸터 (관리자일 때만 수정/삭제 노출)
    const foot = document.createElement('div')
    foot.className = 'modal-foot'

    if (isAdmin) {
      const delBtn = document.createElement('button')
      delBtn.type = 'button'
      delBtn.className = 'btn btn-danger'
      delBtn.innerHTML = `${iconHtml('trash', 14)} <span>삭제</span>`
      delBtn.onclick = async () => {
        if (!confirm(`"${currentLog.title || '이 기록'}"을 삭제할까요?`)) return
        await deleteTravelLog(currentLog.id)
        onDeleted?.(currentLog.id)
        cleanup()
      }

      const editBtn = document.createElement('button')
      editBtn.type = 'button'
      editBtn.className = 'btn btn-primary'
      editBtn.innerHTML = `${iconHtml('edit', 14)} <span>수정</span>`
      editBtn.onclick = () => {
        cleanup()
        onEdit?.(currentLog)
      }

      foot.append(delBtn, editBtn)
    } else {
      const shareBtn = document.createElement('button')
      shareBtn.type = 'button'
      shareBtn.className = 'btn'
      shareBtn.innerHTML = `${iconHtml('location', 14)} <span>지도 위치로 이동</span>`
      shareBtn.onclick = () => {
        if (currentLog.lat && currentLog.lng) {
          mapView.panTo([currentLog.lat, currentLog.lng], 16)
        }
        cleanup()
      }
      foot.append(shareBtn)
    }

    box.append(foot)

    if (currentLog.lat && currentLog.lng) {
      mapView.panTo([currentLog.lat, currentLog.lng])
    }
  }

  back.append(box)
  back.onclick = (e) => {
    if (e.target === back) cleanup()
  }
  document.body.append(back)

  renderCurrent()
}
