# To Do List 프로젝트

## Firebase Hosting 배포 방법

### 1. Firebase CLI 설치
```bash
npm install -g firebase-tools
```

### 2. Firebase 로그인
```bash
firebase login
```

### 3. Firebase 프로젝트 초기화 (처음 한 번만)
```bash
firebase init hosting
```
- 기존 프로젝트 선택 또는 새 프로젝트 생성
- Public directory: `public`
- Single-page app: `Yes`
- Set up automatic builds: `No`

### 4. Storage 규칙 배포 (이미지 업로드 기능 사용 시 필수)
```bash
firebase deploy --only storage
```

### 5. 배포
```bash
firebase deploy --only hosting
```

또는 모든 것을 한 번에 배포:
```bash
firebase deploy
```

### 6. 배포 확인
배포가 완료되면 제공된 URL에서 확인할 수 있습니다.

## 프로젝트 구조

```
업로드/
├── firebase.json           # Firebase Hosting 설정 (rewrites 포함)
├── firestore.rules        # Firestore 보안 규칙
├── firestore.indexes.json # Firestore 인덱스 설정
├── storage.rules          # Firebase Storage 보안 규칙 (이미지 업로드)
├── public/                 # 배포 디렉토리
│   ├── index.html         # 메인 진입점 (SPA 라우터)
│   ├── pages/             # 페이지 파일들
│   │   ├── login.html
│   │   ├── hub.html
│   │   ├── todo.html
│   │   ├── attendance.html
│   │   └── gallery.html
│   ├── components/        # 공통 컴포넌트
│   │   └── navigation.html
│   ├── css/              # 스타일시트
│   │   ├── variables.css
│   │   └── common.css
│   └── js/               # JavaScript 모듈
│       ├── auth.js       # Firebase 인증
│       ├── common.js     # 공통 유틸리티
│       ├── router.js     # SPA 라우터
│       └── todo.js       # To Do 기능
```

---

## 개발 철학 및 가이드라인

### 🎯 핵심 원칙

1. **구조 이해 우선**: 코드 수정 전에 전체 구조와 데이터 흐름을 먼저 파악
2. **점진적 수정**: 한 번에 여러 부분을 수정하지 말고, 문제를 하나씩 해결
3. **안전한 에러 처리**: try-catch와 fallback 메커니즘을 적극 활용
4. **디버깅 최소화**: 핵심 문제만 디버깅하고, 불필요한 로그는 제거

---

## 아키텍처 패턴

### SPA (Single Page Application) 구조

#### 1. 메인 진입점: `index.html`
- 모든 요청의 진입점
- 전역 리소스(FullCalendar, Bootstrap 등)를 여기서 로드
- `app-container`에 페이지가 동적으로 로드됨

#### 2. 라우터 시스템: `router.js`
- 클라이언트 사이드 라우팅 관리
- `window.router.navigate(path)` 또는 `window.navigateTo(path)` 사용
- 페이지 전환 시 모든 리소스 로드 완료 후 화면 교체

#### 3. 페이지 파일: `pages/*.html`
- 독립적인 HTML 파일로 관리
- 각 페이지는 자체 스크립트와 스타일 포함 가능
- 라우터가 동적으로 로드

---

## 핵심 개발 패턴

### 1. 동적 컴포넌트 로딩 패턴

#### 문제: HTML을 동적으로 로드할 때 스크립트가 실행되지 않음
```javascript
// ❌ 잘못된 방법
const navClone = navElement.cloneNode(true);
container.appendChild(navClone);
// 스크립트가 복제되지만 실행되지 않음
```

#### 해결: 스크립트를 별도로 실행
```javascript
// ✅ 올바른 방법
const navClone = navElement.cloneNode(true);
const navScript = navClone.querySelector('script');
let scriptContent = null;

if (navScript) {
    scriptContent = navScript.textContent;
    navScript.remove(); // DOM에서 제거
}

container.appendChild(navClone);

// 스크립트 실행
if (scriptContent) {
    try {
        eval(scriptContent);
    } catch (e) {
        console.error('스크립트 실행 오류:', e);
    }
}
```

**적용 위치**: `router.js`, `index.html`의 네비게이션 로드 부분

---

### 2. 전역 함수 노출 패턴

#### 문제: 동적으로 로드된 컴포넌트의 함수에 접근 불가

#### 해결: `window` 객체에 함수 노출
```javascript
// ✅ 올바른 방법
window.setupNavigation = function() {
    // 네비게이션 초기화 로직
    function setupLogoutButton() {
        const logoutBtn = document.getElementById('nav-logout-btn');
        // 이벤트 연결
    }
    
    // 초기화 실행
    setupLogoutButton();
};

// 즉시 실행 또는 나중에 호출
window.setupNavigation();
```

**적용 위치**: `components/navigation.html`

---

### 3. 페이지 전환 최적화 패턴

#### 문제: 페이지 전환 시 깜빡임 발생

#### 해결: 모든 리소스 로드 완료 후 전환
```javascript
// ✅ 올바른 방법
async loadPage(path) {
    // 1. 현재 화면 유지 (아직 교체하지 않음)
    const appContainer = document.getElementById('app-container');
    
    // 2. 새 페이지 HTML 로드
    const html = await fetch(route).then(r => r.text());
    const doc = parser.parseFromString(html, 'text/html');
    
    // 3. 새 페이지 내용 준비
    let newContent = prepareContent(doc);
    
    // 4. 모든 스크립트 로드 완료 대기
    await Promise.all(scriptPromises);
    
    // 5. 모든 스타일 로드 완료 대기
    await Promise.all(stylePromises);
    
    // 6. 추가 렌더링 대기
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // 7. 모든 준비 완료 후 한 번에 교체
    appContainer.innerHTML = newContent;
    
    // 8. 초기화 이벤트 발생
    window.dispatchEvent(new CustomEvent('pageLoaded', { detail: { path } }));
}
```

**핵심**: 화면을 교체하기 전에 모든 리소스가 준비될 때까지 대기

---

### 4. 외부 라이브러리 로딩 패턴

#### 문제: 동적으로 로드된 페이지에서 외부 라이브러리 접근 불가

#### 해결: 전역으로 로드하고 `window`에 노출
```javascript
// ✅ index.html에서 전역 로드
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
<script>
    // 라이브러리가 로드되면 window에 노출
    (function() {
        function checkLibrary() {
            if (typeof FullCalendar !== 'undefined') {
                window.FullCalendar = FullCalendar;
                window.dispatchEvent(new CustomEvent('fullcalendarLoaded'));
            } else {
                setTimeout(checkLibrary, 100);
            }
        }
        checkLibrary();
    })();
</script>
```

**사용 예시**:
```javascript
// todo.js에서 사용
let FullCalendarLib = null;
try {
    if (typeof window !== 'undefined' && window.FullCalendar) {
        FullCalendarLib = window.FullCalendar;
    } else if (typeof FullCalendar !== 'undefined') {
        FullCalendarLib = FullCalendar;
    }
} catch (e) {
    // 안전하게 처리
}

if (!FullCalendarLib) {
    // 로드 이벤트 대기
    window.addEventListener('fullcalendarLoaded', () => {
        renderCalendar();
    });
}
```

---

### 5. 이벤트 리스너 중복 방지 패턴

#### 문제: 동적으로 추가된 요소에 이벤트 리스너가 중복 연결됨

#### 해결: 요소를 복제하여 교체
```javascript
// ✅ 올바른 방법
function setupLogoutButton() {
    const logoutBtn = document.getElementById('nav-logout-btn');
    
    if (logoutBtn) {
        // 기존 요소를 복제하여 교체 (이벤트 리스너 제거)
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        
        // 새 요소에 이벤트 연결
        newLogoutBtn.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            // 로직 실행
        };
    }
}
```

**적용 위치**: 모든 동적 이벤트 연결 부분

---

### 6. 안전한 전역 변수 접근 패턴

#### 문제: 전역 변수가 정의되지 않았을 때 에러 발생

#### 해결: 다단계 체크와 try-catch
```javascript
// ✅ 올바른 방법
let value = null;
try {
    if (typeof window !== 'undefined' && window.someVariable) {
        value = window.someVariable;
    } else if (typeof someVariable !== 'undefined') {
        value = someVariable;
    }
} catch (e) {
    // 안전하게 처리
}

if (!value) {
    // 대체 로직 또는 대기
}
```

---

### 7. 파일 버전 관리 패턴

#### 문제: 브라우저 캐시로 인해 변경사항이 반영되지 않음

#### 해결: 버전 쿼리 파라미터 사용
```html
<!-- ✅ 올바른 방법 -->
<script src="js/todo.js?v=4"></script>
<link rel="stylesheet" href="css/common.css?v=4">
```

**버전 업데이트 규칙**:
- 기능 변경 또는 버그 수정 시 버전 증가
- `index.html`의 모든 스크립트/스타일 버전 동기화

---

## 디버깅 가이드라인

### 1. 문제 파악 우선
- 콘솔 에러 메시지 확인
- 네트워크 탭에서 리소스 로드 상태 확인
- 요소 검사로 DOM 상태 확인

### 2. 구조 이해
- 코드 수정 전에 관련 파일들을 모두 읽고 구조 파악
- 데이터 흐름과 이벤트 흐름 추적

### 3. 점진적 수정
- 한 번에 하나의 문제만 해결
- 수정 후 즉시 테스트
- 문제가 해결되지 않으면 롤백하고 다른 접근 시도

### 4. 디버깅 로그 관리
- 개발 중에는 필요한 로그만 사용
- 배포 전에는 불필요한 로그 제거
- 에러 로그는 반드시 유지

---

## 에러 처리 원칙

### 1. 항상 try-catch 사용
```javascript
// ✅ 올바른 방법
try {
    // 위험한 작업
    const result = someFunction();
} catch (e) {
    console.error('에러 발생:', e);
    // fallback 로직
}
```

### 2. Fallback 메커니즘 제공
```javascript
// ✅ 올바른 방법
if (window.handleLogout && typeof window.handleLogout === 'function') {
    await window.handleLogout();
} else if (window.firebaseAuth) {
    // 대체 방법
    const { signOut } = await import("...");
    await signOut(window.firebaseAuth);
} else {
    console.error('로그아웃 함수를 찾을 수 없습니다.');
}
```

### 3. 안전한 DOM 조작
```javascript
// ✅ 올바른 방법
const element = document.getElementById('some-id');
if (element) {
    // 요소가 존재할 때만 조작
    element.innerHTML = '...';
}
```

---

## Firebase Hosting 설정

### SPA 라우팅 설정 (`firebase.json`)
```json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

**중요**: 모든 경로를 `index.html`로 리다이렉트하여 클라이언트 사이드 라우팅 활성화

---

## 네비게이션 컴포넌트 패턴

### 구조
- `components/navigation.html`: 네비게이션 HTML과 스크립트 포함
- 전역 함수 `window.setupNavigation()` 노출
- 라우터와 `index.html`에서 네비게이션 로드 후 `window.setupNavigation()` 호출

### 로드 순서
1. 네비게이션 HTML fetch
2. DOM 파싱 및 복제
3. 스크립트 추출 및 실행
4. `window.setupNavigation()` 호출
5. 로그아웃 버튼 등 이벤트 연결

---

## 페이지 전환 최적화

### 목표: 깜빡임 없는 부드러운 전환

### 구현 방법
1. **현재 화면 유지**: 새 페이지 준비 중에도 현재 화면 표시
2. **백그라운드 준비**: 
   - HTML 파싱
   - 스크립트 로드 및 실행
   - 스타일시트 로드
3. **완료 후 전환**: 모든 준비 완료 후 한 번에 화면 교체

### 핵심 코드 패턴
```javascript
// 모든 리소스 로드 완료 대기
await Promise.all(scriptPromises);
await Promise.all(stylePromises);
await new Promise(resolve => setTimeout(resolve, 50));

// 준비 완료 후 교체
appContainer.innerHTML = newContent;
```

---

## 외부 라이브러리 통합

### FullCalendar 통합 패턴
1. `index.html`에서 전역 로드
2. 로드 완료 시 `window.FullCalendar`에 할당
3. `fullcalendarLoaded` 이벤트 발생
4. 사용하는 페이지에서 이벤트 대기 또는 즉시 사용

### 커스터마이징
- `eventContent` 콜백으로 이벤트 내용 커스터마이징
- 담당자 태그 등 추가 정보 표시

---

## 코드 수정 체크리스트

코드를 수정할 때 다음을 확인하세요:

- [ ] 전체 구조를 이해했는가?
- [ ] 관련 파일들을 모두 읽었는가?
- [ ] 데이터 흐름을 추적했는가?
- [ ] 에러 처리가 안전한가?
- [ ] Fallback 메커니즘이 있는가?
- [ ] 동적 로드 시 스크립트 실행을 고려했는가?
- [ ] 전역 변수 접근이 안전한가?
- [ ] 이벤트 리스너 중복을 방지했는가?
- [ ] 파일 버전을 업데이트했는가?
- [ ] 불필요한 디버깅 로그를 제거했는가?

---

## 주의사항

### 1. 동적 스크립트 실행
- `cloneNode(true)`로 복제된 스크립트는 실행되지 않음
- 반드시 `eval()` 또는 별도 실행 필요

### 2. 전역 변수 접근
- `typeof` 체크로 안전하게 접근
- `window` 객체를 통한 접근 우선

### 3. 비동기 처리
- 네비게이션 로드, 스크립트 로드 등은 비동기
- `setTimeout`으로 DOM 렌더링 완료 대기 필요

### 4. 이벤트 리스너
- 동적으로 추가된 요소는 이벤트 리스너 재연결 필요
- 요소 복제 후 교체하여 중복 방지

### 5. 캐시 문제
- 파일 버전 쿼리 파라미터로 캐시 무효화
- 배포 후 강력 새로고침 (`Ctrl+Shift+R`) 권장

---

## 개발 워크플로우

1. **문제 파악**: 콘솔 에러, 네트워크 상태, DOM 상태 확인
2. **구조 이해**: 관련 파일 읽기, 데이터 흐름 추적
3. **점진적 수정**: 한 번에 하나씩, 테스트하며 진행
4. **안전한 구현**: try-catch, fallback, 안전한 DOM 조작
5. **검증**: 배포 전 로컬 테스트, 불필요한 로그 제거
6. **배포**: 파일 버전 업데이트 후 배포

---

## 로컬 개발 환경 (선택사항)

로컬에서 테스트하려면 다음 방법을 사용할 수 있습니다:

### 방법 1: Firebase Emulator
```bash
firebase emulators:start --only hosting
```

### 방법 2: Python 서버
```bash
python -m http.server 8000
```

### 방법 3: VS Code Live Server 확장 프로그램
1. VS Code에서 "Live Server" 확장 프로그램 설치
2. `index.html` 파일에서 우클릭 → "Open with Live Server"

## 이미지 업로드 기능

### 개요
- 각 Activity별로 이미지를 업로드하고 관리할 수 있습니다
- 드래그 앤 드롭 또는 파일 선택으로 업로드 가능
- 이미지 갤러리 뷰 및 라이트박스 지원
- Firebase Storage에 저장되며, Firestore의 Activity 문서에 메타데이터 저장

### 데이터 구조
```javascript
activity: {
  id: 'a1',
  name: 'Activity 이름',
  images: [
    {
      url: 'https://firebasestorage.../image.jpg',
      uploadedAt: '2024-01-15T10:30:00Z',
      uploadedBy: 'user@example.com',
      fileName: 'image.jpg',
      size: 123456
    }
  ]
}
```

### Storage 경로 구조
```
workspaces/{wsId}/tasks/{taskId}/activities/{activityId}/images/{imageId}_{fileName}
```

### 제한사항
- 파일 크기: 최대 10MB
- 파일 타입: 이미지 파일만 허용 (`image/*`)
- 권한: OWNER, ADMIN, PLANNER만 업로드/삭제 가능

### Storage 규칙 배포
이미지 업로드 기능을 사용하려면 반드시 Storage 규칙을 배포해야 합니다:
```bash
firebase deploy --only storage
```

## 중요 사항

⚠️ **직접 파일을 열면 CORS 에러가 발생합니다!**
- `file://` 프로토콜로는 ES6 모듈과 fetch API를 사용할 수 없습니다.
- 반드시 웹 서버를 통해 실행해야 합니다.

⚠️ **Storage 규칙 배포 필수**
- 이미지 업로드 기능을 사용하려면 `firebase deploy --only storage` 명령으로 Storage 규칙을 배포해야 합니다.
