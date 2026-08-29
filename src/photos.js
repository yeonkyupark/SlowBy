/**
 * SlowBy — 사진 메타데이터(EXIF) 파싱 및 이미지 최적화 모듈
 *
 * 사진 파일로부터 GPS 좌표(위도/경도), 촬영 일시(DateTimeOriginal), 기기 및 주소 정보를 정밀하게 추출하고
 * 지도 마커 및 피드용 썸네일을 생성합니다.
 */

const THUMB_EDGE = 280
const THUMB_QUALITY = 0.8

const ADDRESS_KEYS = [
  'Sublocation',
  'Sub-location',
  'Location',
  'City',
  'Province-State',
  'State',
  'Country-PrimaryLocationName',
  'Country',
  'CountryCode',
]

function fixMojibake(s) {
  if (typeof s !== 'string' || !/[\u0080-\u00ff\u20ac]/.test(s)) return s
  try {
    const bytes = Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return /[㄰-㆏가-힯一-鿿]/.test(decoded) ? decoded : s
  } catch {
    return s
  }
}

function looksKoreanAddress(v) {
  return (
    typeof v === 'string' &&
    v.length >= 4 &&
    v.length <= 120 &&
    /[가-힣]/.test(v) &&
    /(특별시|광역시|특별자치|[가-힣]{2,}(시|군|구|읍|면|동|리|로|길))/.test(v)
  )
}

function extractAddress(parsed) {
  if (!parsed || typeof parsed !== 'object') return { address: '', region: '' }

  const parts = []
  for (const k of ADDRESS_KEYS) {
    const v = fixMojibake(parsed[k])
    if (typeof v === 'string' && v.trim() && !parts.includes(v.trim())) parts.push(v.trim())
  }

  let region = fixMojibake(parsed.City || parsed['Province-State'] || parsed.State || '')

  if (parts.length) {
    return { address: parts.join(' '), region }
  }

  for (const [, v] of Object.entries(parsed)) {
    const fixed = fixMojibake(v)
    if (looksKoreanAddress(fixed)) {
      const matchRegion = fixed.match(/([가-힣]{2,}(?:시|군|구))/)
      return { address: fixed.trim(), region: matchRegion ? matchRegion[1] : '' }
    }
  }
  return { address: '', region: '' }
}

function extractLatLng(parsed) {
  if (!parsed) return null

  const pairs = [
    [parsed.latitude, parsed.longitude],
    [parsed.GPSLatitude, parsed.GPSLongitude],
    [parsed.lat, parsed.lon ?? parsed.lng],
  ]
  for (const [a, b] of pairs) {
    const lat = typeof a === 'number' ? a : Number(a)
    const lng = typeof b === 'number' ? b : Number(b)
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return [lat, lng]
    }
  }
  return null
}

/** Date 객체를 YYYY-MM-DDTHH:mm 포맷으로 변환 (datetime-local 호환) */
export function formatDateTimeLocal(dateInput) {
  if (!dateInput) return ''
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(+d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 사진 파일로부터 EXIF 데이터 파싱
 * @param {File} file
 */
export async function readExif(file) {
  const empty = { latlng: null, takenAt: null, visitedAt: '', address: '', region: '', camera: '' }

  try {
    const exifr = await import('exifr/dist/full.esm.mjs')
    const parsed = await exifr
      .parse(file, {
        tiff: true,
        exif: true,
        gps: true,
        xmp: true,
        iptc: true,
        ifd0: true,
        mergeOutput: true,
        reviveValues: true,
        translateKeys: true,
        translateValues: true,
      })
      .catch(() => null)

    let latlng = extractLatLng(parsed)
    if (!latlng) {
      const gps = await exifr.gps(file).catch(() => null)
      if (Number.isFinite(gps?.latitude) && Number.isFinite(gps?.longitude)) {
        latlng = [gps.latitude, gps.longitude]
      }
    }

    const taken = parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate
    const takenDate = taken instanceof Date && !Number.isNaN(+taken) ? taken : null
    const { address, region } = extractAddress(parsed)

    const camera = [parsed?.Make, parsed?.Model].filter(Boolean).join(' ').trim()

    return {
      latlng,
      takenAt: takenDate ? takenDate.toISOString() : null,
      visitedAt: takenDate ? formatDateTimeLocal(takenDate) : formatDateTimeLocal(new Date()),
      address,
      region,
      camera,
    }
  } catch {
    return empty
  }
}

async function loadBitmap(file) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fallback */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function scaleTo(src, maxEdge, quality) {
  const w = src.width
  const h = src.height
  const ratio = Math.min(1, maxEdge / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * ratio))
  const ch = Math.max(1, Math.round(h * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, cw, ch)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve({ blob: b, width: cw, height: ch }) : reject(new Error('인코딩 실패'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 이미지 원본 및 썸네일 생성
 * @param {File} file
 */
export async function processImage(file) {
  const src = await loadBitmap(file)
  try {
    const thumb = await scaleTo(src, THUMB_EDGE, THUMB_QUALITY)
    return { full: file, thumb: thumb.blob, width: src.width, height: src.height }
  } finally {
    src.close?.()
  }
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
