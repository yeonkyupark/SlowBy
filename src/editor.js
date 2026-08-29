/**
 * SlowBy (슬로비) — 여행 기록 등록 및 수정 모달 (Travel Note Editor)
 */

import { CATEGORIES, WEATHERS, COMPANIONS, createTravelLogRecord } from './schema.js'
import { readExif, processImage, formatDateTimeLocal } from './photos.js'
import { saveTravelLog } from './store.js'
import { iconEl, iconHtml } from './icons.js'

export function openTravelEditor({
  file = null,
  initialData = null,
  mapView,
  onSaved,
  onCancelled,
}) {
  const isEditMode = Boolean(initialData && !file)

  let draft = initialData
    ? { ...initialData }
    : createTravelLogRecord({
        visitedAt: formatDateTimeLocal(new Date()),
      })

  let imageBlob = null
  let previewUrl = null
  let revokePreview = null

  const back = document.createElement('div')
  back.className = 'modal-back'
  const box = document.createElement('div')
  box.className = 'modal editor-modal'

  const cleanup = () => {
    revokePreview?.()
    back.remove()
    document.removeEventListener('keydown', onKey)
    onCancelled?.()
  }

  const onKey = (e) => {
    if (e.key === 'Escape') cleanup()
  }
  document.addEventListener('keydown', onKey)

  async function init() {
    if (file) {
      const [exif, processed] = await Promise.all([readExif(file), processImage(file)])
      imageBlob = processed.full
      draft.thumb = processed.thumb

      if (exif.latlng) {
        draft.lat = exif.latlng[0]
        draft.lng = exif.latlng[1]
        draft.locationSource = 'exif'
      }
      if (exif.visitedAt) draft.visitedAt = exif.visitedAt
      if (exif.address) draft.address = exif.address
      if (exif.region) draft.region = exif.region

      previewUrl = URL.createObjectURL(processed.thumb)
      revokePreview = () => URL.revokeObjectURL(previewUrl)

      if (!draft.lat || !draft.lng) {
        const picked = await promptLocationPick(file.name, exif, mapView)
        if (!picked) {
          cleanup()
          return
        }
        draft.lat = picked[0]
        draft.lng = picked[1]
        draft.locationSource = 'map'
      }
    } else if (initialData?.thumb) {
      previewUrl = URL.createObjectURL(initialData.thumb)
      revokePreview = () => URL.revokeObjectURL(previewUrl)
    } else if (initialData?.photo?.thumbUrl || initialData?.photo?.fullUrl) {
      previewUrl = initialData.photo.thumbUrl || initialData.photo.fullUrl
    }

    renderForm()
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

    // 사진 미리보기
    if (previewUrl) {
      const imgWrap = document.createElement('div')
      imgWrap.className = 'editor-preview-wrap'

      const ambientBg = document.createElement('div')
      ambientBg.className = 'editor-ambient-bg'
      ambientBg.style.backgroundImage = `url("${previewUrl}")`

      const img = document.createElement('img')
      img.src = previewUrl
      img.alt = '미리보기'
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          imgWrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`
        }
      }

      imgWrap.append(ambientBg, img)
      body.append(imgWrap)
    }

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

    // 3. 일시 및 위치 정보
    const dateLocRow = document.createElement('div')
    dateLocRow.className = 'form-grid-2'

    const dateField = document.createElement('label')
    dateField.className = 'form-row'
    dateField.innerHTML = `<span class="form-label">${iconHtml('calendar', 13)} 방문 일시</span>`
    const dateInput = document.createElement('input')
    dateInput.type = 'datetime-local'
    dateInput.value = draft.visitedAt || formatDateTimeLocal(new Date())
    dateField.append(dateInput)

    const locField = document.createElement('div')
    locField.className = 'form-row'
    locField.innerHTML = `<span class="form-label">${iconHtml('location', 13)} 위치 좌표</span>`
    const locBox = document.createElement('div')
    locBox.className = 'loc-display'
    const locText = document.createElement('span')
    locText.className = 'loc-text'
    locText.textContent = draft.lat && draft.lng
      ? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`
      : '위치 미지정'

    const pickBtn = document.createElement('button')
    pickBtn.type = 'button'
    pickBtn.className = 'btn-sm'
    pickBtn.innerHTML = `${iconHtml('map', 12)} 지도에서 변경`
    pickBtn.onclick = async () => {
      box.style.display = 'none'
      const loc = await mapView.pickLocation().promise
      box.style.display = ''
      if (loc) {
        draft.lat = loc[0]
        draft.lng = loc[1]
        locText.textContent = `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`
      }
    }
    locBox.append(locText, pickBtn)
    locField.append(locBox)

    dateLocRow.append(dateField, locField)
    body.append(dateLocRow)

    // 4. 주소 / 상세 위치명
    const addrRow = document.createElement('label')
    addrRow.className = 'form-row'
    addrRow.innerHTML = '<span class="form-label">주소 / 상세 지역</span>'
    const addrInput = document.createElement('input')
    addrInput.type = 'text'
    addrInput.placeholder = '예: 부산광역시 동구 중앙대로 225'
    addrInput.value = draft.address || ''
    addrRow.append(addrInput)
    body.append(addrRow)

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
      b.className = `opt-chip ${b.textContent === c.label ? 'is-selected' : ''}`
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

      saveBtn.disabled = true
      saveBtn.textContent = '저장 중…'

      try {
        const toSave = {
          ...draft,
          category: selectedCat,
          title: finalTitle,
          visitedAt: dateInput.value || formatDateTimeLocal(new Date()),
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
        }

        const saved = await saveTravelLog(toSave, imageBlob)
        onSaved?.(saved)
        cleanup()
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
    titleInput.focus()
  }

  init()
}

/** 위치가 없을 때 배너 띄우고 지도 클릭 유도 */
function promptLocationPick(fileName, exif, mapView) {
  return new Promise((resolve) => {
    const banner = document.createElement('div')
    banner.className = 'pick-location-banner'

    const bTitle = document.createElement('b')
    bTitle.innerHTML = `${iconHtml('location', 16)} 사진 위치를 지도에서 지정해주세요`
    banner.append(bTitle)

    const sub = document.createElement('span')
    sub.className = 'pick-sub'
    sub.textContent = `${fileName} 사진에 GPS 좌표가 없습니다. 지도에서 촬영 위치를 터치/클릭해주세요.`
    banner.append(sub)

    const btnRow = document.createElement('div')
    btnRow.className = 'banner-btn-row'

    const gpsBtn = document.createElement('button')
    gpsBtn.type = 'button'
    gpsBtn.className = 'btn-sm btn-gps'
    gpsBtn.innerHTML = `${iconHtml('crosshair', 14)} 현재 내 위치 사용`
    gpsBtn.onclick = () => {
      if (!navigator.geolocation) {
        alert('이 브라우저에서는 위치 서비스를 지원하지 않습니다.')
        return
      }
      gpsBtn.disabled = true
      gpsBtn.textContent = '위치 수신 중...'
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          banner.remove()
          picker.cancel()
          resolve([pos.coords.latitude, pos.coords.longitude])
        },
        (err) => {
          gpsBtn.disabled = false
          gpsBtn.innerHTML = `${iconHtml('crosshair', 14)} 현재 내 위치 사용`
          alert(`현재 위치를 가져올 수 없습니다: ${err.message}`)
        },
        { enableHighAccuracy: true, timeout: 10000 },
      )
    }

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'btn-sm'
    cancelBtn.textContent = '취소'
    cancelBtn.onclick = () => {
      banner.remove()
      picker.cancel()
      resolve(null)
    }

    btnRow.append(gpsBtn, cancelBtn)
    banner.append(btnRow)

    document.body.append(banner)
    const picker = mapView.pickLocation()
    picker.promise.then((latlng) => {
      banner.remove()
      resolve(latlng)
    })
  })
}
