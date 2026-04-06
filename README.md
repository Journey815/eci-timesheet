# ECI Timesheet Management

ECI(Early Contractor Involvement) 프로젝트 투입 인력의 시수를 관리하는 웹 프로그램.

## Features

- **시수 입력**: 시작/종료 시간 + 업무 카테고리 + 내용 입력
- **승인 워크플로우**: 제출 → 소속 승인자 전자서명 승인/반려 → 관리자 취합
- **전자서명**: Canvas 직접 그리기 또는 이미지 업로드 (DocuSign 방식)
- **이메일 알림**: 제출 시 승인자에게, 반려 시 제출자에게 자동 알림
- **관리자 대시보드**: KPI, 인원별/주간/월간/카테고리별 현황
- **엑셀 다운로드**: 5개 시트 (전체요약, 주간, 월간, 개인별상세, 인건비산출)
- **서버 불필요**: 정적 HTML + Google Sheets (무료)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS |
| Backend | Google Apps Script (Web App) |
| Database | Google Sheets (5 sheets) |
| Hosting | GitHub Pages |
| Excel | SheetJS (xlsx) |
| Email | Apps Script MailApp |

## Setup

### 1. Google Sheets Backend

[`apps-script/SETUP.md`](apps-script/SETUP.md) 의 가이드를 따라 Google Sheets + Apps Script를 설정하세요.

### 2. Frontend Configuration

`app.js` 상단의 `CONFIG.API_URL`에 Apps Script 웹 앱 URL을 입력합니다:

```javascript
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  APP_TITLE: 'ECI 시수관리',
};
```

### 3. Deploy

GitHub Pages를 활성화하면 자동 배포됩니다.

- Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`

## User Roles

| Role | Access |
|------|--------|
| Admin | 관리자 비밀번호로 접속. 전체 현황, 소속/인원 관리, 엑셀 다운로드 |
| Approver | Admin이 지정. 소속 인원 시수 승인/반려 + 전자서명 |
| User | 일반 비밀번호로 접속. 시수 입력, 내 기록 조회 |

## Demo Mode

`CONFIG.API_URL`이 비어있으면 데모 모드로 동작합니다:
- 아무 비밀번호 → 일반 사용자
- `admin` → 관리자 대시보드
