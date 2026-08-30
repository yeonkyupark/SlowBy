/**
 * SlowBy (슬로비) — Leaflet 기반 지도 뷰 및 모던 스마트 마커 렌더러
 */

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CATEGORIES } from './schema.js'
import { iconHtml } from './icons.js'

export const TILE_PROVIDERS = {
  일반: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  },
  지형: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap',
    maxZoom: 17,
    subdomains: 'abc',
  },
  위성: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri',
    maxZoom: 19,
  },
}

export const TILE_NAMES = Object.keys(TILE_PROVIDERS)

const CLUSTER_PX = 36
const MAX_CANDIDATES = 350

export function createMap(containerEl, { onMarkerClick, getPhotoUrl } = {}) {
  const map = L.map(containerEl, {
    center: [35.8, 127.8],
    zoom: 7,
    zoomControl: false,
    tap: true, // iOS 모바일 탭 지원
  })

  // 줌 컨트롤을 모바일 엄지 영역(우측 하단)에 깔끔하게 배치
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  const tileLayers = {}
  for (const [name, config] of Object.entries(TILE_PROVIDERS)) {
    tileLayers[name] = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
      subdomains: config.subdomains || 'abc',
    })
  }
  tileLayers['일반'].addTo(map)

  const markerGroup = L.layerGroup().addTo(map)
  const clusterGroup = L.layerGroup().addTo(map)

  let allLogs = []
  let activeCategory = 'all'
  let searchQuery = ''
  const markerMap = new Map()
  const clusterMarkers = []

  function setTile(name) {
    if (!tileLayers[name]) return
    for (const [key, layer] of Object.entries(tileLayers)) {
      if (key === name) layer.addTo(map)
      else map.removeLayer(layer)
    }
  }

  function createMarkerIcon(log) {
    const cat = CATEGORIES[log.category] || CATEGORIES.spot
    const box = document.createElement('div')
    box.className = 'slowby-pin'
    box.style.setProperty('--cat-color', cat.color)

    const badge = document.createElement('span')
    badge.className = 'pin-badge'
    badge.innerHTML = iconHtml(cat.icon, 10)
    badge.style.color = cat.color
    box.append(badge)

    const imgWrap = document.createElement('div')
    imgWrap.className = 'pin-img-wrap'

    const thumbUrl = log.thumb
      ? URL.createObjectURL(log.thumb)
      : log.remoteThumbUrl || getPhotoUrl?.(log, 'thumb') || getPhotoUrl?.(log, 'full')

    if (thumbUrl) {
      const img = document.createElement('img')
      img.src = thumbUrl
      img.alt = log.title || '사진'
      img.loading = 'lazy'
      img.onerror = () => {
        imgWrap.classList.add('is-fallback')
        imgWrap.innerHTML = iconHtml(cat.icon, 18)
        imgWrap.style.color = cat.color
      }
      imgWrap.append(img)
    } else {
      imgWrap.classList.add('is-fallback')
      imgWrap.innerHTML = iconHtml(cat.icon, 18)
      imgWrap.style.color = cat.color
    }
    box.append(imgWrap)

    // 마커 하단 핀 꼬리(Pointer)
    const tip = document.createElement('div')
    tip.className = 'pin-tip'
    box.append(tip)

    return {
      icon: L.divIcon({
        html: box,
        className: 'slowby-div-icon',
        iconSize: [40, 48],
        iconAnchor: [20, 46],
      }),
      blobUrl: log.thumb ? thumbUrl : null,
    }
  }

  function renderMarkers() {
    for (const { marker, blobUrl } of markerMap.values()) {
      markerGroup.removeLayer(marker)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
    markerMap.clear()

    for (const m of clusterMarkers) clusterGroup.removeLayer(m)
    clusterMarkers.length = 0

    const filtered = allLogs.filter((log) => {
      if (log.lat === 0 && log.lng === 0) return false
      if (activeCategory !== 'all' && log.category !== activeCategory) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchTitle = (log.title || '').toLowerCase().includes(q)
        const matchMemo = (log.memo || '').toLowerCase().includes(q)
        const matchAddr = (log.address || '').toLowerCase().includes(q)
        const matchTags = Array.isArray(log.tags) && log.tags.some((t) => t.toLowerCase().includes(q))
        if (!matchTitle && !matchMemo && !matchAddr && !matchTags) return false
      }
      return true
    })

    if (!filtered.length) return

    const bounds = map.getBounds().pad(0.3)
    const visibleCandidates = filtered.filter((l) => bounds.contains([l.lat, l.lng])).slice(0, MAX_CANDIDATES)

    const pts = visibleCandidates.map((log) => ({
      log,
      point: map.latLngToContainerPoint([log.lat, log.lng]),
    }))
    const used = new Array(pts.length).fill(false)

    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue
      const group = [pts[i]]
      used[i] = true

      for (let j = i + 1; j < pts.length; j++) {
        if (!used[j] && pts[i].point.distanceTo(pts[j].point) <= CLUSTER_PX) {
          group.push(pts[j])
          used[j] = true
        }
      }

      if (group.length === 1) {
        const targetLog = group[0].log
        const { icon, blobUrl } = createMarkerIcon(targetLog)
        const marker = L.marker([targetLog.lat, targetLog.lng], {
          icon,
          title: targetLog.title || '여행 기록',
          riseOnHover: true,
        }).addTo(markerGroup)

        marker.on('click', () => onMarkerClick?.(targetLog))
        markerMap.set(targetLog.id, { marker, blobUrl })
      } else {
        const clusterLogs = group.map((g) => g.log)
        const clusterDiv = document.createElement('div')
        clusterDiv.className = 'slowby-cluster'
        clusterDiv.textContent = clusterLogs.length > 99 ? '99+' : String(clusterLogs.length)

        const center = clusterLogs.reduce((acc, l) => [acc[0] + l.lat, acc[1] + l.lng], [0, 0])
        center[0] /= clusterLogs.length
        center[1] /= clusterLogs.length

        const clusterMarker = L.marker(center, {
          icon: L.divIcon({
            html: clusterDiv,
            className: 'slowby-cluster-icon',
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          }),
        }).addTo(clusterGroup)

        clusterMarker.on('click', () => {
          map.fitBounds(L.latLngBounds(clusterLogs.map((l) => [l.lat, l.lng])), {
            maxZoom: Math.min(map.getZoom() + 3, 18),
            animate: true,
          })
        })
        clusterMarkers.push(clusterMarker)
      }
    }
  }

  map.on('moveend zoomend', renderMarkers)
  new ResizeObserver(() => map.invalidateSize({ animate: false })).observe(containerEl)

  return {
    map,
    setTile,

    setLogs(logs) {
      allLogs = logs
      renderMarkers()
    },

    setFilters({ category = 'all', query = '' } = {}) {
      activeCategory = category
      searchQuery = query
      renderMarkers()
    },

    fitAll() {
      const valid = allLogs.filter((l) => l.lat && l.lng)
      if (valid.length) {
        map.fitBounds(L.latLngBounds(valid.map((l) => [l.lat, l.lng])), {
          padding: [48, 48],
          maxZoom: 16,
          animate: true,
        })
      } else {
        map.setView([35.8, 127.8], 7, { animate: true })
      }
    },

    panTo([lat, lng], zoom = 15) {
      map.setView([lat, lng], zoom, { animate: true })
    },

    getCenter() {
      const c = map.getCenter()
      return [c.lat, c.lng]
    },

    pickLocation() {
      const container = map.getContainer()
      container.classList.add('is-picking-location')

      let settle
      const promise = new Promise((resolve) => (settle = resolve))

      const finish = (latlng) => {
        container.classList.remove('is-picking-location')
        map.off('click', onClick)
        settle(latlng)
      }
      const onClick = (e) => finish([e.latlng.lat, e.latlng.lng])

      map.on('click', onClick)
      return { promise, cancel: () => finish(null) }
    },
  }
}
