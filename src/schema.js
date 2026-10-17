/**
 * SlowBy (슬로비) — 여행 기록 데이터 스키마 정의 및 유효성 검사 모듈
 *
 * 향후 PostgreSQL/Supabase, MySQL 등 RDBMS나 NoSQL DB로 완벽히 1:1 매핑 및
 * 이관이 가능하도록 정규화된 필드 구조로 설계되었습니다.
 */

/** 여행 기록 범주(Category) 메타데이터 */
export const CATEGORIES = {
  spot: { id: 'spot', label: '명소·관광', icon: 'spot', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  food: { id: 'food', label: '맛집·식당', icon: 'food', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
  cafe: { id: 'cafe', label: '카페·디저트', icon: 'cafe', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  nature: { id: 'nature', label: '자연·풍경', icon: 'nature', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  stay: { id: 'stay', label: '숙소·호텔', icon: 'stay', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
  activity: { id: 'activity', label: '체험·액티비티', icon: 'activity', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  shopping: { id: 'shopping', label: '쇼핑·기념품', icon: 'shopping', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' },
  etc: { id: 'etc', label: '기타·메모', icon: 'etc', color: '#4b5563', bg: '#f3f4f6', border: '#e5e7eb' },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES)

/** 날씨 옵션 */
export const WEATHERS = [
  { id: 'sunny', label: '맑음', icon: 'sun' },
  { id: 'cloudy', label: '흐림', icon: 'cloud' },
  { id: 'rainy', label: '비', icon: 'rain' },
  { id: 'snowy', label: '눈', icon: 'snow' },
  { id: 'windy', label: '바람', icon: 'wind' },
]

/** 동행 옵션 */
export const COMPANIONS = [
  { id: 'solo', label: '혼자' },
  { id: 'couple', label: '연인' },
  { id: 'friend', label: '친구' },
  { id: 'family', label: '가족' },
  { id: 'group', label: '모임' },
]

/**
 * 표준 여행 기록 레코드 생성 및 정규화
 * @param {Partial<TravelLog>} input
 * @returns {TravelLog}
 */
export function createTravelLogRecord(input = {}) {
  const now = new Date().toISOString()
  return {
    // 1. 기본 식별 및 타임스탬프
    id: input.id || generateId(),
    createdAt: input.createdAt || now,
    updatedAt: now,
    deleted: Boolean(input.deleted),

    // 2. 여행 일시
    visitedAt: input.visitedAt || input.takenAt || now.slice(0, 16), // YYYY-MM-DDTHH:mm

    // 3. 범주 및 기본 정보
    category: CATEGORIES[input.category] ? input.category : 'spot',
    title: String(input.title || '').trim(),
    memo: String(input.memo || '').trim(),
    rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),

    // 4. 위치 정보 (GIS / Geolocation)
    lat: Number(input.lat) || 0,
    lng: Number(input.lng) || 0,
    address: String(input.address || '').trim(),
    locationName: String(input.locationName || '').trim(),
    region: String(input.region || '').trim(),
    locationSource: input.locationSource || 'exif',

    // 5. 추가 여행 메타데이터 (통계 및 분석용)
    cost: input.cost != null && input.cost !== '' ? Number(input.cost) : null,
    costCurrency: input.costCurrency || 'KRW',
    companion: input.companion || '',
    weather: input.weather || '',
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean)
      : typeof input.tags === 'string'
        ? input.tags
            .split(',')
            .map((t) => t.trim().replace(/^#/, ''))
            .filter(Boolean)
        : [],

    // 6. 미디어 저장 정보
    //    photos: [{ id, full, thumb, fullUrl, thumbUrl }] — 첫 장이 대표 사진
    //    photo:  photos[0] 의 원격 경로 사본 (이전 버전 데이터·지도 마커 호환용)
    //    thumb:  대표 사진 썸네일 Blob (로컬 전용, 원격 JSON 에는 안 나감)
    //    pendingDeletes: 사진 리포에서 지워야 할 경로 (로컬 전용, 동기화 때 처리)
    photos: Array.isArray(input.photos) ? input.photos : [],
    photo: input.photo || null,
    thumb: input.thumb || null,
    pendingDeletes: Array.isArray(input.pendingDeletes) ? input.pendingDeletes : [],
  }
}

export const MAX_PHOTOS = 10

/**
 * 기록의 사진 목록을 정규화해 돌려준다. 여러 장 지원 이전 데이터는 `photo` 하나뿐이고,
 * 그 사진의 로컬 Blob 키와 원격 파일명은 기록 id 였다.
 * @returns {Array<{id: string, full?: string, thumb?: string, fullUrl?: string, thumbUrl?: string}>}
 */
export function photoList(log) {
  if (!log) return []
  if (Array.isArray(log.photos) && log.photos.length) return log.photos
  const p = log.photo
  if (p && typeof p === 'object') return [{ ...p, id: log.id }]
  if (typeof p === 'string') return [{ id: log.id, fullUrl: p, thumbUrl: p }]
  if (log.thumb) return [{ id: log.id }]
  return []
}

/** 원격 경로 필드만 남긴 대표 사진 사본 (`log.photo`) */
export function photoMirror(entry) {
  if (!entry?.full && !entry?.fullUrl) return null
  const { id, ...rest } = entry
  return rest
}

/** UUID v4 생성 */
export function generateId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  const r = crypto.getRandomValues(new Uint8Array(16))
  return [...r].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * DB 마이그레이션용 정규화 JSON 생성
 */
export function exportToDbSchema(logs = []) {
  return logs.map((log) => {
    const { thumb, pendingDeletes, ...rest } = log
    return rest
  })
}
