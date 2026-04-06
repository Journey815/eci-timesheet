# ECI Timesheet — Google Apps Script 설정 가이드

---

## 1단계: Google 스프레드시트 만들기

1. [Google Drive](https://drive.google.com)에서 **새로 만들기 → Google 스프레드시트** 선택
2. 파일명을 `ECI Timesheet DB` (또는 원하는 이름)로 변경

### 시트 1: `entries` 만들기

기본 시트 이름이 `시트1`이면 탭을 더블클릭하여 `entries`로 변경한 뒤,
1행에 아래 헤더를 순서대로 입력합니다:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| id | name | date | startTime | endTime | category | description | hours | submittedAt | modifiedAt | status | approverName | approvedAt | signatureId | rejectionReason |

> `status` 기본값: `pending` / `approved` / `rejected` 중 하나

### 시트 2: `members` 만들기

시트 하단의 **+** 버튼으로 새 시트를 추가하고 이름을 `members`로 변경,
1행에 헤더 입력:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| name | role | hourlyRate | isActive | department | email |

초기 멤버 데이터 예시 (2행부터 입력):

| name | role | hourlyRate | isActive | department | email |
|------|------|-----------|---------|------------|-------|
| 홍길동 | 엔지니어 | 50000 | TRUE | 구조팀 | hong@example.com |
| 김철수 | 디자이너 | 45000 | TRUE | 설계팀 | kim@example.com |

### 시트 3: `config` 만들기

새 시트를 추가하고 이름을 `config`로 변경,
1행에 헤더, 2행부터 초기 설정값 입력:

| A (key) | B (value) |
|---------|-----------|
| key | value |
| password | 1234 |
| adminPassword | admin1234 |
| adminEmail | admin@example.com |
| projectName | ECI |
| projectStartDate | 2026-04-06 |
| projectWeeks | 20 |
| categories | 설계/디자인,엔지니어링,PM/관리,미팅/회의,문서작업,검토/리뷰,현장,조달/구매,교육/세미나,기타 |

> `adminEmail`: 시수 승인 완료 시 알림을 받을 관리자 이메일
> 비밀번호는 반드시 배포 후 변경하세요.

### 시트 4: `departments` 만들기 (신규)

새 시트를 추가하고 이름을 `departments`로 변경,
1행에 헤더, 2행부터 부서 데이터 입력:

| A | B | C |
|---|---|---|
| name | approverName | approverEmail |

예시:

| name | approverName | approverEmail |
|------|-------------|---------------|
| 구조팀 | 이부장 | lee@example.com |
| 설계팀 | 박팀장 | park@example.com |

> `approverName`: 해당 부서의 시수 승인 담당자 이름 (members 시트의 name과 일치시킬 필요 없음)
> `approverEmail`: 승인 요청 이메일을 받을 주소

### 시트 5: `signatures` 만들기 (신규)

새 시트를 추가하고 이름을 `signatures`로 변경,
1행에 헤더 입력 (데이터는 앱에서 자동으로 채워집니다):

| A | B | C |
|---|---|---|
| name | signatureData | uploadedAt |

> `signatureData`: base64 PNG 문자열. 셀 하나에 최대 약 50KB. 서명 이미지는 이 범위 내로 유지.

---

## 2단계: Apps Script 편집기 열기

1. 스프레드시트 상단 메뉴에서 **확장 프로그램 → Apps Script** 클릭
2. 새 탭에 Apps Script 편집기가 열립니다
3. 프로젝트 이름(상단 `제목 없는 프로젝트`)을 `ECI Timesheet API`로 변경

---

## 3단계: 코드 붙여넣기

1. 편집기 왼쪽 파일 목록에서 `Code.gs` 선택
2. 기존 내용 전체 삭제 (`Ctrl+A` → `Delete`)
3. `Code.gs` 파일의 내용을 복사하여 붙여넣기
4. **저장** (`Ctrl+S` 또는 상단 저장 아이콘)

---

## 4단계: 웹 앱으로 배포

1. 상단 오른쪽 **배포 → 새 배포** 클릭
2. 배포 유형 선택에서 톱니바퀴 아이콘 클릭 후 **웹 앱** 선택
3. 설정:
   - **설명**: `v1` (선택사항)
   - **실행 계정**: **나 (내 Google 계정)**
   - **액세스 권한**: **모든 사용자**
4. **배포** 버튼 클릭
5. 권한 요청 팝업이 뜨면 **액세스 승인** → 본인 Google 계정 선택 → **고급 → ECI Timesheet API(안전하지 않음) 이동 → 허용**

> 권한 요청은 최초 1회만 발생합니다.
> 이메일 발송(`MailApp`) 권한도 함께 요청됩니다. 반드시 허용하세요.

---

## 5단계: 배포 URL 복사

배포 완료 후 표시되는 **웹 앱 URL**을 복사합니다.

```
예시: https://script.google.com/macros/s/AKfycb.../exec
```

이 URL을 프론트엔드의 `API_URL` 또는 `.env`에 붙여넣습니다.

> URL은 언제든지 **배포 → 배포 관리** 메뉴에서 다시 확인할 수 있습니다.

---

## 6단계: 배포 테스트

브라우저 주소창에 아래 URL을 붙여넣어 응답을 확인합니다:

```
# 설정값 조회
{웹앱URL}?action=getConfig

# 멤버 조회
{웹앱URL}?action=getMembers

# 부서 목록 조회
{웹앱URL}?action=getDepartments

# 비밀번호 확인
{웹앱URL}?action=verifyPassword&password=1234&type=user

# 승인자의 부서 목록 조회
{웹앱URL}?action=getApproverDepartments&name=이부장

# 상태별 항목 조회 (admin용)
{웹앱URL}?action=getEntriesByStatus&status=pending
```

JSON 응답이 오면 정상입니다.

---

## 7단계: 코드 수정 후 재배포

코드를 수정했을 때는 반드시 **재배포**해야 변경사항이 반영됩니다:

1. **배포 → 배포 관리** 클릭
2. 기존 배포 옆 연필(편집) 아이콘 클릭
3. 버전을 **새 버전**으로 변경
4. **배포** 클릭

> "최신 코드로 배포"를 선택하면 URL이 유지됩니다.

---

## 초기 설정 체크리스트

- [ ] `entries` 시트 헤더 15개 입력 완료
- [ ] `members` 시트 헤더 6개 + 멤버 데이터 입력 (department, email 포함)
- [ ] `config` 시트 헤더 + 설정값 입력 (`adminEmail` 포함)
- [ ] `departments` 시트 헤더 + 부서/승인자 데이터 입력
- [ ] `signatures` 시트 헤더 입력 (데이터는 앱에서 자동 입력)
- [ ] Apps Script에 `Code.gs` 코드 붙여넣기 및 저장
- [ ] 웹 앱 배포 (실행 계정: 나, 액세스: 모든 사용자, MailApp 권한 허용)
- [ ] 배포 URL 복사 → 프론트엔드 설정 파일에 적용
- [ ] `getConfig` 엔드포인트로 동작 확인
- [ ] `getDepartments` 엔드포인트로 부서 데이터 확인
- [ ] 비밀번호 변경 (`config` 시트 또는 관리자 화면)

---

## 승인 워크플로우 개요

```
사용자 시수 입력 (status: pending)
    ↓
notifyApprover 호출 → 승인자에게 이메일 발송
    ↓
승인자: getPendingByApprover로 목록 조회
    ↓
approveEntries / rejectEntries 호출
    ↓
승인: status=approved, 관리자에게 확인 이메일
반려: status=rejected, 제출자에게 반려 이메일
    ↓
반려 시 사용자가 수정하면 status 자동으로 pending 복귀
```

---

## 문제 해결

### "Sheet not found" 에러
시트 이름이 정확히 `entries`, `members`, `config`, `departments`, `signatures`인지 확인하세요. 공백 포함 불가.

### 권한 오류 (401/403)
배포 설정에서 액세스 권한이 **모든 사용자**로 되어 있는지 확인하세요.

### 이메일이 발송되지 않음
- Apps Script 배포 시 `MailApp` 권한을 허용했는지 확인
- Gmail 일일 발송 한도(약 100건)를 초과하지 않았는지 확인
- `config` 시트의 `adminEmail` 값이 입력되어 있는지 확인
- 이메일 오류는 메인 작업을 실패시키지 않으므로 Apps Script 로그에서 확인

### 코드 수정이 반영 안 됨
저장 후 반드시 **재배포(새 버전)**를 해야 합니다. 단순 저장만으로는 배포된 버전이 바뀌지 않습니다.

### CORS 에러
Apps Script 웹 앱은 기본적으로 CORS를 지원하지 않습니다. 프론트엔드에서 직접 호출할 때는 `mode: 'no-cors'`를 사용하거나, 응답을 받을 수 없는 경우 Google Apps Script의 `doPost` / `doGet`에서 JSONP 방식을 고려하세요.

### 서명 데이터 저장 실패
Google Sheets 단일 셀 한도는 약 50KB입니다. 서명 이미지 해상도를 낮추거나 canvas 크기를 줄여서 base64 문자열 크기를 줄이세요.
