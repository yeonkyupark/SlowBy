/**
 * SlowBy (슬로비) — 여행 기록 등록 및 수정 모달 (Travel Note Editor)
 *
 * 한 기록에 사진을 여러 장 담는다. 첫 장이 대표 사진이고, 위치·촬영일시는 대표 사진의
 * EXIF 에서 가져온다. 나머지 사진은 대표 위치를 함께 쓴다.
 */

import L from 'leaflet'
import {
  CATEGORIES,
  WEATHERS,
  COMPANIONS,
  MAX_PHOTOS,
  createTravelLogRecord,
  generateId,
  photoList,
  photoMirror,
} from './schema.js'
import { readExif, processImage, formatDateTimeLocal } from './photos.js'
import {
  saveTravelLog,
  getAllTravelLogs,
  getPhotoBlobs,
  savePhotoBlobs,
  deletePhotoBlobs,
} from './store.js'
import { TILE_PROVIDERS } from './map.js'
import { iconEl, iconHtml } from './icons.js'

const FALLBACK_CENTER = [35.8, 127.8]

/** 위치 출처별 표시. warn 은 사용자가 확인해야 하는 임시 위치다. */
const LOCATION_SOURCES = {
  exif: { label: '사진 GPS', warn: false },
  map: { label: '직접 지정', warn: false },
  gps: { label: '현재 기기 위치', warn: false },
  same_day_log: { label: '추정 위치 · 확인 필요', warn: true },
  estimated: { label: '추정 위치 · 확인 필요', warn: true },
}

const fmtCoord = (lat, lng) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`

/** "36.12, 128.38" 또는 "36.12 128.38" 형식을 읽는다. 범위를 벗어나면 null. */
function parseCoord(text) {
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lat, lng]
}

function currentPosition(timeout) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 서비스를 지원하지 않습니다.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      reject,
      { enableHighAccuracy: true, timeout },
    )
  })
}

/**
 * 사진에 GPS 가 없을 때의 임시 위치: 같은 날 기록 > 현재 기기 위치 > 지도 중심.
 * @returns {Promise<{latlng: number[], source: string, note: string, address?: string, region?: string}>}
 */
async function estimateLocation(visitedAt, mapView, excludeId) {
  const day = (visitedAt || '').slice(0, 10)
  if (day) {
    const logs = await getAllTravelLogs().catch(() => [])
    const same = logs.find(
      (l) => l.id !== excludeId && l.lat && l.lng && (l.visitedAt || '').startsWith(day),
    )
    if (same) {
      return {
        latlng: [same.lat, same.lng],
        source: 'same_day_log',
        note: `같은 날 기록 「${same.title || '제목 없음'}」의 위치를 임시로 넣었어요.`,
        address: same.address,
        region: same.region,
      }
    }
  }
  try {
    return {
      latlng: await currentPosition(3000),
      source: 'estimated',
      note: '현재 기기 위치를 임시로 넣었어요.',
    }
  } catch {
    return {
      latlng: mapView?.getCenter?.() || FALLBACK_CENTER,
      source: 'estimated',
      note: '지도 화면의 중심을 임시로 넣었어요.',
    }
  }
}

export function openTravelEditor({
  file = null,
  files = [],
  initialData = null,
  mapView,
  getPhotoUrl,
  onSaved,
  onCancelled,
}) {
  const newFiles = file ? [file] : files
  const isEditMode = Boolean(initialData && !newFiles.length)

  const draft = initialData
    ? { ...initialData }
    : createTravelLogRecord({ visitedAt: formatDateTimeLocal(new Date()) })

  /**
   * 편집 중인 사진들. 첫 장이 대표.
   * @type {Array<{id: string, remote: object|null, blob: Blob|null, thumb: Blob|null,
   *   src: string|null, thumbSrc: string|null, exif: object|null}>}
   */
  let photos = []
  let selected = 0
  /** 수정 시작 시점의 사진 — 저장할 때 무엇이 빠졌는지 비교한다. */
  const originalEntries = isEditMode ? photoList(initialData) : []

  /** 위치 상태. note 는 임시 위치일 때 그 근거. */
  const loc = {
    lat: Number(draft.lat) || 0,
    lng: Number(draft.lng) || 0,
    source: draft.locationSource || '',
    note: '',
  }

  const objectUrls = new Set()
  const objectUrl = (blob) => {
    if (!blob) return null
    const u = URL.createObjectURL(blob)
    objectUrls.add(u)
    return u
  }

  let miniMap = null

  const back = document.createElement('div')
  back.className = 'modal-back'
  const box = document.createElement('div')
  box.className = 'modal editor-modal'

  let closed = false
  const close = (saved) => {
    if (closed) return
    closed = true
    miniMap?.remove()
    for (const u of objectUrls) URL.revokeObjectURL(u)
    back.remove()
    document.removeEventListener('keydown', onKey)
    if (!saved) onCancelled?.()
  }
  const cleanup = () => close(false)

  const onKey = (e) => {
    if (e.key === 'Escape') cleanup()
  }
  document.addEventListener('keydown', onKey)

  async function photoFromFile(f) {
    const [exif, processed] = await Promise.all([readExif(f), processImage(f)])
    return {
      id: generateId(),
      remote: null,
      blob: processed.full,
      thumb: processed.thumb,
      src: objectUrl(processed.full),
      thumbSrc: objectUrl(processed.thumb),
      exif,
    }
  }

  async function photoFromEntry(entry, index) {
    const local = await getPhotoBlobs(entry.id).catch(() => null)
    // 이전 버전 데이터는 대표 썸네일이 기록 자체에 있다.
    const thumb = local?.thumb ?? (index === 0 ? initialData.thumb : null) ?? null
    const remoteFull = getPhotoUrl?.({ photo: entry }, 'full')
    const remoteThumb = getPhotoUrl?.({ photo: entry }, 'thumb')
    const thumbSrc = objectUrl(thumb) || remoteThumb || remoteFull
    return {
      id: entry.id,
      remote: entry,
      blob: local?.blob ?? null,
      thumb,
      src: objectUrl(local?.blob) || remoteFull || thumbSrc,
      thumbSrc,
      exif: null,
    }
  }

  /** 대표 사진이 GPS·촬영일시를 갖고 있으면 기록에 반영한다. 반영한 항목 이름을 돌려준다. */
  function applyCoverMeta() {
    const exif = photos[0]?.exif
    if (!exif) return []
    const applied = []
    if (exif.latlng) {
      setLocation(exif.latlng, 'exif')
      applied.push('위치')
    }
    if (exif.takenAt && exif.visitedAt) {
      draft.visitedAt = exif.visitedAt
      if (dateInput) dateInput.value = exif.visitedAt
      applied.push('촬영일시')
    }
    if (exif.address && !draft.address) {
      draft.address = exif.address
      if (addrInput) addrInput.value = exif.address
    }
    if (exif.region) draft.region = exif.region
    return applied
  }

  async function init() {
    if (isEditMode) {
      photos = await Promise.all(originalEntries.map(photoFromEntry))
    } else if (newFiles.length) {
      for (const f of newFiles.slice(0, MAX_PHOTOS)) photos.push(await photoFromFile(f))
      applyCoverMeta()
      if (!photos[0]?.exif?.latlng) {
        const est = await estimateLocation(draft.visitedAt, mapView, draft.id)
        setLocation(est.latlng, est.source, est.note)
        if (!draft.address && est.address) draft.address = est.address
        if (!draft.region && est.region) draft.region = est.region
      }
    }
    renderForm()
    if (newFiles.length > MAX_PHOTOS) {
      showPhotoNotice(`사진은 한 기록에 최대 ${MAX_PHOTOS}장까지라 앞의 ${MAX_PHOTOS}장만 담았어요.`)
    }
  }

  // ── 폼 요소 (renderForm 에서 만든다) ──
  let dateInput = null
  let addrInput = null
  let photoSection = null
  let photoNotice = null
  let locBadge = null
  let locNote = null
  let coordInput = null
  let coordHint = null
  let coverGpsBtn = null
  let marker = null

  function showPhotoNotice(text) {
    if (!photoNotice) return
    photoNotice.textContent = text
    photoNotice.hidden = !text
  }

  // ── 위치 ──

  function setLocation([lat, lng], source, note = '') {
    loc.lat = lat
    loc.lng = lng
    loc.source = source
    loc.note = note
    renderLocation()
  }

  function renderLocation() {
    if (!locBadge) return
    const has = Boolean(loc.lat || loc.lng)
    const meta = LOCATION_SOURCES[loc.source]

    locBadge.textContent = has ? meta?.label || '지정됨' : '미지정'
    locBadge.classList.toggle('is-warn', !has || Boolean(meta?.warn))

    const noteText =
      has && meta?.warn
        ? `사진에 GPS 정보가 없어 ${loc.note || '추정한 위치를 넣었어요.'} 지도를 탭하거나 핀을 끌어 실제 위치로 맞춰주세요.`
        : !has
          ? '지도를 탭해서 위치를 지정해주세요.'
          : ''
    locNote.hidden = !noteText
    if (noteText) {
      const text = document.createElement('span')
      text.textContent = noteText
      locNote.replaceChildren(iconEl('location', 13), text)
    }

    if (document.activeElement !== coordInput) {
      coordInput.value = has ? fmtCoord(loc.lat, loc.lng) : ''
    }
    coordInput.classList.remove('is-invalid')
    coordHint.textContent = '지도를 탭하거나 핀을 끌어서 옮길 수 있어요. 좌표를 붙여넣어도 돼요.'

    const coverGps = photos[0]?.exif?.latlng
    coverGpsBtn.hidden = !(
      coverGps &&
      (loc.source !== 'exif' || coverGps[0] !== loc.lat || coverGps[1] !== loc.lng)
    )

    if (miniMap && has) {
      if (marker) marker.setLatLng([loc.lat, loc.lng])
      else marker = makeMarker([loc.lat, loc.lng]).addTo(miniMap)
      if (!miniMap.getBounds().pad(-0.15).contains([loc.lat, loc.lng])) {
        miniMap.setView([loc.lat, loc.lng], Math.max(miniMap.getZoom(), 15))
      }
    }
  }

  function makeMarker(latlng) {
    const m = L.marker(latlng, {
      draggable: true,
      autoPan: true,
      icon: L.divIcon({
        className: 'loc-pin-icon',
        html: '<div class="loc-pin"></div>',
        iconSize: [28, 38],
        iconAnchor: [14, 36],
      }),
    })
    m.on('dragend', () => {
      const p = m.getLatLng()
      setLocation([p.lat, p.lng], 'map')
    })
    return m
  }

  function mountMiniMap(el) {
    const has = Boolean(loc.lat || loc.lng)
    const tile = TILE_PROVIDERS['일반']
    miniMap = L.map(el, {
      center: has ? [loc.lat, loc.lng] : mapView?.getCenter?.() || FALLBACK_CENTER,
      zoom: has ? 16 : 7,
      scrollWheelZoom: false, // 모달 스크롤을 지도가 가로채지 않게
      attributionControl: false,
    })
    L.tileLayer(tile.url, { maxZoom: tile.maxZoom }).addTo(miniMap)
    if (has) marker = makeMarker([loc.lat, loc.lng]).addTo(miniMap)
    miniMap.on('click', (e) => setLocation([e.latlng.lat, e.latlng.lng], 'map'))
    // 모달 등장 애니메이션이 끝난 뒤 크기를 다시 잰다.
    setTimeout(() => miniMap?.invalidateSize(), 250)
  }

  function buildLocationSection() {
    const section = document.createElement('div')
    section.className = 'form-section loc-section'

    const label = document.createElement('div')
    label.className = 'form-label'
    label.innerHTML = `${iconHtml('location', 13)} 위치`
    locBadge = document.createElement('span')
    locBadge.className = 'loc-badge'
    label.append(locBadge)

    locNote = document.createElement('div')
    locNote.className = 'rough-location-tip'
    locNote.hidden = true

    const mapWrap = document.createElement('div')
    mapWrap.className = 'loc-map-wrap'
    const mapEl = document.createElement('div')
    mapEl.className = 'loc-map'
    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'loc-map-expand'
    expandBtn.textContent = '크게 보기'
    expandBtn.onclick = () => {
      const big = mapWrap.classList.toggle('is-expanded')
      expandBtn.textContent = big ? '작게 보기' : '크게 보기'
      setTimeout(() => {
        miniMap?.invalidateSize()
        if (loc.lat || loc.lng) miniMap?.panTo([loc.lat, loc.lng])
      }, 220)
    }
    mapWrap.append(mapEl, expandBtn)

    const toolRow = document.createElement('div')
    toolRow.className = 'loc-tools'

    coordInput = document.createElement('input')
    coordInput.type = 'text'
    coordInput.inputMode = 'decimal'
    coordInput.className = 'loc-coord-input'
    coordInput.placeholder = '위도, 경도'
    coordInput.setAttribute('aria-label', '위도, 경도')
    const commitCoord = () => {
      const v = parseCoord(coordInput.value)
      if (v) {
        setLocation(v, 'map')
        miniMap?.setView(v, Math.max(miniMap.getZoom(), 15))
      } else if (coordInput.value.trim()) {
        coordInput.classList.add('is-invalid')
        coordHint.textContent = '형식을 확인해주세요. 예: 36.125789, 128.381009'
      } else {
        renderLocation()
      }
    }
    coordInput.onchange = commitCoord
    coordInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        coordInput.blur()
      }
    }

    const gpsBtn = document.createElement('button')
    gpsBtn.type = 'button'
    gpsBtn.className = 'btn-sm loc-tool-btn'
    gpsBtn.innerHTML = `${iconHtml('crosshair', 13)} 내 위치`
    gpsBtn.onclick = async () => {
      gpsBtn.disabled = true
      try {
        const p = await currentPosition(10000)
        setLocation(p, 'gps')
        miniMap?.setView(p, 16)
      } catch (err) {
        coordHint.textContent = `현재 위치를 가져오지 못했어요: ${err.message}`
      } finally {
        gpsBtn.disabled = false
      }
    }

    coverGpsBtn = document.createElement('button')
    coverGpsBtn.type = 'button'
    coverGpsBtn.className = 'btn-sm loc-tool-btn'
    coverGpsBtn.innerHTML = `${iconHtml('camera', 13)} 사진 위치로`
    coverGpsBtn.hidden = true
    coverGpsBtn.onclick = () => {
      const p = photos[0]?.exif?.latlng
      if (!p) return
      setLocation(p, 'exif')
      miniMap?.setView(p, 16)
    }

    toolRow.append(coordInput, gpsBtn, coverGpsBtn)

    coordHint = document.createElement('div')
    coordHint.className = 'loc-hint'

    // 주소 / 상세 지역
    const addrRow = document.createElement('label')
    addrRow.className = 'form-row'
    addrRow.innerHTML = '<span class="form-label">주소 / 상세 지역</span>'
    addrInput = document.createElement('input')
    addrInput.type = 'text'
    addrInput.placeholder = '예: 부산광역시 동구 중앙대로 225'
    addrInput.value = draft.address || ''
    addrRow.append(addrInput)

    section.append(label, locNote, mapWrap, toolRow, coordHint, addrRow)
    return { section, mapEl }
  }

  // ── 사진 ──

  const addInput = document.createElement('input')
  addInput.type = 'file'
  addInput.accept = 'image/*'
  addInput.multiple = true
  addInput.hidden = true

  const replaceInput = document.createElement('input')
  replaceInput.type = 'file'
  replaceInput.accept = 'image/*'
  replaceInput.hidden = true

  /** 대표 사진이 바뀌었을 때 그 사진 정보로 위치·일시를 갱신하고 알린다. */
  function onCoverChanged(prevCoverId) {
    if (photos[0]?.id === prevCoverId) return
    const applied = applyCoverMeta()
    showPhotoNotice(
      applied.length
        ? `대표 사진의 ${applied.join('·')}로 바꿨어요.`
        : photos[0]?.exif
          ? '새 대표 사진에 GPS 정보가 없어 위치는 그대로 두었어요.'
          : '',
    )
  }

  async function withBusy(task) {
    photoSection.classList.add('is-busy')
    try {
      await task()
    } catch (err) {
      showPhotoNotice(`사진을 읽지 못했어요: ${err.message}`)
    } finally {
      photoSection.classList.remove('is-busy')
      renderPhotos()
    }
  }

  addInput.onchange = () => {
    const picked = Array.from(addInput.files || [])
    addInput.value = ''
    if (!picked.length) return
    const room = MAX_PHOTOS - photos.length
    const prevCover = photos[0]?.id
    withBusy(async () => {
      for (const f of picked.slice(0, room)) photos.push(await photoFromFile(f))
      selected = photos.length - 1
      onCoverChanged(prevCover)
      if (picked.length > room) {
        showPhotoNotice(`사진은 최대 ${MAX_PHOTOS}장이라 ${picked.length - room}장은 빠졌어요.`)
      }
    })
  }

  replaceInput.onchange = () => {
    const f = replaceInput.files?.[0]
    replaceInput.value = ''
    if (!f) return
    const prevCover = photos[0]?.id
    const index = selected
    withBusy(async () => {
      photos[index] = await photoFromFile(f)
      onCoverChanged(prevCover)
    })
  }

  function renderPhotos() {
    photoSection.textContent = ''
    const count = photos.length

    if (!count) {
      const empty = document.createElement('button')
      empty.type = 'button'
      empty.className = 'photo-empty'
      empty.innerHTML = `${iconHtml('camera', 22)}<span>사진 추가</span>`
      empty.onclick = () => addInput.click()
      photoSection.append(empty)
    } else {
      selected = Math.min(selected, count - 1)
      const cur = photos[selected]

      // 선택한 사진 크게 보기
      const imgWrap = document.createElement('div')
      imgWrap.className = 'editor-preview-wrap'
      const ambientBg = document.createElement('div')
      ambientBg.className = 'editor-ambient-bg'
      if (cur.src) ambientBg.style.backgroundImage = `url("${cur.src}")`
      const img = document.createElement('img')
      img.src = cur.src || ''
      img.alt = `사진 ${selected + 1}`
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          imgWrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`
        }
      }
      imgWrap.append(ambientBg, img)
      if (selected === 0) {
        const cover = document.createElement('span')
        cover.className = 'photo-cover-badge'
        cover.textContent = '대표 사진'
        imgWrap.append(cover)
      }
      if (count > 1) {
        const counter = document.createElement('span')
        counter.className = 'photo-counter'
        counter.textContent = `${selected + 1} / ${count}`
        imgWrap.append(counter)
      }
      photoSection.append(imgWrap)

      // 선택한 사진 동작
      const actions = document.createElement('div')
      actions.className = 'photo-actions'
      const mkAction = (icon, text, fn, cls = '') => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = `btn-sm ${cls}`.trim()
        b.innerHTML = `${iconHtml(icon, 13)} <span>${text}</span>`
        b.onclick = fn
        return b
      }
      actions.append(mkAction('sync', '사진 교체', () => replaceInput.click()))
      if (selected > 0) {
        actions.append(
          mkAction('star', '대표로 지정', () => {
            const prevCover = photos[0].id
            const [p] = photos.splice(selected, 1)
            photos.unshift(p)
            selected = 0
            onCoverChanged(prevCover)
            renderPhotos()
          }),
        )
      }
      actions.append(
        mkAction(
          'trash',
          '삭제',
          () => {
            const prevCover = photos[0].id
            photos.splice(selected, 1)
            selected = Math.max(0, selected - 1)
            onCoverChanged(prevCover)
            renderPhotos()
          },
          'is-danger',
        ),
      )
      photoSection.append(actions)
    }

    // 썸네일 줄
    if (count) {
      const strip = document.createElement('div')
      strip.className = 'photo-strip'
      photos.forEach((p, i) => {
        const t = document.createElement('button')
        t.type = 'button'
        t.className = `photo-tile${i === selected ? ' is-selected' : ''}`
        t.title = i === 0 ? '대표 사진' : `사진 ${i + 1}`
        if (p.thumbSrc) {
          const im = document.createElement('img')
          im.src = p.thumbSrc
          im.alt = ''
          t.append(im)
        }
        if (i === 0) {
          const b = document.createElement('span')
          b.className = 'photo-tile-badge'
          b.textContent = '대표'
          t.append(b)
        }
        t.onclick = () => {
          selected = i
          renderPhotos()
        }
        strip.append(t)
      })
      if (count < MAX_PHOTOS) {
        const add = document.createElement('button')
        add.type = 'button'
        add.className = 'photo-tile photo-tile-add'
        add.title = '사진 추가'
        add.innerHTML = `${iconHtml('plus', 18)}<span>${count}/${MAX_PHOTOS}</span>`
        add.onclick = () => addInput.click()
        strip.append(add)
      }
      photoSection.append(strip)
    }

    const hint = document.createElement('div')
    hint.className = 'photo-hint'
    hint.textContent = '첫 번째 사진이 대표 사진이에요. 위치와 촬영일시는 대표 사진에서 가져와요.'
    photoSection.append(hint)

    photoNotice.remove()
    photoSection.append(photoNotice)
  }

  function renderForm() {
    box.textContent = ''

    // 헤더
    const head = document.createElement('div')
    head.className = 'modal-head'

    const titleWrap = document.createElement('div')
    titleWrap.className = 'modal-title-wrap'
    const editIcon = iconEl(isEditMode ? 'edit' : 'camera', 18)
    const title = document.createElement('b')
    title.textContent = isEditMode ? '여행 기록 수정' : '새 여행 기록'
    titleWrap.append(editIcon, title)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'modal-x icon-btn'
    closeBtn.append(iconEl('close', 18))
    closeBtn.onclick = cleanup

    head.append(titleWrap, closeBtn)
    box.append(head)

    const body = document.createElement('div')
    body.className = 'editor-body'

    // 사진
    photoSection = document.createElement('div')
    photoSection.className = 'photo-editor'
    photoNotice = document.createElement('div')
    photoNotice.className = 'photo-notice'
    photoNotice.hidden = true
    body.append(photoSection, addInput, replaceInput)
    renderPhotos()

    // 1. 카테고리 선택 칩
    const catGroup = document.createElement('div')
    catGroup.className = 'form-section'
    const catLabel = document.createElement('div')
    catLabel.className = 'form-label'
    catLabel.textContent = '카테고리 (범주)'
    const chipsWrap = document.createElement('div')
    chipsWrap.className = 'category-chips'

    let selectedCat = draft.category || 'spot'

    for (const [key, cat] of Object.entries(CATEGORIES)) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = `cat-chip ${key === selectedCat ? 'is-selected' : ''}`
      chip.style.setProperty('--chip-color', cat.color)
      chip.style.setProperty('--chip-bg', cat.bg)
      chip.innerHTML = `${iconHtml(cat.icon, 14)} <span>${cat.label}</span>`
      chip.onclick = () => {
        selectedCat = key
        chipsWrap.querySelectorAll('.cat-chip').forEach((c) => c.classList.remove('is-selected'))
        chip.classList.add('is-selected')
      }
      chipsWrap.append(chip)
    }
    catGroup.append(catLabel, chipsWrap)
    body.append(catGroup)

    // 2. 제목 / 장소명
    const titleRow = document.createElement('label')
    titleRow.className = 'form-row'
    titleRow.innerHTML = '<span class="form-label">장소명 / 제목 <b class="req">*</b></span>'
    const titleInput = document.createElement('input')
    titleInput.type = 'text'
    titleInput.maxLength = 100
    titleInput.placeholder = '예: 해금강 바람의 언덕, 초량 밀면 본점'
    titleInput.value = draft.title || ''
    titleRow.append(titleInput)
    body.append(titleRow)

    // 3. 방문 일시
    const dateField = document.createElement('label')
    dateField.className = 'form-row'
    dateField.innerHTML = `<span class="form-label">${iconHtml('calendar', 13)} 방문 일시</span>`
    dateInput = document.createElement('input')
    dateInput.type = 'datetime-local'
    dateInput.value = draft.visitedAt || formatDateTimeLocal(new Date())
    dateField.append(dateInput)
    body.append(dateField)

    // 4. 위치 (지도 + 좌표 + 주소)
    const { section: locSection, mapEl } = buildLocationSection()
    body.append(locSection)

    // 5. 별점 평가 (1 ~ 5)
    const ratingRow = document.createElement('div')
    ratingRow.className = 'form-row'
    ratingRow.innerHTML = '<span class="form-label">평점 (별점)</span>'
    const starsWrap = document.createElement('div')
    starsWrap.className = 'stars-picker'

    let rating = draft.rating || 0
    const starBtns = []

    for (let i = 1; i <= 5; i++) {
      const sBtn = document.createElement('button')
      sBtn.type = 'button'
      sBtn.className = `star-btn ${i <= rating ? 'is-active' : ''}`
      sBtn.innerHTML = iconHtml('star', 24)
      sBtn.onclick = () => {
        rating = rating === i ? 0 : i
        starBtns.forEach((b, idx) => b.classList.toggle('is-active', idx < rating))
      }
      starBtns.push(sBtn)
      starsWrap.append(sBtn)
    }
    ratingRow.append(starsWrap)
    body.append(ratingRow)

    // 6. 여행 메모
    const memoRow = document.createElement('label')
    memoRow.className = 'form-row'
    memoRow.innerHTML = '<span class="form-label">여행 메모 / 리뷰</span>'
    const memoInput = document.createElement('textarea')
    memoInput.rows = 4
    memoInput.maxLength = 2000
    memoInput.placeholder = '방문 소감, 추천 팁, 기억에 남는 순간을 자유롭게 남겨보세요.'
    memoInput.value = draft.memo || ''
    memoRow.append(memoInput)
    body.append(memoRow)

    // 7. 추가 메타데이터 (아코디언)
    const extraDetails = document.createElement('details')
    extraDetails.className = 'editor-extra'
    extraDetails.innerHTML = `<summary>${iconHtml('tag', 13)} 상세 정보 (비용, 날씨, 동행, 태그)</summary>`

    const extraBody = document.createElement('div')
    extraBody.className = 'extra-body'

    // 비용 & 동행
    const extraGrid = document.createElement('div')
    extraGrid.className = 'form-grid-2'

    const costField = document.createElement('label')
    costField.className = 'form-row'
    costField.innerHTML = `<span class="form-label">${iconHtml('wallet', 13)} 지출 비용 (KRW)</span>`
    const costInput = document.createElement('input')
    costInput.type = 'number'
    costInput.min = '0'
    costInput.step = '1000'
    costInput.placeholder = '예: 18000'
    costInput.value = draft.cost != null ? draft.cost : ''
    costField.append(costInput)

    const compField = document.createElement('div')
    compField.className = 'form-row'
    compField.innerHTML = `<span class="form-label">${iconHtml('users', 13)} 동행</span>`
    const compWrap = document.createElement('div')
    compWrap.className = 'option-chips'
    let selectedCompanion = draft.companion || ''
    for (const c of COMPANIONS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `opt-chip ${c.label === selectedCompanion ? 'is-selected' : ''}`
      b.textContent = c.label
      b.onclick = () => {
        selectedCompanion = selectedCompanion === c.label ? '' : c.label
        compWrap.querySelectorAll('.opt-chip').forEach((el) => el.classList.toggle('is-selected', el.textContent === selectedCompanion))
      }
      compWrap.append(b)
    }
    compField.append(compWrap)
    extraGrid.append(costField, compField)
    extraBody.append(extraGrid)

    // 날씨
    const weatherField = document.createElement('div')
    weatherField.className = 'form-row'
    weatherField.innerHTML = `<span class="form-label">${iconHtml('sun', 13)} 날씨</span>`
    const weatherWrap = document.createElement('div')
    weatherWrap.className = 'option-chips'
    let selectedWeather = draft.weather || ''
    for (const w of WEATHERS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `opt-chip ${w.label === selectedWeather ? 'is-selected' : ''}`
      b.innerHTML = `${iconHtml(w.icon, 13)} <span>${w.label}</span>`
      b.onclick = () => {
        selectedWeather = selectedWeather === w.label ? '' : w.label
        weatherWrap.querySelectorAll('.opt-chip').forEach((el) => el.classList.toggle('is-selected', el.textContent.includes(selectedWeather) && Boolean(selectedWeather)))
      }
      weatherWrap.append(b)
    }
    weatherField.append(weatherWrap)
    extraBody.append(weatherField)

    // 태그
    const tagField = document.createElement('label')
    tagField.className = 'form-row'
    tagField.innerHTML = '<span class="form-label">해시태그 (쉼표로 구분)</span>'
    const tagInput = document.createElement('input')
    tagInput.type = 'text'
    tagInput.placeholder = '오션뷰, 인생샷, 일몰명소'
    tagInput.value = Array.isArray(draft.tags) ? draft.tags.join(', ') : draft.tags || ''
    tagField.append(tagInput)
    extraBody.append(tagField)

    extraDetails.append(extraBody)
    body.append(extraDetails)

    box.append(body)

    // 푸터 버튼
    const foot = document.createElement('div')
    foot.className = 'modal-foot'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'btn'
    cancelBtn.textContent = '취소'
    cancelBtn.onclick = cleanup

    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'btn btn-primary'
    saveBtn.textContent = isEditMode ? '수정 완료' : '기록 저장'

    saveBtn.onclick = async () => {
      const finalTitle = titleInput.value.trim()
      if (!finalTitle) {
        titleInput.focus()
        alert('장소명 또는 제목을 입력해주세요.')
        return
      }
      if (photoSection.classList.contains('is-busy')) return

      saveBtn.disabled = true
      saveBtn.textContent = '저장 중…'

      try {
        const entries = photos.map((p) => (p.remote ? { ...p.remote } : { id: p.id }))
        const keptIds = new Set(photos.map((p) => p.id))
        const removed = originalEntries.filter((e) => !keptIds.has(e.id))
        const removedPaths = removed.flatMap((e) => [e.full, e.thumb]).filter(Boolean)

        const toSave = {
          ...draft,
          category: selectedCat,
          title: finalTitle,
          visitedAt: dateInput.value || formatDateTimeLocal(new Date()),
          lat: loc.lat,
          lng: loc.lng,
          locationSource: loc.source || 'map',
          address: addrInput.value.trim(),
          rating,
          memo: memoInput.value.trim(),
          cost: costInput.value ? Number(costInput.value) : null,
          companion: selectedCompanion,
          weather: selectedWeather,
          tags: tagInput.value
            .split(',')
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean),
          photos: entries,
          photo: photoMirror(entries[0]),
          thumb: photos[0]?.thumb || null,
          pendingDeletes: [...new Set([...(draft.pendingDeletes ?? []), ...removedPaths])],
        }

        // 사진 Blob 먼저 — 기록이 가리키는 사진이 로컬에 없는 순간이 없도록.
        await savePhotoBlobs(
          photos
            .filter((p) => p.blob || p.thumb)
            .map((p) => ({ id: p.id, blob: p.blob, thumb: p.thumb })),
        )
        const saved = await saveTravelLog(toSave)
        await deletePhotoBlobs(removed.map((e) => e.id))
        close(true)
        onSaved?.(saved)
      } catch (err) {
        saveBtn.disabled = false
        saveBtn.textContent = isEditMode ? '수정 완료' : '기록 저장'
        alert(`저장 중 오류가 발생했습니다: ${err.message}`)
      }
    }

    foot.append(cancelBtn, saveBtn)
    box.append(foot)

    back.append(box)
    back.onclick = (e) => {
      if (e.target === back) cleanup()
    }
    document.body.append(back)

    mountMiniMap(mapEl)
    renderLocation()
    if (!isEditMode) titleInput.focus()
  }

  init()
}
