# 세 공공데이터 서비스 필드 대조

2026-11-13 공식 포털의 공개 명세 기준. 이 실행 환경에서는 `apis.data.go.kr` DNS가 차단되어 실응답 필드와 인증 권한을 확인하지 못했다. `npm run diagnose:data`는 키와 URL을 출력하지 않고 서비스·상세기능·HTTP 상태·Content-Type·응답 형식·오류 코드·요청 **변수명**·선택된 필드명만 출력한다. API가 정상 XML을 보내도 JSON 요청의 불일치로 진단하고 수치로 사용하지 않는다.

## 요청변수와 선택 기준

| 서비스/상세기능 | 공식 요청변수(대소문자 유지) | 실제 요청 | 응답 필드·의미·기준 | 검증·중복 키 | 미사용 변수/이유 |
|---|---|---|---|---|---|
| 소진공 `/storeZoneInAdmi` | `servicekey`, `divId`, `key`, 선택 `type` | `divId=ctprvnCd`, 부산 시도 코드, `type=json` | `trarNo` 상권번호, `mainTrarNm` 상권명, `ctprvnCd`, `signguCd`, `signguNm`, `adongCd`, `stdrDt` 배포일 | 부산 코드·상권번호·시군구코드 형식 검사; `trarNo` 중복 제거 | 좌표 `coords`, 면적 `trarArea`, 좌표 개수 `coordNum`, `description`, `resultMsg`는 점수에 사용하지 않음. 응답 상태 코드는 오류 검사에 사용 |
| 소진공 `/smallUpjongList` | `servicekey`, 선택 `indsLclsCd`, `indsMclsCd`; 응답 형식 `type`은 명세의 출력 항목에 기재 | `type=json`을 명시해 요청(실호출 수용 여부 미확인) | `indsLclsCd`, `indsMclsCd`, `indsSclsCd`(6자리), `indsSclsNm`, `stdrDt` | 코드 길이·유일성 검사; `indsSclsCd` | 대·중분류 필터는 조건에서 검증된 코드가 없으므로 보내지 않음. `description`, `columns` 제외 |
| 소진공 `/largeUpjongList` | `ServiceKey`, 선택 `type` | 소분류에서 하나로 매핑되지 않을 때만 `type=json` | `indsLclsCd`(2자리), `indsLclsNm`, `stdrDt` | 코드 길이·유일성 검사; `indsLclsCd` | 소분류 매칭 시 요청 생략 |
| 소진공 `/middleUpjongList` | `servicekey`, 선택 `indsLclsCd` | 현재 호출하지 않음 | `indsMclsCd`(4자리), `indsMclsNm`, 상위 대분류, `stdrDt` | 사용 시 중분류 코드 검증 필요 | 현재 추천 조건에서 중분류를 명확히 식별하지 않으므로 호출·점수화하지 않음 |
| 소진공 `/storeListInArea` | `ServiceKey`, `pageNo`, `numOfRows`, `key`; 선택 `indsLclsCd`, `indsMclsCd`, `indsSclsCd`, `type` | 검증된 `trarNo`를 `key`로 전달, `type=json`; 전체와 선택 업종을 별도 조회 | `bizesId` 점포 ID, `indsLclsCd`, `indsSclsCd`, `stdrYm` 기준년월, `totalCount` 검색 결과 수 | `bizesId` 중복 제거; 페이지 누락·중복·기준월 불일치 시 건수 결측 | 상호·지점·주소·건물·우편번호·층·호·KSIC·위경도 등은 현재 점포 수 계산에 불필요해 버림. 업종 선택 수준에 맞는 코드 하나만 요청 |
| 소진공 `/storeListInDong`, `/storeListInRadius` | 전자: `ServiceKey`, `pageNo`, `numOfRows`, `divId`, `key`, 선택 업종 코드·`type`; 후자: `ServiceKey`, `pageNo`, `numOfRows`, `radius`, `cx`, `cy`, 선택 업종 코드·`type` | 호출하지 않음 | 점포 ID, 업종·주소·좌표와 기준년월 | 조회 범위가 상권 번호와 다름 | 후보가 `trarNo`로 확인됐으므로 상권 점포 조회와 중복 호출하지 않음 |
| 부산 `/getCommercialChangeList` | `serviceKey`, `pageNo`, `numOfRows`, 선택 `resultType` | `resultType=json`, 최대 6페이지 | `comm_nm` 상권명, `type_nm` 구분, `change_indicator_nm`, `average_open_months` 평균 생존개월, `average_close_months` 평균 폐업개월, `busan_average_open_months`, `busan_average_close_months`; `totalCount` | 이름이 유일하고 소진공 상권명과 정확히 일치할 때만 생존개월 사용. 중복·절단이면 결측 | 변화지표 분류와 평균 폐업개월·부산 평균은 화면 근거용 후보 필드이나 종합점수에 합산하지 않음. 공식 공통 상권 ID 없음 |
| 부산 `/getCommercialHistoryList` | `serviceKey`, `pageNo`, `numOfRows`; 선택 `resultType`, `apvpermymd`, `dcbymd`, `rdnwhladdr` | `resultType=json`, 단일 시군구일 때만 `rdnwhladdr` 필터 | 주소·개업일·폐업일·좌표 등이 제공된다고 설명되지만 **공개된 포털 페이지에서 정확한 영문 출력 필드명과 사건 고유 ID를 확인할 수 없음** | 고유 사건 키 미확인. 조회 행을 합산·점수화하지 않음 | 날짜 필터의 연산 의미(같음/이후)가 확인되지 않아 요청하지 않음. `trarNo` 연결 키도 확인되지 않아 상권별 성장성 결측 |

세 서비스의 공통 `pageNo`·`numOfRows`는 페이지 제어용이다. `ServiceKey`·`servicekey`·`serviceKey`는 서비스별 명세 표기를 따른다. 소진공 `type=json`, 부산 `resultType=json`을 구별한다. 응답의 `resultCode`와 메시지는 성공 여부 판단에만 사용하며 사용자에게 원문을 노출하지 않는다. `totalCount`는 검색 결과 총량으로 취급하지만 조회가 조기 종료되거나 페이지 중복·ID 누락이 있으면 확인된 총량으로 표시하지 않는다.

## 개념 중복 방지

- `trarNo`는 소진공 상권 ID이고 `comm_nm`은 부산 서비스의 텍스트 상권명이다. 이름이 중복되면 변화지표를 합치지 않는다.
- 현재 영업 점포 `bizesId` 개수와 이력 사건 개수는 더하지 않는다. 점포 ID가 같아도 날짜가 다른 사건은 별도로 남겨야 한다.
- `stdrDt`(상권 배포일), `stdrYm`(점포 기준년월), 분석 실행 시각은 별도 표기한다.
- `average_open_months`(평균 생존개월)는 개업 건수가 아니다.
- 부산 이력의 업종명과 소진공 업종 코드는 공식 연계표가 확인되기 전에는 동일 분류로 간주하지 않는다.

## JSON 오류 조사 결과

기존 업종 코드 요청은 `type=json` 없이 JSON 파싱을 수행했다. 특히 대분류 명세에는 기본 XML과 선택 `type=json`이 명시되어 있어 XML 응답의 유력한 원인이다. 현재 대분류에는 `ServiceKey`, 소분류에는 `servicekey`를 사용하며 JSON 형식을 요청한다. **실제 원인 확정은 아직 불가**: 이 실행 환경에서 네 서비스 진단 요청이 모두 DNS 연결 실패로 끝나 HTTP 본문을 받지 못했다. 새 진단은 형식·상태·오류 코드만 노출하고 XML 오류·HTML·빈 응답을 구분한다.

공식 자료: [소진공 상가(상권)정보](https://www.data.go.kr/data/15012005/openapi.do), [부산 변화지표](https://www.data.go.kr/data/15095252/openapi.do), [부산 점포이력](https://www.data.go.kr/data/15095253/openapi.do).
# 행정동 추천 기준 변경 (2026-11-13)

| 상세기능 | 요청 필드 | 선택 응답 필드 | 추천에서 사용 | 중복 키 / 한계 |
|---|---|---|---|---|
| 소진공 `/storeZoneInAdmi` | `servicekey`, `divId=ctprvnCd`, `key=26`, `type=json` | `trarNo`, `mainTrarNm`, `signguCd`, `signguNm` | 자연어 지역에서 후보 상권 확인 | `trarNo`; 이름만으로 행정동 확정하지 않음 |
| 소진공 `/baroApi` | `ServiceKey`, `resId=dong`, `catId=admi`, `type=json` | `ctprvnCd`, `signguCd`, `signguNm`, `adongCd`, `adongNm` | 주변 점포에 동 정보가 없을 때 같은 구의 공식 행정동 목록 확인 | `adongCd`; 부산 시도·구 코드와 이름 검증 |
| 소진공 `/storeListInArea` | `ServiceKey`, `key=trarNo`, `pageNo`, `numOfRows`, `type=json` | `bizesId`, `adongCd`, `adongNm`, `signguCd`, `signguNm` | 후보 상권에 실제 점포가 속한 행정동 발견 | `bizesId`; 응답에 행정동 코드가 없으면 후보 제외 |
| 소진공 `/storeListInDong` | `servicekey`, `divId=adongCd`, `key=행정동코드`, `pageNo`, `numOfRows`, `type=json`, 필요할 때만 `indsSclsCd` 또는 `indsLclsCd` | `bizesId`, `adongCd`, `adongNm`, `indsSclsCd`, `indsLclsCd`, `stdrYm`; `totalCount` | 전체 점포와 선택 업종 점포를 별도로 비교 | `bizesId`; 페이지 상한·중복·기준월 충돌 시 결측 |
| 부산 변화지표 `/getCommercialChangeList` | `serviceKey`, `pageNo`, `numOfRows`, `resultType=json` | `comm_nm`, `average_open_months` 등 | 행정동 식별자가 검증되지 않아 현재 점수에 사용하지 않음 | 상권명은 행정동 코드와 동일하지 않음 |
| 부산 점포이력 `/getCommercialHistoryList` | `serviceKey`, `pageNo`, `numOfRows`, `resultType=json`, 선택 `rdnwhladdr` | `rdnwhladdr`, `apvpermymd`, `dcbymd` | 행정동과 동일 업종을 모두 확인할 수 없어 개폐업 점수에 사용하지 않음 | 개업과 폐업은 별개 사건; 업종 대응 필드 실응답 미확인 |

현재 실행 환경의 제공처 DNS 연결 실패로 응답의 행정동 필드 존재와 이력 업종 분류를 실측하지 못했다. 이를 임의 추정해 개폐업 건수를 만들지 않는다. 아래의 이전 상권 단위 설명보다 이 행정동 기준을 우선한다.

