# 경량화 리팩토링 — 남은 작업

장기간 사용해도 서비스가 무거워지지 않도록 사진 저장 방식을 바꿨다. 이 문서는 적용한 내용과
**아직 남은 작업**을 기록한다.

## 적용 완료 (2026-10-17)

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 업로드 사진 | 원본 그대로 (장당 약 3MB, EXIF·GPS 포함) | 긴 변 1024px, WebP 80% (평균 약 56KB) — Safari 는 WebP 인코딩을 못 해 JPEG 85% (약 105KB) |
| 썸네일 | 280px JPEG 80% (약 10KB) | 280px WebP 80% (4~8KB) |
| 공개 사진의 EXIF | 원본 EXIF 그대로 공개 리포에 올라감 | 재인코딩 과정에서 제거됨. 위치·일시는 그 전에 원본에서 읽는다 |
| 로컬(IndexedDB) | 원본·썸네일을 영구 보관 | 업로드 대기열로만 사용. 원격에 올라간 게 확인되면 로컬 Blob 삭제 |

관련 코드: `src/photos.js` 의 `processImage()`, `encodeCompact()` / `src/sync.js` 의 `uploadPhotos()`

### 파일 확장자가 `.jpg` 인 이유

내용이 WebP 여도 파일명은 `{사진 id}.jpg` 다. raw.githubusercontent.com 은 확장자로
Content-Type 을 정하는데, `.webp` 는 `application/octet-stream` + `nosniff` 로 내려가서
**Safari(WebKit)가 이미지로 표시하지 않는다.** `.jpg` 이면 `image/jpeg` 로 내려가고, 브라우저는
실제 내용을 보고 WebP 로 디코딩한다.

2026-10-17 확인 결과 (Playwright: WebKit 18.0, Firefox 131, Chrome 155):

| | canvas WebP 인코딩 | raw 의 `.webp` 표시 | `.jpg` 이름의 WebP 표시 |
|---|---|---|---|
| Chrome / Edge | O | O | O |
| Firefox | O | O | O |
| WebKit (Safari) | X (PNG 반환) | **X** | O |

## 남은 작업 1 — 뷰어 해상도 단계 나누기

**현재**: 피드·지도 마커는 썸네일(280px)을, 뷰어는 업로드 사진(1024px)을 쓴다. 사진이 1024px 로
작아졌으므로 지금은 단계를 더 나눌 필요가 크지 않다.

**필요해지는 시점**: 고해상도 화면(태블릿·데스크톱 전체화면)에서 1024px 가 흐리게 보이거나,
나중에 업로드 해상도를 높일 때.

**방법**
1. 업로드할 때 크기별 파일을 함께 만든다: `{id}_t.jpg`(280px, 피드·마커), `{id}.jpg`(1024px, 뷰어 기본),
   필요하면 `{id}_l.jpg`(2048px, 확대·전체화면).
2. 사진 항목(`photos[]`)에 `large`/`largeUrl` 를 추가하고, `getPhotoRawUrl(settings, log, kind)` 의
   `kind` 에 `'large'` 를 더한다.
3. 뷰어에서 `<img srcset="… 1024w, … 2048w" sizes="…">` 로 화면 크기에 맞는 파일을 고르게 한다.
   큰 파일은 사용자가 확대할 때만 불러오면 모바일 데이터를 아낄 수 있다.
4. 용량: 2048px WebP 는 장당 약 200KB. 모든 사진에 만들면 저장소가 약 4배로 늘어나므로,
   필요하면 대표 사진에만 만드는 방안도 고려한다.

## 남은 작업 2 — 이미 올라간 원본 정리

**현재**: 이번 변경 이전에 올린 사진은 원본(3~5MB, EXIF·GPS 포함 가능)이 photo-repo 에 그대로 있다.
2026-10-17 기준 photo-repo 는 22개 파일, 약 29MB 다. 예를 들어 GPS 가 들어 있는 WebP 원본
(96,546바이트)이 그대로 공개되어 있다.

**방법**
1. **최신 상태 축소 (일회성 스크립트)**
   - `public/data/travel_logs.json` 에서 모든 `photos[].full` 경로를 모은다.
   - 각 파일을 내려받아 1024px 를 넘거나 EXIF 가 있으면 1024px WebP 80% 로 다시 인코딩해
     **같은 경로에** 덮어쓴다 (PUT 할 때 기존 sha 를 함께 보낸다).
   - 썸네일도 같은 방식으로 처리한다.
   - 브라우저 canvas 와 결과를 맞추려면 Playwright 로 앱의 `processImage()` 를 그대로 돌리거나,
     Node 에서 `sharp` 로 `resize(1024, 1024, { fit: 'inside' }).webp({ quality: 80 })` 를 쓴다.
     `sharp` 는 기본적으로 메타데이터를 제거한다.
   - 실행 전에 photo-repo 를 백업(clone)한다.
2. **Git 이력 정리 (GPS 노출을 완전히 없애려면 필요)**
   - 같은 경로에 덮어써도 옛 원본은 Git 이력에 남아 누구나 받을 수 있다. 리포 용량도 줄지 않는다.
   - 방법 A — 새 리포로 옮기기: 축소한 파일만 담은 새 리포(`photo-repo-v2`)를 만들고, 설정의 사진
     저장소를 바꾼 뒤 JSON 의 `fullUrl`/`thumbUrl` 를 새 리포로 고친다. 옛 리포는 삭제하거나 비공개로 돌린다.
   - 방법 B — 이력 다시 쓰기: `git filter-repo` 등으로 이력을 정리하고 force push 한다. 다른 곳에 clone 이
     있으면 다시 받아야 한다. GitHub 캐시에서 옛 객체가 바로 사라지지 않을 수 있으므로, 민감하다면
     방법 A 가 더 확실하다.
3. 정리 후 photo-repo 용량을 확인한다 (`GET /repos/{owner}/photo-repo` 의 `size`, KB 단위).

## 참고 — 알려진 제약

- **ZIP 백업**(`src/export.js` 의 `exportToZip()`)은 업로드 전 사진은 로컬에서, 업로드된 사진은 사진 리포에서
  내려받아 담는다. 받지 못한 사진이 있으면 장수를 알려 준다.
- **용량 어림**: 장당 약 60KB(사진+썸네일 약 70KB)면 1만 장에 약 0.7GB. GitHub 권장 리포 크기(1GB)
  안에서 오래 쓸 수 있다. 그래도 커지면 `photo-repo-2027` 처럼 연도별로 리포를 나눈다.
