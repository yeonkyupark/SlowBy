# SlowBy (슬로비)

사진으로 남기는 나만의 감성 여행 아카이브 웹 서비스

**https://yeonkyupark.github.io/SlowBy/**

---

## 🌟 주요 기능

1. **사진 위치(EXIF GPS) & 촬영 일시 기반 스마트 기록**
   - 사진 업로드 시 EXIF 메타데이터를 분석하여 위도/경도 좌표 및 촬영일시를 자동으로 추출하고 지도에 핀을 꽂습니다.
   - GPS 좌표가 없는 사진은 지도 클릭 지정, 주소 입력, 또는 현재 위치(실시간 GPS) 지정을 통해 간편하게 위치를 지정할 수 있습니다.

2. **풍부한 여행 메타데이터 & 감성 기록**
   - **범주 (Category)**: 명소·관광, 맛집·식당, 카페·디저트, 자연·풍경, 숙소·호텔, 체험·액티비티, 쇼핑·기념품, 기타·메모
   - **평점 및 리뷰**: 5점 별점 평가(`★ ★ ★ ★ ★`), 자유로운 여행 일기/리뷰 메모
   - **여행 상세 옵션**: 지출 비용(KRW), 날씨(맑음/흐림/비/눈/바람), 동행(혼자/친구/연인/가족/모임), 해시태그

3. **지도 연동 & 스마트 벡터 마커**
   - 범주별 고유 색상 및 미니 벡터 아이콘 뱃지가 결합된 커스텀 사진 마커
   - 밀집 지역 자동 클러스터링 및 지도-피드 실시간 인터랙션
   - 일반 지도(OSM), 지형도(OpenTopoMap), 위성 지도(Esri) 3종 타일 지원

4. **모바일 우선(Mobile-First) 타임라인 피드 & 제스처 바텀시트**
   - 한손 터치 조작에 최적화된 스와이프 바텀시트 패널
   - 방문 일자별 그룹화된 여행 카드 피드
   - 카테고리 칩 원클릭 필터링, 통합 검색(장소명/메모/주소/태그), 다채로운 정렬(최신순/과거순/별점순/비용순)

5. **여행 통계 대시보드 & DB 이관 관리**
   - 총 방문지 수, 방문 지역 수, 카테고리별 방문 분포 통계 차트, 총 지출액, 평균 평점 요약
   - RDBMS/PostgreSQL/Supabase 등 향후 데이터베이스 확장을 고려한 정규화 스키마 설계
   - **JSON (DB 덤프)**, **CSV (Excel용)**, **ZIP (사진 원본 포함 전체 백업)** 즉시 내보내기 및 복원 지원

6. **1인 크리에이터 관리 & 전체 공개 열람 권한 아키텍처**
   - **사진 저장소**: [photo-repo](https://github.com/yeonkyupark/photo-repo) 전용 리포지토리 활용
   - **메타데이터**: `SlowBy` 저장소의 `public/data/travel_logs.json`
   - **관리자**: GitHub Personal Access Token (PAT) 설정 시 등록/수정/삭제/동기화 활성화
   - **일반 방문자**: 별도 로그인 없이 공개된 최신 여행 기록을 지도와 피드로 완벽하게 열람

---

## 🛠️ 기술 스택

- **Build**: Vite 6
- **Frontend**: Vanilla JS (ES Modules) + Mobile-First Responsive CSS3
- **Map**: Leaflet 1.9
- **EXIF Parser**: `exifr` (지연 로딩)
- **ZIP Backup**: `fflate` (지연 로딩)
- **Database / Cache**: IndexedDB (오프라인 1차 로컬 스토리지)
- **Hosting / Storage**: GitHub Pages + GitHub Contents API

---

## 🚀 로컬 실행 및 빌드

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```
