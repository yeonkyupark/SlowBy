/**
 * SlowBy (슬로비) — 저장소 및 관리자 인증(GitHub PAT) 설정 모듈
 */

import { iconEl, iconHtml } from './icons.js'

const STORAGE_KEY = 'slowby.sync_settings'

export const DEFAULT_SETTINGS = {
  owner: 'yeonkyupark',
  repo: 'SlowBy',
  photoRepo: 'photo-repo',
  photoPrefix: 'travel',
  branch: 'main',
  token: '',
  tokenSetAt: '',
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  return merged
}

export function isAdminAuthenticated(settings = loadSettings()) {
  return Boolean(settings.token && settings.token.trim().length > 0)
}

/**
 * 관리자 설정 모달 열기
 */
export function openSettingsModal({ onSave, onCheck }) {
  const current = loadSettings()

  const back = document.createElement('div')
  back.className = 'modal-back'
  const box = document.createElement('div')
  box.className = 'modal settings-modal'

  const cleanup = () => {
    back.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup()
  }
  document.addEventListener('keydown', onKey)

  const head = document.createElement('div')
  head.className = 'modal-head'
  const titleWrap = document.createElement('div')
  titleWrap.className = 'modal-title-wrap'
  titleWrap.innerHTML = `${iconHtml('settings', 18)} <b>저장소 및 관리자 설정</b>`

  const closeBtn = document.createElement('button')
  closeBtn.className = 'modal-x icon-btn'
  closeBtn.append(iconEl('close', 18))
  closeBtn.onclick = cleanup
  head.append(titleWrap, closeBtn)

  const body = document.createElement('div')
  body.className = 'settings-body'

  const desc = document.createElement('p')
  desc.className = 'settings-intro'
  desc.textContent =
    '슬로비(SlowBy)는 서버 없이 GitHub을 저장소로 사용합니다. 사진은 photo-repo에, 여행 데이터는 SlowBy 리포에 안전하게 저장됩니다.'
  body.append(desc)

  const form = document.createElement('div')
  form.className = 'settings-form'

  const mkField = (label, inputElem, hintText = '') => {
    const row = document.createElement('label')
    row.className = 'form-row'
    const lbl = document.createElement('span')
    lbl.className = 'form-label'
    lbl.textContent = label
    row.append(lbl, inputElem)
    if (hintText) {
      const hint = document.createElement('span')
      hint.className = 'form-hint'
      hint.textContent = hintText
      row.append(hint)
    }
    return row
  }

  const tokenInput = document.createElement('input')
  tokenInput.type = 'password'
  tokenInput.placeholder = 'github_pat_...'
  tokenInput.value = current.token || ''
  tokenInput.autocomplete = 'off'

  const ownerInput = document.createElement('input')
  ownerInput.type = 'text'
  ownerInput.value = current.owner || DEFAULT_SETTINGS.owner

  const repoInput = document.createElement('input')
  repoInput.type = 'text'
  repoInput.value = current.repo || DEFAULT_SETTINGS.repo

  const photoRepoInput = document.createElement('input')
  photoRepoInput.type = 'text'
  photoRepoInput.value = current.photoRepo || DEFAULT_SETTINGS.photoRepo

  const photoPrefixInput = document.createElement('input')
  photoPrefixInput.type = 'text'
  photoPrefixInput.value = current.photoPrefix || DEFAULT_SETTINGS.photoPrefix

  form.append(
    mkField(
      'GitHub Personal Access Token (PAT)',
      tokenInput,
      '관리자만 입력합니다. 브라우저의 로컬에만 안전하게 보관되며, 입력 시 등록/수정/삭제/동기화 권한이 활성화됩니다.',
    ),
    mkField('GitHub 계정 (Owner)', ownerInput),
    mkField('데이터 저장소 (SlowBy 리포)', repoInput, '여행 기록 메타데이터(travel_logs.json)가 저장되는 리포'),
    mkField('사진 전용 저장소 (photo-repo)', photoRepoInput, '원본 사진 및 썸네일이 업로드되는 리포'),
    mkField('사진 폴더 접두어 (Prefix)', photoPrefixInput, '예: travel 또는 slowby'),
  )

  const statusBox = document.createElement('div')
  statusBox.className = 'settings-status'

  body.append(form, statusBox)

  const foot = document.createElement('div')
  foot.className = 'modal-foot'

  const testBtn = document.createElement('button')
  testBtn.type = 'button'
  testBtn.className = 'btn'
  testBtn.innerHTML = `${iconHtml('sync', 13)} <span>연결 확인</span>`

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'btn btn-primary'
  saveBtn.textContent = '설정 저장'

  testBtn.onclick = async () => {
    testBtn.disabled = true
    testBtn.textContent = '확인 중…'
    statusBox.textContent = ''
    statusBox.className = 'settings-status is-checking'
    statusBox.textContent = 'GitHub 저장소 연결 상태를 확인하고 있습니다...'

    try {
      const cfg = {
        owner: ownerInput.value.trim(),
        repo: repoInput.value.trim(),
        photoRepo: photoRepoInput.value.trim(),
        photoPrefix: photoPrefixInput.value.trim(),
        token: tokenInput.value.trim(),
        branch: current.branch || 'main',
      }
      const res = await onCheck(cfg)
      statusBox.className = 'settings-status is-success'
      statusBox.innerHTML = `연결 성공! (${res.login} 계정 인증됨 · 데이터 리포 '${cfg.repo}' 및 사진 리포 '${cfg.photoRepo}' 접근 가능)`
    } catch (e) {
      statusBox.className = 'settings-status is-error'
      statusBox.textContent = `연결 실패: ${e.message}`
    } finally {
      testBtn.disabled = false
      testBtn.innerHTML = `${iconHtml('sync', 13)} <span>연결 확인</span>`
    }
  }

  saveBtn.onclick = () => {
    const next = {
      owner: ownerInput.value.trim(),
      repo: repoInput.value.trim(),
      photoRepo: photoRepoInput.value.trim(),
      photoPrefix: photoPrefixInput.value.trim(),
      branch: current.branch || 'main',
      token: tokenInput.value.trim(),
      tokenSetAt: tokenInput.value.trim() ? new Date().toISOString() : '',
    }
    saveSettings(next)
    onSave?.(next)
    cleanup()
  }

  foot.append(testBtn, saveBtn)
  box.append(head, body, foot)
  back.append(box)
  back.onclick = (e) => {
    if (e.target === back) cleanup()
  }
  document.body.append(back)
}
