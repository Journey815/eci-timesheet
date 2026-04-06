/* ============================================================
   ECI 시수관리 - app.js
   Vanilla JS, no frameworks
   ============================================================ */

'use strict';

/* --- CONFIG --- */
const CONFIG = {
  API_URL: '', // Google Apps Script web app URL - user fills this in after deploying
  APP_TITLE: 'ECI 시수관리',
};

/* ============================================================
   STATE
   ============================================================ */
const STATE = {
  // Auth
  authenticated: false,
  isAdmin: false,
  selectedName: null,
  loginAt: null,

  // Data
  members: [],           // [{ name, role, rate, active, department, email }]
  categories: [],        // string[]
  allEntries: [],        // [{ id, name, date, category, description, hours, status, approverName, approvedAt, signatureId, rejectionReason }]
  projectStartDate: null, // 'YYYY-MM-DD'
  departments: [],       // [{ name, approverName, approverEmail }]

  // Draft (unsaved entries for today)
  draft: [],             // [{ tempId, date, category, description, hours }]

  // Approval (approver role)
  isApprover: false,          // current user is an approver
  approverDepartments: [],    // department names this user approves for
  signatureData: null,        // current approver's signature base64

  // Admin UI
  adminTab: 'status',    // 'status' | 'members' | 'excel' | 'departments'
  statusView: 'weekly',  // 'weekly' | 'monthly' | 'category'
  exportStartDate: '',
  exportEndDate: '',
  exportIncludeAll: false,
};

/* ============================================================
   LOCALSTORAGE
   ============================================================ */
const LS = {
  SESSION_KEY: 'eci_session',
  DRAFT_KEY: 'eci_draft',

  saveSession() {
    localStorage.setItem(LS.SESSION_KEY, JSON.stringify({
      authenticated: STATE.authenticated,
      isAdmin: STATE.isAdmin,
      selectedName: STATE.selectedName,
      loginAt: STATE.loginAt,
      isApprover: STATE.isApprover,
      approverDepartments: STATE.approverDepartments,
    }));
  },

  loadSession() {
    const raw = localStorage.getItem(LS.SESSION_KEY);
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      STATE.authenticated = s.authenticated || false;
      STATE.isAdmin = s.isAdmin || false;
      STATE.selectedName = s.selectedName || null;
      STATE.loginAt = s.loginAt || null;
      STATE.isApprover = s.isApprover || false;
      STATE.approverDepartments = s.approverDepartments || [];
      return STATE.authenticated;
    } catch { return false; }
  },

  clearSession() {
    localStorage.removeItem(LS.SESSION_KEY);
    STATE.authenticated = false;
    STATE.isAdmin = false;
    STATE.selectedName = null;
    STATE.loginAt = null;
    STATE.isApprover = false;
    STATE.approverDepartments = [];
    STATE.signatureData = null;
  },

  saveDraft() {
    localStorage.setItem(LS.DRAFT_KEY, JSON.stringify({ entries: STATE.draft }));
  },

  loadDraft() {
    const raw = localStorage.getItem(LS.DRAFT_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      STATE.draft = d.entries || [];
    } catch { STATE.draft = []; }
  },

  clearDraft() {
    localStorage.removeItem(LS.DRAFT_KEY);
    STATE.draft = [];
  },

  getLastName() {
    const raw = localStorage.getItem(LS.SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw).selectedName; } catch { return null; }
  },
};

/* ============================================================
   API
   ============================================================ */
async function apiGet(action, params = {}) {
  if (!CONFIG.API_URL) throw new Error('API_URL이 설정되지 않았습니다.');
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  return res.json();
}

async function apiPost(action, data = {}) {
  if (!CONFIG.API_URL) throw new Error('API_URL이 설정되지 않았습니다.');
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // GAS CORS workaround
    body: JSON.stringify({ action, ...data }),
  });
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  return res.json();
}

/* ============================================================
   UI UTILITIES
   ============================================================ */

// Loading overlay
const loadingOverlay = document.getElementById('loading-overlay');
let loadingCount = 0;
function showLoading() { loadingCount++; loadingOverlay.classList.add('visible'); }
function hideLoading() { loadingCount = Math.max(0, loadingCount - 1); if (loadingCount === 0) loadingOverlay.classList.remove('visible'); }

// Toast
const toastContainer = document.getElementById('toast-container');
function showToast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span class="toast-msg">${msg}</span>
    <button class="toast-close" aria-label="닫기">✕</button>`;
  el.querySelector('.toast-close').addEventListener('click', () => removeToast(el));
  toastContainer.appendChild(el);
  setTimeout(() => removeToast(el), duration);
}
function removeToast(el) {
  if (!el.parentNode) return;
  el.classList.add('toast-fade-out');
  setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 250);
}

// Modal confirm
const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
let modalResolve = null;

function showConfirm(title, message, confirmText = '확인', dangerConfirm = true) {
  return new Promise(resolve => {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalConfirmBtn.textContent = confirmText;
    modalConfirmBtn.className = dangerConfirm ? 'btn-danger' : 'btn-submit';
    modalResolve = resolve;
    modalBackdrop.classList.add('visible');
    modalConfirmBtn.focus();
  });
}

modalConfirmBtn.addEventListener('click', () => { modalBackdrop.classList.remove('visible'); if (modalResolve) { modalResolve(true); modalResolve = null; } });
modalCancelBtn.addEventListener('click', () => { modalBackdrop.classList.remove('visible'); if (modalResolve) { modalResolve(false); modalResolve = null; } });
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) { modalBackdrop.classList.remove('visible'); if (modalResolve) { modalResolve(false); modalResolve = null; } } });

// View switching
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(id);
  if (view) view.classList.add('active');
}

/* ============================================================
   DATE / WEEK UTILITIES
   ============================================================ */
function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dateStr} (${days[d.getDay()]})`;
}

function formatCurrency(amount) {
  return '₩' + Math.round(amount).toLocaleString('ko-KR');
}

function formatHours(h) {
  return parseFloat(h).toFixed(1) + 'h';
}

function formatTimeRange(startTime, endTime) {
  if (startTime && endTime) return `${startTime}~${endTime}`;
  return '';
}

function calcHours(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return Math.round(diff / 30) * 0.5; // round to 0.5h
}

// Get week number relative to projectStartDate
function getWeekNumber(dateStr) {
  const start = STATE.projectStartDate ? new Date(STATE.projectStartDate + 'T00:00:00') : new Date('2025-01-01T00:00:00');
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((d - start) / (1000 * 60 * 60 * 24));
  return Math.floor(diff / 7) + 1;
}

function getWeekRange(weekNum) {
  const start = STATE.projectStartDate ? new Date(STATE.projectStartDate + 'T00:00:00') : new Date('2025-01-01T00:00:00');
  const wStart = new Date(start.getTime() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000);
  const wEnd = new Date(wStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { start: wStart.toISOString().split('T')[0], end: wEnd.toISOString().split('T')[0] };
}

function getYearMonth(dateStr) {
  return dateStr.substring(0, 7); // 'YYYY-MM'
}

function thisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  return { start: fmt(mon), end: fmt(sun) };
}

function thisMonthRange() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const end = last.toISOString().split('T')[0];
  return { start, end };
}

/* ============================================================
   DATA HELPERS
   ============================================================ */
function filterEntries(entries, { name, startDate, endDate, category } = {}) {
  return entries.filter(e => {
    if (name && e.name !== name) return false;
    if (startDate && e.date < startDate) return false;
    if (endDate && e.date > endDate) return false;
    if (category && category !== '전체' && e.category !== category) return false;
    return true;
  });
}

function sumHours(entries) {
  return entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);
}

function getMemberRate(name) {
  const m = STATE.members.find(m => m.name === name);
  return m ? (parseFloat(m.rate) || 0) : 0;
}

function getMemberRole(name) {
  const m = STATE.members.find(m => m.name === name);
  return m ? (m.role || '') : '';
}

/* ============================================================
   DEMO / MOCK DATA (used when API_URL is empty)
   ============================================================ */
function loadMockData() {
  STATE.projectStartDate = '2025-01-06';
  STATE.categories = ['Meeting', 'Client Interactive', 'JV Internal', 'Design', 'Documentation', 'Site Visit', 'Training', 'Other'];

  // Departments
  STATE.departments = [
    { name: 'Design', approverName: '이민준', approverEmail: 'minjun@example.com' },
    { name: 'Planning', approverName: '김지수', approverEmail: 'jisu@example.com' },
    { name: 'Sales', approverName: '박서연', approverEmail: 'seoyeon@example.com' },
  ];

  STATE.members = [
    { name: '김지수', role: '기획', rate: 35000, active: true, department: 'Planning', email: 'jisu@example.com' },
    { name: '이민준', role: '디자인', rate: 40000, active: true, department: 'Design', email: 'minjun@example.com' },
    { name: '박서연', role: '영업', rate: 30000, active: true, department: 'Sales', email: 'seoyeon@example.com' },
    { name: '최유진', role: '운영', rate: 28000, active: true, department: 'Planning', email: 'yujin@example.com' },
    { name: '정다은', role: '기획', rate: 35000, active: true, department: 'Design', email: 'daeun@example.com' },
    { name: '한승우', role: '디자인', rate: 40000, active: false, department: 'Design', email: 'seungwoo@example.com' },
  ];

  // Generate sample entries (older ones approved, recent few pending)
  const now = new Date();
  const entries = [];
  let id = 1;
  STATE.members.filter(m => m.active).forEach(m => {
    for (let d = 0; d < 30; d++) {
      const date = new Date(now);
      date.setDate(now.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const numEntries = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < numEntries; i++) {
        const cat = STATE.categories[Math.floor(Math.random() * (STATE.categories.length - 1))];
        const startH = 8 + Math.floor(Math.random() * 8);
        const duration = [1, 1.5, 2, 2.5, 3][Math.floor(Math.random() * 5)];
        const endH = startH + duration;
        const startTime = `${String(startH).padStart(2,'0')}:00`;
        const endTime = `${String(Math.min(endH, 23)).padStart(2,'0')}:${endH % 1 === 0.5 ? '30' : '00'}`;
        // Recent entries (last 2 days) are pending; older are approved
        const status = d < 2 ? 'pending' : 'approved';
        const approverName = status === 'approved' ? getDeptApprover(m.name) : null;
        const approvedAt = status === 'approved' ? new Date(date.getTime() + 86400000).toISOString() : null;
        entries.push({
          id: String(id++),
          name: m.name,
          date: dateStr,
          category: cat,
          description: `${cat} related work`,
          hours: duration,
          startTime,
          endTime,
          status,
          approverName,
          approvedAt,
          signatureId: null,
          rejectionReason: null,
        });
      }
    }
  });
  STATE.allEntries = entries;
}

function getDeptApprover(memberName) {
  const member = STATE.members.find(m => m.name === memberName);
  if (!member || !member.department) return null;
  const dept = STATE.departments.find(d => d.name === member.department);
  return dept ? dept.approverName : null;
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  loadMockData(); // always load mock as fallback
  LS.loadDraft();

  const hasSession = LS.loadSession();
  if (hasSession && STATE.selectedName) {
    if (STATE.isAdmin) {
      initAdminDashboard();
    } else {
      initEntryView();
    }
  } else {
    initLoginView();
  }
});

/* ============================================================
   LOGIN VIEW
   ============================================================ */
function initLoginView() {
  if (!CONFIG.API_URL) {
    document.getElementById('login-setup-notice').style.display = 'block';
    document.getElementById('login-form-section').style.display = 'block';
  } else {
    document.getElementById('login-setup-notice').style.display = 'none';
    document.getElementById('login-form-section').style.display = 'block';
  }

  showView('view-login');

  const form = document.getElementById('login-form');

  // Remove previous listeners by cloning
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  const passwordInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  passwordInput.value = '';
  errorEl.classList.remove('visible');

  newForm.addEventListener('submit', async e => {
    e.preventDefault();
    const pw = document.getElementById('login-password').value.trim();
    if (!pw) return;

    const errEl = document.getElementById('login-error');
    errEl.classList.remove('visible');

    if (!CONFIG.API_URL) {
      // Demo mode: any password works, "admin" → admin
      if (pw === 'admin') {
        STATE.authenticated = true;
        STATE.isAdmin = true;
        STATE.loginAt = new Date().toISOString();
        LS.saveSession();
        initAdminDashboard();
      } else {
        STATE.authenticated = true;
        STATE.isAdmin = false;
        STATE.loginAt = new Date().toISOString();
        LS.saveSession();
        initUserSelectView();
      }
      return;
    }

    showLoading();
    try {
      // Try user (also accepts admin password)
      const res = await apiGet('verifyPassword', { password: pw, type: 'user' });
      if (res.valid) {
        STATE.authenticated = true;
        STATE.isAdmin = res.isAdmin || false;
        STATE.loginAt = new Date().toISOString();
        LS.saveSession();
        await loadAppData();
        hideLoading();
        if (STATE.isAdmin) {
          initAdminDashboard();
        } else {
          initUserSelectView();
        }
      } else {
        hideLoading();
        errEl.textContent = '비밀번호가 올바르지 않습니다.';
        errEl.classList.add('visible');
        document.getElementById('login-password').select();
      }
    } catch (err) {
      hideLoading();
      errEl.textContent = `오류: ${err.message}`;
      errEl.classList.add('visible');
    }
  });
}

async function loadAppData() {
  try {
    const [membersRes, configRes, entriesRes, deptRes] = await Promise.all([
      apiGet('getMembers'),
      apiGet('getConfig'),
      apiGet('getAllEntries'),
      apiGet('getDepartments').catch(() => []),
    ]);
    // getMembers returns array directly
    if (Array.isArray(membersRes)) {
      STATE.members = membersRes.map(m => ({
        name: m.name,
        role: m.role,
        rate: m.hourlyRate || 0,
        active: m.isActive !== false,
        department: m.department || '',
        email: m.email || '',
      }));
    }
    // getConfig returns {key: value} object; categories is comma-separated string
    if (configRes && typeof configRes === 'object') {
      if (configRes.categories) STATE.categories = configRes.categories.split(',').map(s => s.trim()).filter(Boolean);
      if (configRes.projectStartDate) STATE.projectStartDate = configRes.projectStartDate;
    }
    // getAllEntries returns array directly
    if (Array.isArray(entriesRes)) STATE.allEntries = entriesRes;
    // getDepartments
    if (Array.isArray(deptRes)) STATE.departments = deptRes;
    // Recompute approver status after loading data
    if (STATE.selectedName) {
      STATE.isApprover = STATE.departments.some(d => d.approverName === STATE.selectedName);
      STATE.approverDepartments = STATE.departments.filter(d => d.approverName === STATE.selectedName).map(d => d.name);
      LS.saveSession();
    }
  } catch (err) {
    showToast('데이터 로드 실패. 데모 데이터를 사용합니다.', 'warning');
  }
}

/* ============================================================
   USER SELECT VIEW
   ============================================================ */
function initUserSelectView() {
  showView('view-user-select');
  renderUserSelect();
}

function renderUserSelect() {
  const searchInput = document.getElementById('user-search');
  const list = document.getElementById('member-radio-list');
  const startBtn = document.getElementById('btn-start');
  const logoutBtn = document.getElementById('user-select-logout');

  const lastUsed = LS.getLastName();
  let selectedName = STATE.selectedName || lastUsed || null;

  function renderList(filter = '') {
    const members = STATE.members.filter(m => m.active && (!filter || m.name.includes(filter)));
    list.innerHTML = '';
    if (members.length === 0) {
      list.innerHTML = '<li style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.85rem;">일치하는 이름이 없습니다</li>';
      startBtn.disabled = true;
      return;
    }
    members.forEach(m => {
      const li = document.createElement('li');
      const id = `radio-${m.name}`;
      li.innerHTML = `<label for="${id}">
        <input type="radio" name="member" id="${id}" value="${m.name}" ${selectedName === m.name ? 'checked' : ''}>
        <span class="member-label-text">${m.name}</span>
        <span class="member-role-tag">${m.role}</span>
      </label>`;
      li.querySelector('input').addEventListener('change', () => {
        selectedName = m.name;
        startBtn.disabled = false;
      });
      list.appendChild(li);
    });
    startBtn.disabled = !selectedName;
  }

  renderList();

  searchInput.addEventListener('input', () => renderList(searchInput.value.trim()));

  startBtn.addEventListener('click', () => {
    if (!selectedName) return;
    STATE.selectedName = selectedName;
    // Determine approver status
    STATE.isApprover = STATE.departments.some(d => d.approverName === selectedName);
    STATE.approverDepartments = STATE.departments.filter(d => d.approverName === selectedName).map(d => d.name);
    LS.saveSession();
    initEntryView();
  });

  logoutBtn.addEventListener('click', logout);
}

/* ============================================================
   ENTRY VIEW
   ============================================================ */
function initEntryView() {
  showView('view-entry');
  renderEntryHeader();
  renderEntryForm();
  renderDraftList();

  // Show/hide approval tab
  const approvalTab = document.getElementById('tab-approval');
  approvalTab.style.display = STATE.isApprover ? 'inline-block' : 'none';
  updatePendingBadge();

  // Tab switching — clone to remove stale listeners
  const tabEntry = document.getElementById('tab-entry');
  const tabRecords = document.getElementById('tab-records');

  const newTabEntry = tabEntry.cloneNode(true);
  tabEntry.parentNode.replaceChild(newTabEntry, tabEntry);
  const newTabRecords = tabRecords.cloneNode(true);
  tabRecords.parentNode.replaceChild(newTabRecords, tabRecords);
  const newTabApproval = approvalTab.cloneNode(true);
  approvalTab.parentNode.replaceChild(newTabApproval, approvalTab);

  newTabEntry.addEventListener('click', () => setEntryTab('entry'));
  newTabRecords.addEventListener('click', () => setEntryTab('records'));
  newTabApproval.addEventListener('click', () => setEntryTab('approval'));

  // Logout
  document.getElementById('entry-logout').addEventListener('click', logout);
}

function updatePendingBadge() {
  const badge = document.getElementById('pending-badge');
  if (!badge) return;
  if (!STATE.isApprover) { badge.textContent = ''; return; }
  const count = getPendingForApprover().length;
  badge.textContent = count > 0 ? String(count) : '';
}

function getPendingForApprover() {
  return STATE.allEntries.filter(e => {
    if (e.status !== 'pending') return false;
    const member = STATE.members.find(m => m.name === e.name);
    if (!member) return false;
    return STATE.approverDepartments.includes(member.department);
  });
}

function setEntryTab(tab) {
  const tabEntry = document.getElementById('tab-entry');
  const tabRecords = document.getElementById('tab-records');
  const tabApproval = document.getElementById('tab-approval');

  tabEntry.classList.toggle('active', tab === 'entry');
  tabRecords.classList.toggle('active', tab === 'records');
  if (tabApproval) tabApproval.classList.toggle('active', tab === 'approval');

  document.getElementById('entry-form-section').style.display = tab === 'entry' ? 'block' : 'none';
  document.getElementById('records-section').style.display = tab === 'records' ? 'block' : 'none';
  document.getElementById('approval-section').style.display = tab === 'approval' ? 'block' : 'none';

  if (tab === 'records') renderRecordsView();
  if (tab === 'approval') renderApprovalView();
}

function renderEntryHeader() {
  document.getElementById('entry-user-name').textContent = `${STATE.selectedName}님`;
}

function renderEntryForm() {
  const dateInput = document.getElementById('entry-date');
  const categoryInput = document.getElementById('entry-category');
  const categoryList = document.getElementById('category-list');
  const startTimeInput = document.getElementById('entry-start-time');
  const endTimeInput = document.getElementById('entry-end-time');
  const hoursDisplay = document.getElementById('entry-hours-display');
  const descInput = document.getElementById('entry-description');
  const addBtn = document.getElementById('btn-add-entry');
  const submitBtn = document.getElementById('btn-submit-entries');
  const form = document.getElementById('entry-form');

  // Set default date
  dateInput.value = today();

  // Populate category datalist
  categoryList.innerHTML = '';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    categoryList.appendChild(opt);
  });

  // Auto-calculate hours from start/end time
  function updateHoursDisplay() {
    const start = startTimeInput.value;
    const end = endTimeInput.value;
    if (start && end) {
      const h = calcHours(start, end);
      hoursDisplay.innerHTML = `시간: <strong>${h.toFixed(1)}h</strong>`;
    } else {
      hoursDisplay.innerHTML = '시간: <strong>0.0h</strong>';
    }
  }
  startTimeInput.addEventListener('change', updateHoursDisplay);
  endTimeInput.addEventListener('change', updateHoursDisplay);

  addBtn.addEventListener('click', () => {
    const date = dateInput.value;
    const category = categoryInput.value.trim();
    const startTime = startTimeInput.value;
    const endTime = endTimeInput.value;
    const description = descInput.value.trim();

    if (!date) { showToast('날짜를 선택해주세요.', 'warning'); return; }
    if (!startTime || !endTime) { showToast('시작/종료 시간을 입력해주세요.', 'warning'); startTimeInput.focus(); return; }
    const hours = calcHours(startTime, endTime);
    if (hours <= 0) { showToast('종료 시간이 시작 시간보다 뒤여야 합니다.', 'warning'); endTimeInput.focus(); return; }
    if (!category) { showToast('카테고리를 입력해주세요.', 'warning'); categoryInput.focus(); return; }
    if (!description) { showToast('업무 내용을 입력해주세요.', 'warning'); descInput.focus(); return; }

    // Add new category to list if not exists
    if (!STATE.categories.includes(category)) {
      STATE.categories.push(category);
      const opt = document.createElement('option');
      opt.value = category;
      categoryList.appendChild(opt);
    }

    STATE.draft.push({
      tempId: Date.now() + Math.random(),
      date,
      category,
      description,
      hours,
      startTime,
      endTime,
    });
    LS.saveDraft();
    renderDraftList();
    descInput.value = '';
    categoryInput.value = '';
    startTimeInput.value = '';
    endTimeInput.value = '';
    updateHoursDisplay();
    descInput.focus();
    showToast('추가되었습니다.', 'success', 1500);
  });

  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target === descInput) {
      e.preventDefault();
      addBtn.click();
    }
  });

  submitBtn.addEventListener('click', submitEntries);
}

function renderDraftList() {
  const container = document.getElementById('draft-entries-container');
  const submitBtn = document.getElementById('btn-submit-entries');

  if (STATE.draft.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span>추가된 항목이 없습니다.<br>위 폼에서 업무를 입력해주세요.</div>`;
    submitBtn.disabled = true;
    return;
  }

  submitBtn.disabled = false;
  const total = sumHours(STATE.draft);

  const table = document.createElement('table');
  table.className = 'entries-table';
  table.innerHTML = `<thead><tr>
    <th class="col-time">시간</th>
    <th class="col-category">카테고리</th>
    <th>업무 내용</th>
    <th class="col-hours">소요</th>
    <th class="col-action"></th>
  </tr></thead>`;

  const tbody = document.createElement('tbody');
  STATE.draft.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-time">${formatTimeRange(entry.startTime, entry.endTime)}</td>
      <td><span class="tag tag-blue">${escapeHtml(entry.category)}</span></td>
      <td>${escapeHtml(entry.description)}</td>
      <td class="col-hours">${entry.hours.toFixed(1)}h</td>
      <td class="col-action"><button class="btn-icon" aria-label="삭제" data-idx="${idx}">✕</button></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);

  const totalRow = document.createElement('div');
  totalRow.className = 'total-row';
  totalRow.innerHTML = `<span>오늘 합계</span><span>${total.toFixed(1)}h</span>`;
  container.appendChild(totalRow);

  // Delete buttons
  tbody.querySelectorAll('.btn-icon').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      STATE.draft.splice(idx, 1);
      LS.saveDraft();
      renderDraftList();
    });
  });
}

async function submitEntries() {
  if (STATE.draft.length === 0) return;
  const confirmed = await showConfirm('시수 제출', `${STATE.draft.length}개 항목을 제출하시겠습니까?`, '제출하기', false);
  if (!confirmed) return;

  if (!CONFIG.API_URL) {
    // Demo mode: just push to allEntries with pending status
    STATE.draft.forEach(d => {
      STATE.allEntries.push({
        id: String(Date.now() + Math.random()),
        name: STATE.selectedName,
        date: d.date,
        category: d.category,
        description: d.description,
        hours: d.hours,
        startTime: d.startTime || '',
        endTime: d.endTime || '',
        status: 'pending',
        approverName: null,
        approvedAt: null,
        signatureId: null,
        rejectionReason: null,
      });
    });
    showToast('제출되었습니다! (데모 모드)', 'success');
    LS.clearDraft();
    renderDraftList();
    showSubmittedResult();
    updatePendingBadge();
    return;
  }

  showLoading();
  try {
    const results = await Promise.all(STATE.draft.map(d => apiPost('addEntry', {
      name: STATE.selectedName,
      date: d.date,
      category: d.category,
      description: d.description,
      hours: d.hours,
      startTime: d.startTime || '',
      endTime: d.endTime || '',
    })));

    // Refresh all entries
    const entriesRes = await apiGet('getAllEntries');
    if (Array.isArray(entriesRes)) STATE.allEntries = entriesRes;

    // 승인자에게 이메일 알림
    const totalHours = STATE.draft.reduce((s, d) => s + parseFloat(d.hours || 0), 0);
    apiPost('notifyApprover', {
      submitterName: STATE.selectedName,
      entryCount: STATE.draft.length,
      totalHours: totalHours.toFixed(1),
    }).catch(() => {}); // 이메일 실패해도 무시

    LS.clearDraft();
    renderDraftList();
    showToast('제출되었습니다!', 'success');
    showSubmittedResult();
    updatePendingBadge();
  } catch (err) {
    showToast(`제출 실패: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

function showSubmittedResult() {
  const dateInput = document.getElementById('entry-date');
  const date = dateInput.value || today();
  const todayEntries = filterEntries(STATE.allEntries, { name: STATE.selectedName, startDate: date, endDate: date });

  const noticeEl = document.getElementById('submitted-entries-notice');
  if (todayEntries.length > 0) {
    noticeEl.style.display = 'block';
    const total = sumHours(todayEntries);
    noticeEl.innerHTML = `<div class="submitted-notice">✓ ${date} 제출 완료 — ${todayEntries.length}건, 합계 ${total.toFixed(1)}h</div>`;
  }
}

/* ============================================================
   MY RECORDS VIEW
   ============================================================ */
function renderRecordsView() {
  const container = document.getElementById('records-container');
  const periodSelect = document.getElementById('records-period');
  const categorySelect = document.getElementById('records-category');

  // Populate categories filter
  categorySelect.innerHTML = '<option value="전체">전체 카테고리</option>';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  function refresh() {
    const period = periodSelect.value;
    const category = categorySelect.value;

    let startDate, endDate;
    if (period === 'week') { const r = thisWeekRange(); startDate = r.start; endDate = r.end; }
    else if (period === 'month') { const r = thisMonthRange(); startDate = r.start; endDate = r.end; }

    const entries = filterEntries(STATE.allEntries, {
      name: STATE.selectedName,
      startDate,
      endDate,
      category: category !== '전체' ? category : undefined,
    }).sort((a, b) => b.date.localeCompare(a.date));

    renderRecordsGroups(container, entries);
  }

  // Remove duplicate event listeners by cloning
  const newPeriod = periodSelect.cloneNode(true);
  periodSelect.parentNode.replaceChild(newPeriod, periodSelect);
  const newCategory = categorySelect.cloneNode(true);
  categorySelect.parentNode.replaceChild(newCategory, categorySelect);

  // Re-populate after clone
  newCategory.innerHTML = '<option value="전체">전체 카테고리</option>';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    newCategory.appendChild(opt);
  });

  newPeriod.addEventListener('change', () => {
    const period = newPeriod.value;
    const category = newCategory.value;
    let startDate, endDate;
    if (period === 'week') { const r = thisWeekRange(); startDate = r.start; endDate = r.end; }
    else if (period === 'month') { const r = thisMonthRange(); startDate = r.start; endDate = r.end; }
    const entries = filterEntries(STATE.allEntries, { name: STATE.selectedName, startDate, endDate, category: category !== '전체' ? category : undefined }).sort((a, b) => b.date.localeCompare(a.date));
    renderRecordsGroups(container, entries);
  });

  newCategory.addEventListener('change', () => {
    const period = newPeriod.value;
    const category = newCategory.value;
    let startDate, endDate;
    if (period === 'week') { const r = thisWeekRange(); startDate = r.start; endDate = r.end; }
    else if (period === 'month') { const r = thisMonthRange(); startDate = r.start; endDate = r.end; }
    const entries = filterEntries(STATE.allEntries, { name: STATE.selectedName, startDate, endDate, category: category !== '전체' ? category : undefined }).sort((a, b) => b.date.localeCompare(a.date));
    renderRecordsGroups(container, entries);
  });

  refresh();
}

function renderRecordsGroups(container, entries) {
  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📂</span>해당 기간의 기록이 없습니다.</div>`;
    document.getElementById('records-period-total').innerHTML = '';
    return;
  }

  // Group by date
  const groups = {};
  entries.forEach(e => { if (!groups[e.date]) groups[e.date] = []; groups[e.date].push(e); });
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  container.innerHTML = '';
  dates.forEach(date => {
    const dayEntries = groups[date];
    const dayTotal = sumHours(dayEntries);

    const groupEl = document.createElement('div');
    groupEl.className = 'records-group';

    const header = document.createElement('div');
    header.className = 'records-date-header';
    header.innerHTML = `<span class="date-text">${formatDate(date)}</span><span class="daily-total">${dayTotal.toFixed(1)}h</span>`;
    groupEl.appendChild(header);

    const table = document.createElement('table');
    table.className = 'records-table';
    table.innerHTML = `<thead><tr><th>시간</th><th>카테고리</th><th>업무 내용</th><th style="text-align:right">소요</th><th>상태</th><th style="text-align:right">관리</th></tr></thead>`;

    const tbody = document.createElement('tbody');
    dayEntries.forEach(entry => {
      tbody.appendChild(createRecordRow(entry, table, container, entries));
    });
    table.appendChild(tbody);
    groupEl.appendChild(table);
    container.appendChild(groupEl);
  });

  const total = sumHours(entries);
  document.getElementById('records-period-total').innerHTML =
    `<span>기간 합계</span><span>${total.toFixed(1)}h</span>`;
}

function createRecordRow(entry, table, container, allCurrentEntries) {
  const tr = document.createElement('tr');
  tr.dataset.entryId = entry.id;

  function getStatusBadgeHtml(status) {
    if (!status || status === 'approved') return '<span class="status-badge status-approved">승인</span>';
    if (status === 'pending') return '<span class="status-badge status-pending">대기</span>';
    if (status === 'rejected') return '<span class="status-badge status-rejected">반려</span>';
    return '';
  }

  function renderNormal() {
    const timeRange = formatTimeRange(entry.startTime, entry.endTime);
    const isRejected = entry.status === 'rejected';
    const canEdit = !entry.status || entry.status === 'pending' || entry.status === 'rejected';
    tr.innerHTML = `
      <td class="td-time">${timeRange || '-'}</td>
      <td><span class="tag tag-blue">${escapeHtml(entry.category)}</span></td>
      <td>
        ${escapeHtml(entry.description)}
        ${isRejected && entry.rejectionReason ? `<div class="rejection-reason-display">반려 사유: ${escapeHtml(entry.rejectionReason)}</div>` : ''}
      </td>
      <td class="td-hours">${parseFloat(entry.hours).toFixed(1)}h</td>
      <td>${getStatusBadgeHtml(entry.status || 'approved')}</td>
      <td class="td-actions">
        ${canEdit ? `<button class="btn-icon edit" title="${isRejected ? '수정 후 재제출' : '수정'}" data-action="edit">✏</button>` : ''}
        <button class="btn-icon" title="삭제" data-action="delete">🗑</button>
      </td>`;

    if (canEdit) tr.querySelector('[data-action="edit"]').addEventListener('click', () => renderEditMode());
    tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteRecord(entry));
  }

  function renderEditMode() {
    const catListId = `edit-cat-list-${entry.id}`;
    const catDatalist = STATE.categories.map(c => `<option value="${c}">`).join('');

    tr.innerHTML = `
      <td><input class="edit-input" type="time" value="${entry.startTime || ''}" style="width:90px" data-field="start">
          <input class="edit-input" type="time" value="${entry.endTime || ''}" style="width:90px" data-field="end"></td>
      <td><input class="edit-input" type="text" list="${catListId}" value="${escapeHtml(entry.category)}" style="width:100%" data-field="cat"><datalist id="${catListId}">${catDatalist}</datalist></td>
      <td><input class="edit-input" type="text" value="${escapeHtml(entry.description)}" style="width:100%;min-width:140px" data-field="desc"></td>
      <td class="td-hours" id="edit-hours-${entry.id}">-</td>
      <td class="td-actions"><div class="edit-actions-cell">
        <button class="btn-save-edit">저장</button>
        <button class="btn-cancel-edit">취소</button>
      </div></td>`;

    const startInput = tr.querySelector('[data-field="start"]');
    const endInput = tr.querySelector('[data-field="end"]');
    const hoursCell = document.getElementById(`edit-hours-${entry.id}`);

    function updateEditHours() {
      if (startInput.value && endInput.value) {
        hoursCell.textContent = calcHours(startInput.value, endInput.value).toFixed(1) + 'h';
      }
    }
    startInput.addEventListener('change', updateEditHours);
    endInput.addEventListener('change', updateEditHours);
    updateEditHours();

    tr.querySelector('.btn-save-edit').addEventListener('click', async () => {
      const newStartTime = startInput.value;
      const newEndTime = endInput.value;
      const newHours = (newStartTime && newEndTime) ? calcHours(newStartTime, newEndTime) : parseFloat(entry.hours);
      const newCat = tr.querySelector('[data-field="cat"]').value.trim();
      const newDesc = tr.querySelector('[data-field="desc"]').value.trim();
      if (!newDesc) { showToast('업무 내용을 입력해주세요.', 'warning'); return; }

      if (!CONFIG.API_URL) {
        // Demo
        const idx = STATE.allEntries.findIndex(e => e.id === entry.id);
        if (idx !== -1) {
          const wasRejected = STATE.allEntries[idx].status === 'rejected';
          const newStatus = wasRejected ? 'pending' : (STATE.allEntries[idx].status || 'pending');
          STATE.allEntries[idx] = {
            ...STATE.allEntries[idx],
            category: newCat,
            description: newDesc,
            hours: newHours,
            startTime: newStartTime,
            endTime: newEndTime,
            status: newStatus,
            rejectionReason: wasRejected ? null : STATE.allEntries[idx].rejectionReason,
            approverName: wasRejected ? null : STATE.allEntries[idx].approverName,
          };
          entry.category = newCat; entry.description = newDesc; entry.hours = newHours;
          entry.startTime = newStartTime; entry.endTime = newEndTime;
          entry.status = newStatus;
          if (wasRejected) { entry.rejectionReason = null; entry.approverName = null; }
        }
        const resubmitted = STATE.allEntries[idx] && STATE.allEntries[idx].status === 'pending';
        showToast(resubmitted ? '수정되었습니다. 승인 대기 상태로 재제출됩니다.' : '수정되었습니다.', 'success', 2000);
        updatePendingBadge();
        renderNormal();
        return;
      }

      showLoading();
      try {
        await apiPost('updateEntry', { id: entry.id, category: newCat, description: newDesc, hours: newHours, startTime: newStartTime, endTime: newEndTime });
        const res = await apiGet('getAllEntries');
        if (Array.isArray(res)) STATE.allEntries = res;
        showToast('수정되었습니다.', 'success', 1500);
        renderRecordsView();
      } catch (err) {
        showToast(`수정 실패: ${err.message}`, 'error');
      } finally { hideLoading(); }
    });

    tr.querySelector('.btn-cancel-edit').addEventListener('click', renderNormal);
  }

  async function deleteRecord(entry) {
    const confirmed = await showConfirm('항목 삭제', `"${entry.description}" 항목을 삭제하시겠습니까?`, '삭제', true);
    if (!confirmed) return;

    if (!CONFIG.API_URL) {
      STATE.allEntries = STATE.allEntries.filter(e => e.id !== entry.id);
      showToast('삭제되었습니다.', 'success', 1500);
      renderRecordsView();
      return;
    }

    showLoading();
    try {
      await apiPost('deleteEntry', { id: entry.id });
      const res = await apiGet('getAllEntries');
      if (Array.isArray(res)) STATE.allEntries = res;
      showToast('삭제되었습니다.', 'success', 1500);
      renderRecordsView();
    } catch (err) {
      showToast(`삭제 실패: ${err.message}`, 'error');
    } finally { hideLoading(); }
  }

  renderNormal();
  return tr;
}

/* ============================================================
   APPROVAL VIEW (Approver Tab)
   ============================================================ */
function renderApprovalView() {
  const container = document.getElementById('approval-container');
  container.innerHTML = '';

  const pendingEntries = getPendingForApprover();

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-heading';
  titleEl.style.marginBottom = '16px';
  titleEl.textContent = `승인 대기 (${pendingEntries.length}건)`;
  container.appendChild(titleEl);

  if (pendingEntries.length === 0) {
    container.innerHTML += `<div class="empty-state"><span class="empty-icon">✓</span>승인 대기 중인 항목이 없습니다.</div>`;
    return;
  }

  // Group by member name
  const groups = {};
  pendingEntries.forEach(e => {
    if (!groups[e.name]) groups[e.name] = [];
    groups[e.name].push(e);
  });

  // Checkbox tracking
  const checkedIds = new Set();

  const headerRow = document.createElement('div');
  headerRow.className = 'approval-header-row';
  const selectAllLabel = document.createElement('label');
  selectAllLabel.className = 'approval-select-all';
  const selectAllCb = document.createElement('input');
  selectAllCb.type = 'checkbox';
  selectAllCb.id = 'approval-select-all';
  selectAllLabel.appendChild(selectAllCb);
  selectAllLabel.append(' 전체 선택');
  headerRow.appendChild(selectAllLabel);
  container.appendChild(headerRow);

  const groupsContainer = document.createElement('div');

  Object.entries(groups).forEach(([memberName, memberEntries]) => {
    const member = STATE.members.find(m => m.name === memberName);
    const deptName = member ? (member.department || '-') : '-';
    const subtotal = memberEntries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

    const groupEl = document.createElement('div');
    groupEl.className = 'approval-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'approval-group-header';
    groupHeader.innerHTML = `<span>${escapeHtml(memberName)} <span style="font-weight:400;color:var(--text-secondary)">(${escapeHtml(deptName)})</span></span><span style="color:var(--primary)">소계: ${subtotal.toFixed(1)}h</span>`;
    groupEl.appendChild(groupHeader);

    const entriesWrap = document.createElement('div');
    entriesWrap.style.border = '1px solid var(--border)';
    entriesWrap.style.borderTop = 'none';
    entriesWrap.style.borderRadius = '0 0 6px 6px';

    memberEntries.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '')).forEach(entry => {
      const entryEl = document.createElement('div');
      entryEl.className = 'approval-entry';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.entryId = entry.id;
      checkedIds.add(entry.id);

      cb.addEventListener('change', () => {
        if (cb.checked) checkedIds.add(entry.id);
        else checkedIds.delete(entry.id);
        updateSelectAllState();
      });

      const infoEl = document.createElement('div');
      infoEl.className = 'approval-entry-info';
      infoEl.innerHTML = `<span style="color:var(--text-secondary);white-space:nowrap">${entry.date}</span>
        <span style="white-space:nowrap">${formatTimeRange(entry.startTime, entry.endTime) || '-'}</span>
        <span><span class="tag tag-blue">${escapeHtml(entry.category)}</span></span>
        <span style="flex:1">${escapeHtml(entry.description)}</span>`;

      const hoursEl = document.createElement('span');
      hoursEl.className = 'approval-entry-hours';
      hoursEl.textContent = parseFloat(entry.hours).toFixed(1) + 'h';

      entryEl.appendChild(cb);
      entryEl.appendChild(infoEl);
      entryEl.appendChild(hoursEl);
      entriesWrap.appendChild(entryEl);
    });

    groupEl.appendChild(entriesWrap);
    groupsContainer.appendChild(groupEl);
  });

  container.appendChild(groupsContainer);

  // Select all logic
  function updateSelectAllState() {
    const allCbs = groupsContainer.querySelectorAll('input[type="checkbox"][data-entry-id]');
    const allChecked = Array.from(allCbs).every(cb => cb.checked);
    const noneChecked = Array.from(allCbs).every(cb => !cb.checked);
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = !allChecked && !noneChecked;
  }

  selectAllCb.checked = true;
  selectAllCb.addEventListener('change', () => {
    const checked = selectAllCb.checked;
    groupsContainer.querySelectorAll('input[type="checkbox"][data-entry-id]').forEach(cb => {
      cb.checked = checked;
      if (checked) checkedIds.add(cb.dataset.entryId);
      else checkedIds.delete(cb.dataset.entryId);
    });
  });

  // Action buttons
  const actionsEl = document.createElement('div');
  actionsEl.className = 'approval-actions';

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn-danger';
  rejectBtn.textContent = '반려';
  rejectBtn.addEventListener('click', () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) { showToast('항목을 선택해주세요.', 'warning'); return; }
    openRejectionModal(ids);
  });

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn-submit';
  approveBtn.textContent = '승인';
  approveBtn.addEventListener('click', () => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) { showToast('항목을 선택해주세요.', 'warning'); return; }
    openSignatureModal(ids);
  });

  actionsEl.appendChild(rejectBtn);
  actionsEl.appendChild(approveBtn);
  container.appendChild(actionsEl);
}

/* ---- Signature Modal ---- */
function openSignatureModal(entryIds) {
  const backdrop = document.getElementById('signature-modal-backdrop');
  const approveBtn = document.getElementById('sig-modal-approve');
  const summaryEl = document.getElementById('approval-summary');

  // Populate summary
  const entries = entryIds.map(id => STATE.allEntries.find(e => e.id === id)).filter(Boolean);
  const totalH = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);
  const names = [...new Set(entries.map(e => e.name))];
  summaryEl.innerHTML = `<strong>${entries.length}건</strong> 승인 예정 &nbsp;|&nbsp; 총 <strong>${totalH.toFixed(1)}h</strong><br>
    <span style="color:var(--text-secondary);font-size:0.8rem">대상자: ${names.map(escapeHtml).join(', ')}</span>`;

  // Toggle signature sections
  if (STATE.signatureData) {
    showExistingSignature();
  } else {
    showSignatureInput();
  }

  approveBtn.disabled = !STATE.signatureData;
  backdrop.classList.add('visible');

  // Init canvas
  initSignatureCanvas();

  // Sig tabs
  document.querySelectorAll('.sig-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sig-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.sigMode;
      document.getElementById('sig-draw-area').style.display = mode === 'draw' ? 'block' : 'none';
      document.getElementById('sig-upload-area').style.display = mode === 'upload' ? 'block' : 'none';
    });
  });

  // File upload
  const fileInput = document.getElementById('sig-file-input');
  const newFileInput = fileInput.cloneNode(true);
  fileInput.parentNode.replaceChild(newFileInput, fileInput);
  newFileInput.addEventListener('change', () => {
    const file = newFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('sig-upload-preview');
      preview.innerHTML = `<img src="${ev.target.result}" alt="서명 미리보기">`;
      preview.dataset.dataUrl = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Save signature button
  const saveSigBtn = document.getElementById('btn-save-signature');
  const newSaveSigBtn = saveSigBtn.cloneNode(true);
  saveSigBtn.parentNode.replaceChild(newSaveSigBtn, saveSigBtn);
  newSaveSigBtn.addEventListener('click', () => {
    const activeMode = document.querySelector('.sig-tab.active')?.dataset.sigMode || 'draw';
    let dataUrl = null;
    if (activeMode === 'draw') {
      dataUrl = window.getSignatureFromCanvas ? window.getSignatureFromCanvas() : null;
      // Check if canvas is non-blank
      if (dataUrl) {
        const canvas = document.getElementById('signature-canvas');
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasDrawing = Array.from(imgData.data).some((v, i) => i % 4 !== 3 && v < 240);
        if (!hasDrawing) { showToast('서명을 그려주세요.', 'warning'); return; }
      }
    } else {
      const preview = document.getElementById('sig-upload-preview');
      dataUrl = preview.dataset.dataUrl;
      if (!dataUrl) { showToast('이미지를 업로드해주세요.', 'warning'); return; }
    }
    if (!dataUrl) { showToast('서명을 입력해주세요.', 'warning'); return; }
    STATE.signatureData = dataUrl;
    showExistingSignature();
    approveBtn.disabled = false;
    showToast('서명이 저장되었습니다.', 'success', 1500);
  });

  // Change signature
  const changeBtn = document.getElementById('btn-change-signature');
  const newChangeBtn = changeBtn.cloneNode(true);
  changeBtn.parentNode.replaceChild(newChangeBtn, changeBtn);
  newChangeBtn.addEventListener('click', () => {
    STATE.signatureData = null;
    approveBtn.disabled = true;
    showSignatureInput();
  });

  // Cancel
  const cancelBtn = document.getElementById('sig-modal-cancel');
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  newCancelBtn.addEventListener('click', () => backdrop.classList.remove('visible'));
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('visible'); });

  // Approve
  const newApproveBtn = approveBtn.cloneNode(true);
  approveBtn.parentNode.replaceChild(newApproveBtn, approveBtn);
  newApproveBtn.disabled = !STATE.signatureData;
  newApproveBtn.addEventListener('click', async () => {
    backdrop.classList.remove('visible');
    await approveSelectedEntries(entryIds);
    updatePendingBadge();
    renderApprovalView();
  });
}

function showExistingSignature() {
  document.getElementById('signature-preview-section').style.display = 'block';
  document.getElementById('signature-input-section').style.display = 'none';
  const img = document.getElementById('signature-preview-img');
  if (STATE.signatureData) img.src = STATE.signatureData;
}

function showSignatureInput() {
  document.getElementById('signature-preview-section').style.display = 'none';
  document.getElementById('signature-input-section').style.display = 'block';
}

function initSignatureCanvas() {
  const canvas = document.getElementById('signature-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;

  // Clear canvas to white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getX(e) { return e.offsetX !== undefined ? e.offsetX : e.clientX - canvas.getBoundingClientRect().left; }
  function getY(e) { return e.offsetY !== undefined ? e.offsetY : e.clientY - canvas.getBoundingClientRect().top; }
  function getTouchPos(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches[0];
    return { offsetX: t.clientX - r.left, offsetY: t.clientY - r.top };
  }

  // Remove old listeners by replacing canvas node
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  const nc = newCanvas;
  const nctx = nc.getContext('2d');
  nctx.fillStyle = '#ffffff';
  nctx.fillRect(0, 0, nc.width, nc.height);
  nctx.strokeStyle = '#000000';
  nctx.lineWidth = 2;
  nctx.lineCap = 'round';
  nctx.lineJoin = 'round';

  let isDrawing = false;

  nc.addEventListener('mousedown', e => { isDrawing = true; nctx.beginPath(); nctx.moveTo(getX(e), getY(e)); });
  nc.addEventListener('mousemove', e => { if (!isDrawing) return; nctx.lineTo(getX(e), getY(e)); nctx.stroke(); });
  nc.addEventListener('mouseup', () => { isDrawing = false; });
  nc.addEventListener('mouseleave', () => { isDrawing = false; });

  nc.addEventListener('touchstart', e => { e.preventDefault(); const pos = getTouchPos(e); isDrawing = true; nctx.beginPath(); nctx.moveTo(pos.offsetX, pos.offsetY); });
  nc.addEventListener('touchmove', e => { e.preventDefault(); if (!isDrawing) return; const pos = getTouchPos(e); nctx.lineTo(pos.offsetX, pos.offsetY); nctx.stroke(); });
  nc.addEventListener('touchend', () => { isDrawing = false; });

  // Clear button
  const clearBtn = document.getElementById('btn-clear-canvas');
  if (clearBtn) {
    const newClearBtn = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
    newClearBtn.addEventListener('click', () => {
      nctx.fillStyle = '#ffffff';
      nctx.fillRect(0, 0, nc.width, nc.height);
    });
  }

  window.getSignatureFromCanvas = () => nc.toDataURL('image/png');
}

/* ---- Rejection Modal ---- */
function openRejectionModal(entryIds) {
  const backdrop = document.getElementById('rejection-modal-backdrop');
  const reasonInput = document.getElementById('rejection-reason');
  reasonInput.value = '';
  backdrop.classList.add('visible');
  reasonInput.focus();

  const cancelBtn = document.getElementById('rejection-cancel');
  const confirmBtn = document.getElementById('rejection-confirm');

  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

  newCancel.addEventListener('click', () => backdrop.classList.remove('visible'));
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('visible'); });

  newConfirm.addEventListener('click', async () => {
    const reason = document.getElementById('rejection-reason').value.trim();
    if (!reason) { showToast('반려 사유를 입력해주세요.', 'warning'); return; }
    backdrop.classList.remove('visible');
    await rejectSelectedEntries(entryIds, reason);
    updatePendingBadge();
    renderApprovalView();
  });
}

/* ---- Approve / Reject API ---- */
async function approveSelectedEntries(entryIds) {
  if (!CONFIG.API_URL) {
    const signatureId = 'SIG-' + Date.now();
    entryIds.forEach(id => {
      const e = STATE.allEntries.find(x => x.id === id);
      if (e) {
        e.status = 'approved';
        e.approverName = STATE.selectedName;
        e.approvedAt = new Date().toISOString();
        e.signatureId = signatureId;
        e.rejectionReason = null;
      }
    });
    showToast(`${entryIds.length}건이 승인되었습니다.`, 'success');
    return;
  }
  showLoading();
  try {
    // 서명 영구 저장
    if (STATE.signatureData) {
      await apiPost('uploadSignature', { name: STATE.selectedName, signatureData: STATE.signatureData });
    }
    await apiPost('approveEntries', { entryIds, approverName: STATE.selectedName });
    const res = await apiGet('getAllEntries');
    if (Array.isArray(res)) STATE.allEntries = res;
    showToast(`${entryIds.length}건이 승인되었습니다.`, 'success');
  } catch (err) { showToast(`승인 실패: ${err.message}`, 'error'); }
  finally { hideLoading(); }
}

async function rejectSelectedEntries(entryIds, reason) {
  if (!CONFIG.API_URL) {
    entryIds.forEach(id => {
      const e = STATE.allEntries.find(x => x.id === id);
      if (e) {
        e.status = 'rejected';
        e.approverName = STATE.selectedName;
        e.rejectionReason = reason;
        e.approvedAt = null;
        e.signatureId = null;
      }
    });
    showToast(`${entryIds.length}건이 반려되었습니다.`, 'success');
    return;
  }
  showLoading();
  try {
    await apiPost('rejectEntries', { entryIds, approverName: STATE.selectedName, reason });
    const res = await apiGet('getAllEntries');
    if (Array.isArray(res)) STATE.allEntries = res;
    showToast(`${entryIds.length}건이 반려되었습니다.`, 'success');
  } catch (err) { showToast(`반려 실패: ${err.message}`, 'error'); }
  finally { hideLoading(); }
}

/* ============================================================
   ADMIN DASHBOARD
   ============================================================ */
function initAdminDashboard() {
  showView('view-admin');
  renderAdminHeader();
  setupAdminTabs();
  renderAdminTab('status');
  document.getElementById('admin-logout').addEventListener('click', logout);
}

function renderAdminHeader() {
  // already static in HTML
}

function setupAdminTabs() {
  document.querySelectorAll('[data-admin-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
      renderAdminTab(tab);
    });
  });
}

function renderAdminTab(tab) {
  STATE.adminTab = tab;
  document.getElementById('admin-tab-status').style.display = tab === 'status' ? 'block' : 'none';
  document.getElementById('admin-tab-members').style.display = tab === 'members' ? 'block' : 'none';
  document.getElementById('admin-tab-excel').style.display = tab === 'excel' ? 'block' : 'none';
  document.getElementById('admin-tab-departments').style.display = tab === 'departments' ? 'block' : 'none';

  if (tab === 'status') renderStatusTab();
  else if (tab === 'members') renderMembersTab();
  else if (tab === 'excel') renderExcelTab();
  else if (tab === 'departments') renderDepartmentsTab();
}

/* ---- STATUS TAB ---- */
function renderStatusTab() {
  renderKPICards();
  renderMemberSummaryTable();
  setupStatusViewToggle();
  renderStatusView(STATE.statusView);
}

function renderKPICards() {
  const allE = STATE.allEntries;
  const approvedE = allE.filter(e => !e.status || e.status === 'approved');
  const weekRange = thisWeekRange();
  const monthRange = thisMonthRange();
  const todayStr = today();

  const totalHours = sumHours(approvedE);
  const weekHours = sumHours(filterEntries(approvedE, { startDate: weekRange.start, endDate: weekRange.end }));
  const monthHours = sumHours(filterEntries(approvedE, { startDate: monthRange.start, endDate: monthRange.end }));

  const activeMembers = STATE.members.filter(m => m.active);
  const todayNames = new Set(filterEntries(allE, { startDate: todayStr, endDate: todayStr }).map(e => e.name));
  const todayInput = `${todayNames.size}/${activeMembers.length}명`;

  const pendingCount = allE.filter(e => e.status === 'pending').length;

  document.getElementById('kpi-total-hours').textContent = totalHours.toFixed(1);
  document.getElementById('kpi-week-hours').textContent = weekHours.toFixed(1);
  document.getElementById('kpi-month-hours').textContent = monthHours.toFixed(1);
  document.getElementById('kpi-today-input').textContent = todayInput;

  // Update pending KPI card if it exists
  const pendingCard = document.getElementById('kpi-pending-card');
  if (pendingCard) {
    document.getElementById('kpi-pending-count').textContent = pendingCount;
  }

  // Add sub-note to total hours card
  const totalCard = document.querySelector('.kpi-card.accent-blue .kpi-sub');
  if (totalCard) {
    totalCard.innerHTML = `승인 완료 기준 &nbsp;|&nbsp; 대기: <span style="color:#EF4444;font-weight:700">${pendingCount}건</span>`;
  }
}

function renderMemberSummaryTable() {
  const tbody = document.getElementById('member-summary-tbody');
  const tfoot = document.getElementById('member-summary-tfoot');
  const weekRange = thisWeekRange();
  const monthRange = thisMonthRange();
  const todayStr = today();

  tbody.innerHTML = '';
  let totalCumHours = 0, totalCumCost = 0;

  STATE.members.filter(m => m.active).forEach(m => {
    const mEntries = filterEntries(STATE.allEntries, { name: m.name });
    const todayH = sumHours(filterEntries(mEntries, { startDate: todayStr, endDate: todayStr }));
    const weekH = sumHours(filterEntries(mEntries, { startDate: weekRange.start, endDate: weekRange.end }));
    const monthH = sumHours(filterEntries(mEntries, { startDate: monthRange.start, endDate: monthRange.end }));
    const cumH = sumHours(mEntries);
    const rate = parseFloat(m.rate) || 0;
    const cost = cumH * rate;
    totalCumHours += cumH;
    totalCumCost += cost;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(m.name)}</strong></td>
      <td><span class="tag tag-gray">${escapeHtml(m.role)}</span></td>
      <td class="num-cell">${todayH > 0 ? todayH.toFixed(1) : '<span class="text-muted">-</span>'}</td>
      <td class="num-cell">${weekH.toFixed(1)}</td>
      <td class="num-cell">${monthH.toFixed(1)}</td>
      <td class="num-cell"><strong>${cumH.toFixed(1)}</strong></td>
      <td class="num-cell">${formatCurrency(rate)}</td>
      <td class="cost-cell">${formatCurrency(cost)}</td>`;
    tr.addEventListener('click', () => showMemberDetail(m.name));
    tbody.appendChild(tr);
  });

  tfoot.innerHTML = `<tr>
    <td colspan="2"><strong>합계</strong></td>
    <td></td><td></td><td></td>
    <td class="num-cell"><strong>${totalCumHours.toFixed(1)}h</strong></td>
    <td></td>
    <td class="cost-cell"><strong>${formatCurrency(totalCumCost)}</strong></td>
  </tr>`;
}

function setupStatusViewToggle() {
  document.querySelectorAll('[data-status-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.statusView;
      document.querySelectorAll('[data-status-view]').forEach(b => b.classList.toggle('active', b.dataset.statusView === view));
      STATE.statusView = view;
      renderStatusView(view);
    });
  });
}

function renderStatusView(view) {
  const container = document.getElementById('status-matrix-container');
  container.innerHTML = '';

  if (view === 'weekly') renderWeeklyMatrix(container);
  else if (view === 'monthly') renderMonthlyMatrix(container);
  else if (view === 'category') renderCategoryView(container);
}

function renderWeeklyMatrix(container) {
  const activeMembers = STATE.members.filter(m => m.active);
  const allE = STATE.allEntries;

  // Determine weeks present
  const weekSet = new Set();
  allE.forEach(e => { const w = getWeekNumber(e.date); if (w >= 1 && w <= 52) weekSet.add(w); });
  const weeks = Array.from(weekSet).sort((a, b) => a - b);
  if (weeks.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:30px">데이터가 없습니다.</div>'; return; }

  const wrap = document.createElement('div');
  wrap.className = 'admin-table-wrap';
  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header
  let thead = '<tr><th>이름</th><th>직군</th>';
  weeks.forEach(w => { thead += `<th>Wk${w}</th>`; });
  thead += '<th class="total-col">합계</th></tr>';
  table.innerHTML = `<thead>${thead}</thead>`;

  const tbody = document.createElement('tbody');
  const footTotals = new Array(weeks.length).fill(0);
  let grandTotal = 0;

  activeMembers.forEach(m => {
    const tr = document.createElement('tr');
    let cells = `<td><strong>${escapeHtml(m.name)}</strong></td><td><span class="tag tag-gray">${escapeHtml(m.role)}</span></td>`;
    let memberTotal = 0;
    weeks.forEach((w, i) => {
      const wRange = getWeekRange(w);
      const h = sumHours(filterEntries(STATE.allEntries, { name: m.name, startDate: wRange.start, endDate: wRange.end }));
      footTotals[i] += h;
      memberTotal += h;
      cells += `<td class="${h === 0 ? 'matrix-cell-zero' : ''}">${h > 0 ? h.toFixed(1) : '-'}</td>`;
    });
    grandTotal += memberTotal;
    cells += `<td class="total-col">${memberTotal.toFixed(1)}</td>`;
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  const tfoot = document.createElement('tfoot');
  let footRow = '<tr><td colspan="2"><strong>합계</strong></td>';
  footTotals.forEach(h => { footRow += `<td><strong>${h > 0 ? h.toFixed(1) : '-'}</strong></td>`; });
  footRow += `<td class="total-col"><strong>${grandTotal.toFixed(1)}</strong></td></tr>`;
  tfoot.innerHTML = footRow;

  table.appendChild(tbody);
  table.appendChild(tfoot);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderMonthlyMatrix(container) {
  const activeMembers = STATE.members.filter(m => m.active);
  const allE = STATE.allEntries;

  const monthSet = new Set();
  allE.forEach(e => monthSet.add(getYearMonth(e.date)));
  const months = Array.from(monthSet).sort();
  if (months.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:30px">데이터가 없습니다.</div>'; return; }

  const wrap = document.createElement('div');
  wrap.className = 'admin-table-wrap';
  const table = document.createElement('table');
  table.className = 'matrix-table';

  let thead = '<tr><th>이름</th><th>직군</th>';
  months.forEach(m => { thead += `<th>${m} 시수</th><th>${m} 인건비</th>`; });
  thead += '<th class="total-col">합계(h)</th><th class="total-col">총 인건비</th></tr>';
  table.innerHTML = `<thead>${thead}</thead>`;

  const tbody = document.createElement('tbody');
  const footHours = new Array(months.length).fill(0);
  const footCosts = new Array(months.length).fill(0);
  let grandH = 0, grandCost = 0;

  activeMembers.forEach(m => {
    const rate = parseFloat(m.rate) || 0;
    const tr = document.createElement('tr');
    let cells = `<td><strong>${escapeHtml(m.name)}</strong></td><td><span class="tag tag-gray">${escapeHtml(m.role)}</span></td>`;
    let memberH = 0, memberCost = 0;
    months.forEach((mo, i) => {
      const [yr, mn] = mo.split('-');
      const startDate = `${yr}-${mn}-01`;
      const lastDay = new Date(parseInt(yr), parseInt(mn), 0).getDate();
      const endDate = `${yr}-${mn}-${String(lastDay).padStart(2, '0')}`;
      const h = sumHours(filterEntries(STATE.allEntries, { name: m.name, startDate, endDate }));
      const cost = h * rate;
      footHours[i] += h;
      footCosts[i] += cost;
      memberH += h;
      memberCost += cost;
      cells += `<td>${h > 0 ? h.toFixed(1) : '<span class="text-muted">-</span>'}</td>`;
      cells += `<td class="cost-cell">${cost > 0 ? formatCurrency(cost) : '<span class="text-muted">-</span>'}</td>`;
    });
    grandH += memberH;
    grandCost += memberCost;
    cells += `<td class="total-col">${memberH.toFixed(1)}</td><td class="total-col cost-cell">${formatCurrency(memberCost)}</td>`;
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  const tfoot = document.createElement('tfoot');
  let footRow = '<tr><td colspan="2"><strong>합계</strong></td>';
  months.forEach((_, i) => {
    footRow += `<td><strong>${footHours[i].toFixed(1)}</strong></td><td class="cost-cell"><strong>${formatCurrency(footCosts[i])}</strong></td>`;
  });
  footRow += `<td class="total-col"><strong>${grandH.toFixed(1)}</strong></td><td class="total-col cost-cell"><strong>${formatCurrency(grandCost)}</strong></td></tr>`;
  tfoot.innerHTML = footRow;

  table.appendChild(tbody);
  table.appendChild(tfoot);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderCategoryView(container) {
  const allE = STATE.allEntries;
  const totalHours = sumHours(allE);

  if (totalHours === 0) { container.innerHTML = '<div class="empty-state" style="padding:30px">데이터가 없습니다.</div>'; return; }

  const catHours = {};
  STATE.categories.forEach(c => { catHours[c] = 0; });
  allE.forEach(e => { if (catHours[e.category] !== undefined) catHours[e.category] += parseFloat(e.hours || 0); else catHours[e.category] = parseFloat(e.hours || 0); });

  const sorted = Object.entries(catHours).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);

  container.innerHTML = '';
  sorted.forEach(([cat, hours]) => {
    const pct = totalHours > 0 ? (hours / totalHours * 100) : 0;
    const row = document.createElement('div');
    row.className = 'category-bar-row';
    row.innerHTML = `
      <div class="category-bar-label">${escapeHtml(cat)}</div>
      <div class="category-bar-track"><div class="category-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="category-bar-stat">${hours.toFixed(1)}h &nbsp; <strong>${pct.toFixed(1)}%</strong></div>`;
    container.appendChild(row);
  });
}

/* Member Detail Modal */
function showMemberDetail(name) {
  const entries = filterEntries(STATE.allEntries, { name }).sort((a, b) => b.date.localeCompare(a.date));
  const total = sumHours(entries);
  const rate = getMemberRate(name);
  const cost = total * rate;
  const role = getMemberRole(name);

  const modal = document.getElementById('detail-modal');
  const titleEl = document.getElementById('detail-modal-title');
  const bodyEl = document.getElementById('detail-modal-body');

  titleEl.textContent = `${name} 상세`;
  bodyEl.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div class="kpi-card" style="flex:1;min-width:120px"><div class="kpi-label">직군</div><div class="kpi-value" style="font-size:1.1rem">${escapeHtml(role)}</div></div>
      <div class="kpi-card" style="flex:1;min-width:120px"><div class="kpi-label">누적 시수</div><div class="kpi-value">${total.toFixed(1)}<span class="kpi-unit">h</span></div></div>
      <div class="kpi-card" style="flex:1;min-width:120px"><div class="kpi-label">누적 인건비</div><div class="kpi-value" style="font-size:1rem;color:var(--success)">${formatCurrency(cost)}</div></div>
    </div>
    <div style="max-height:300px;overflow-y:auto">
      <table class="entries-table" style="font-size:0.82rem">
        <thead><tr><th>날짜</th><th>시간</th><th>카테고리</th><th>업무 내용</th><th class="col-hours">소요</th></tr></thead>
        <tbody>
          ${entries.slice(0, 50).map(e => `<tr>
            <td style="white-space:nowrap;color:var(--text-secondary)">${e.date}</td>
            <td style="white-space:nowrap;font-size:0.75rem">${formatTimeRange(e.startTime, e.endTime) || '-'}</td>
            <td><span class="tag tag-blue" style="font-size:0.7rem">${escapeHtml(e.category)}</span></td>
            <td>${escapeHtml(e.description)}</td>
            <td class="col-hours">${parseFloat(e.hours).toFixed(1)}h</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${entries.length > 50 ? `<p style="text-align:center;padding:8px;font-size:0.8rem;color:var(--text-muted)">최근 50건만 표시</p>` : ''}
    </div>`;

  document.getElementById('detail-modal-backdrop').classList.add('visible');
  document.getElementById('detail-modal-close').onclick = () => document.getElementById('detail-modal-backdrop').classList.remove('visible');
  document.getElementById('detail-modal-backdrop').addEventListener('click', e => { if (e.target === document.getElementById('detail-modal-backdrop')) document.getElementById('detail-modal-backdrop').classList.remove('visible'); });
}

/* ---- MEMBERS TAB ---- */
function renderMembersTab() {
  const container = document.getElementById('members-tab-content');
  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'admin-section';

  const header = document.createElement('div');
  header.className = 'admin-section-header';
  header.innerHTML = '<h2>인원 목록</h2>';
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'member-mgmt-list';

  STATE.members.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = `member-mgmt-row ${m.active ? '' : 'member-inactive'}`;
    row.innerHTML = `
      <span class="member-name">${escapeHtml(m.name)}</span>
      <span class="member-role-badge">${escapeHtml(m.role)}</span>
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
        <label style="font-size:0.78rem;color:var(--text-muted)">Hourly Rate</label>
        <input type="number" class="rate-input" value="${m.rate}" min="0" step="1000" data-idx="${idx}">
        <button class="btn-toggle-active ${m.active ? 'active-btn' : ''}" data-idx="${idx}">${m.active ? '활성' : '비활성'}</button>
      </div>`;
    list.appendChild(row);
  });

  section.appendChild(list);

  // Rate change
  list.querySelectorAll('.rate-input').forEach(input => {
    input.addEventListener('change', async () => {
      const idx = parseInt(input.dataset.idx);
      const newRate = parseFloat(input.value) || 0;
      STATE.members[idx].rate = newRate;
      if (!CONFIG.API_URL) { showToast('요율이 업데이트되었습니다. (데모 모드)', 'success', 1500); return; }
      showLoading();
      try {
        await apiPost('updateRate', { name: STATE.members[idx].name, hourlyRate: newRate });
        showToast('요율이 업데이트되었습니다.', 'success', 1500);
        renderKPICards();
        renderMemberSummaryTable();
      } catch (err) { showToast(`업데이트 실패: ${err.message}`, 'error'); }
      finally { hideLoading(); }
    });
  });

  // Toggle active
  list.querySelectorAll('.btn-toggle-active').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      STATE.members[idx].active = !STATE.members[idx].active;
      if (!CONFIG.API_URL) { renderMembersTab(); showToast('상태가 변경되었습니다. (데모 모드)', 'success', 1500); return; }
      showLoading();
      try {
        await apiPost('updateMember', { name: STATE.members[idx].name, isActive: STATE.members[idx].active });
        showToast('상태가 변경되었습니다.', 'success', 1500);
        renderMembersTab();
      } catch (err) { showToast(`변경 실패: ${err.message}`, 'error'); }
      finally { hideLoading(); }
    });
  });

  // Add member form
  const addForm = document.createElement('div');
  addForm.className = 'add-member-form';
  addForm.innerHTML = `
    <div class="form-group"><label class="form-label">이름</label><input type="text" class="form-control" id="new-member-name" placeholder="홍길동"></div>
    <div class="form-group"><label class="form-label">직군</label><input type="text" class="form-control" id="new-member-role" placeholder="기획"></div>
    <div class="form-group"><label class="form-label">Hourly Rate</label><input type="number" class="form-control" id="new-member-rate" placeholder="30000" min="0" step="1000"></div>
    <button class="btn-add-member" id="btn-add-member">+ 인원 추가</button>`;
  section.appendChild(addForm);

  document.getElementById('btn-add-member').addEventListener('click', async () => {
    const name = document.getElementById('new-member-name').value.trim();
    const role = document.getElementById('new-member-role').value.trim();
    const rate = parseFloat(document.getElementById('new-member-rate').value) || 0;
    if (!name || !role) { showToast('이름과 직군을 입력해주세요.', 'warning'); return; }
    if (STATE.members.find(m => m.name === name)) { showToast('이미 존재하는 이름입니다.', 'warning'); return; }

    if (!CONFIG.API_URL) {
      STATE.members.push({ name, role, rate, active: true });
      showToast('인원이 추가되었습니다. (데모 모드)', 'success', 1500);
      renderMembersTab();
      return;
    }
    showLoading();
    try {
      await apiPost('addMember', { name, role, hourlyRate: rate });
      const membersRes = await apiGet('getMembers');
      if (Array.isArray(membersRes)) {
        STATE.members = membersRes.map(m => ({ name: m.name, role: m.role, rate: m.hourlyRate || 0, active: m.isActive !== false }));
      }
      showToast('인원이 추가되었습니다.', 'success', 1500);
      renderMembersTab();
    } catch (err) { showToast(`추가 실패: ${err.message}`, 'error'); }
    finally { hideLoading(); }
  });

  container.appendChild(section);
}

/* ---- EXCEL TAB ---- */
function renderExcelTab() {
  const container = document.getElementById('excel-tab-content');
  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'admin-section';
  section.innerHTML = `
    <div class="admin-section-header"><h2>엑셀 다운로드</h2></div>
    <div class="export-section">
      <div class="export-controls">
        <div class="form-group">
          <label class="form-label">기간 유형</label>
          <select class="form-control" id="export-period-type" style="width:150px">
            <option value="all">전체</option>
            <option value="range">특정 기간</option>
          </select>
        </div>
        <div class="form-group" id="export-start-group" style="display:none">
          <label class="form-label">시작일</label>
          <input type="date" class="form-control" id="export-start-date">
        </div>
        <div class="form-group" id="export-end-group" style="display:none">
          <label class="form-label">종료일</label>
          <input type="date" class="form-control" id="export-end-date">
        </div>
        <div class="form-group" style="align-self:flex-end">
          <button class="btn-excel" id="btn-excel-download">
            <span>📊</span> 엑셀 다운로드
          </button>
        </div>
      </div>
      <div id="export-preview" class="export-preview">기간을 선택하면 미리보기가 표시됩니다.</div>
    </div>`;

  container.appendChild(section);

  const periodType = document.getElementById('export-period-type');
  const startGroup = document.getElementById('export-start-group');
  const endGroup = document.getElementById('export-end-group');
  const startDate = document.getElementById('export-start-date');
  const endDate = document.getElementById('export-end-date');
  const previewEl = document.getElementById('export-preview');

  // Set default dates
  const allDates = STATE.allEntries.map(e => e.date).sort();
  startDate.value = allDates[0] || today();
  endDate.value = allDates[allDates.length - 1] || today();
  STATE.exportStartDate = startDate.value;
  STATE.exportEndDate = endDate.value;

  function updatePreview() {
    const type = periodType.value;
    let start, end;
    if (type === 'all') {
      start = allDates[0] || today();
      end = allDates[allDates.length - 1] || today();
    } else {
      start = startDate.value;
      end = endDate.value;
    }
    STATE.exportStartDate = start;
    STATE.exportEndDate = end;

    const entries = filterEntries(STATE.allEntries, { startDate: start, endDate: end });
    const totalH = sumHours(entries);
    const activeMembers = STATE.members.filter(m => m.active);

    previewEl.innerHTML = `
      <p style="margin-bottom:10px;font-weight:600;color:var(--text)">미리보기: ${start} ~ ${end}</p>
      <table>
        <thead><tr><th>항목</th><th>값</th></tr></thead>
        <tbody>
          <tr><td>기간</td><td>${start} ~ ${end}</td></tr>
          <tr><td>참여 인원</td><td>${activeMembers.length}명</td></tr>
          <tr><td>총 기록 건수</td><td>${entries.length}건</td></tr>
          <tr><td>총 시수</td><td>${totalH.toFixed(1)}h</td></tr>
          <tr><td>총 인건비</td><td>${formatCurrency(activeMembers.reduce((s, m) => s + sumHours(filterEntries(entries, { name: m.name })) * (parseFloat(m.rate) || 0), 0))}</td></tr>
          <tr><td>포함 시트</td><td>전체 요약 / 주간 현황 / 월간 현황 / 개인별 상세 / 인건비 산출</td></tr>
        </tbody>
      </table>`;
  }

  periodType.addEventListener('change', () => {
    const isRange = periodType.value === 'range';
    startGroup.style.display = isRange ? 'block' : 'none';
    endGroup.style.display = isRange ? 'block' : 'none';
    updatePreview();
  });
  startDate.addEventListener('change', updatePreview);
  endDate.addEventListener('change', updatePreview);

  updatePreview();

  document.getElementById('btn-excel-download').addEventListener('click', () => {
    generateExcel(STATE.exportStartDate, STATE.exportEndDate);
  });
}

/* ============================================================
   EXCEL GENERATION (SheetJS)
   ============================================================ */
function generateExcel(startDate, endDate) {
  if (typeof XLSX === 'undefined') {
    showToast('SheetJS 라이브러리가 로드되지 않았습니다.', 'error');
    return;
  }

  const entries = filterEntries(STATE.allEntries, { startDate, endDate });
  const activeMembers = STATE.members.filter(m => m.active);
  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: 전체 요약 ----
  const s1Data = [
    ['ECI 시수관리 - 전체 요약'],
    [],
    ['프로젝트 기간', `${startDate} ~ ${endDate}`],
    ['참여 인원', `${activeMembers.length}명`],
    ['총 기록 건수', `${entries.length}건`],
    ['총 시수', sumHours(entries).toFixed(1) + 'h'],
    [],
    ['인원별 요약'],
    ['#', '이름', '직군', '총 시수', 'Hourly Rate', '총 인건비'],
  ];

  let totalH = 0, totalCost = 0;
  activeMembers.forEach((m, i) => {
    const h = sumHours(filterEntries(entries, { name: m.name }));
    const rate = parseFloat(m.rate) || 0;
    const cost = h * rate;
    totalH += h;
    totalCost += cost;
    s1Data.push([i + 1, m.name, m.role, h, rate, cost]);
  });
  s1Data.push(['', '합계', '', totalH, '', totalCost]);
  s1Data.push([]);
  s1Data.push(['카테고리별 요약']);
  s1Data.push(['카테고리', '총 시수', '비율(%)']);

  const catTotals = {};
  entries.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + parseFloat(e.hours || 0); });
  const grandH = sumHours(entries);
  Object.entries(catTotals).sort((a, b) => b[1] - a[1]).forEach(([cat, h]) => {
    s1Data.push([cat, h, grandH > 0 ? (h / grandH * 100).toFixed(1) + '%' : '0%']);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(s1Data);
  ws1['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, '전체 요약');

  // ---- Sheet 2: 주간 현황 ----
  const weekSet = new Set();
  entries.forEach(e => { const w = getWeekNumber(e.date); if (w >= 1) weekSet.add(w); });
  const weeks = Array.from(weekSet).sort((a, b) => a - b);

  const s2Header = ['이름', '직군', ...weeks.map(w => `Wk${w}`), '합계'];
  const s2Data = [s2Header];
  const s2Totals = new Array(weeks.length).fill(0);
  let s2Grand = 0;

  activeMembers.forEach(m => {
    const row = [m.name, m.role];
    let mTotal = 0;
    weeks.forEach((w, i) => {
      const wRange = getWeekRange(w);
      const h = sumHours(filterEntries(entries, { name: m.name, startDate: wRange.start, endDate: wRange.end }));
      s2Totals[i] += h;
      mTotal += h;
      row.push(h > 0 ? h : '');
    });
    row.push(mTotal > 0 ? mTotal : '');
    s2Grand += mTotal;
    s2Data.push(row);
  });
  s2Data.push(['합계', '', ...s2Totals.map(h => h > 0 ? h : ''), s2Grand > 0 ? s2Grand : '']);
  const ws2 = XLSX.utils.aoa_to_sheet(s2Data);
  XLSX.utils.book_append_sheet(wb, ws2, '주간 현황');

  // ---- Sheet 3: 월간 현황 ----
  const monthSet = new Set();
  entries.forEach(e => monthSet.add(getYearMonth(e.date)));
  const months = Array.from(monthSet).sort();

  const s3HeaderCols = [];
  months.forEach(mo => { s3HeaderCols.push(`${mo} 시수`, `${mo} 인건비`); });
  const s3Header = ['이름', '직군', ...s3HeaderCols, '합계(h)', '총 인건비'];
  const s3Data = [s3Header];
  const s3TotalH = new Array(months.length).fill(0);
  const s3TotalC = new Array(months.length).fill(0);
  let s3GrandH = 0, s3GrandC = 0;

  activeMembers.forEach(m => {
    const rate = parseFloat(m.rate) || 0;
    const row = [m.name, m.role];
    let mH = 0, mC = 0;
    months.forEach((mo, i) => {
      const [yr, mn] = mo.split('-');
      const start = `${yr}-${mn}-01`;
      const lastDay = new Date(parseInt(yr), parseInt(mn), 0).getDate();
      const end = `${yr}-${mn}-${String(lastDay).padStart(2, '0')}`;
      const h = sumHours(filterEntries(entries, { name: m.name, startDate: start, endDate: end }));
      const c = h * rate;
      s3TotalH[i] += h;
      s3TotalC[i] += c;
      mH += h;
      mC += c;
      row.push(h > 0 ? h : '', c > 0 ? c : '');
    });
    s3GrandH += mH;
    s3GrandC += mC;
    row.push(mH > 0 ? mH : '', mC > 0 ? mC : '');
    s3Data.push(row);
  });

  const s3Footer = ['합계', ''];
  months.forEach((_, i) => { s3Footer.push(s3TotalH[i] > 0 ? s3TotalH[i] : '', s3TotalC[i] > 0 ? s3TotalC[i] : ''); });
  s3Footer.push(s3GrandH, s3GrandC);
  s3Data.push(s3Footer);

  const ws3 = XLSX.utils.aoa_to_sheet(s3Data);
  XLSX.utils.book_append_sheet(wb, ws3, '월간 현황');

  // ---- Sheet 4: 개인별 상세 ----
  const s4Data = [['이름', '날짜', '시작', '종료', '카테고리', '업무 내용', '시간(h)']];
  const sortedByName = [...entries].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));

  let currentName = null;
  let nameSubtotal = 0;
  sortedByName.forEach(e => {
    if (currentName !== null && currentName !== e.name) {
      s4Data.push(['', `[${currentName} 소계]`, '', '', '', '', nameSubtotal]);
      s4Data.push([]);
      nameSubtotal = 0;
    }
    currentName = e.name;
    nameSubtotal += parseFloat(e.hours || 0);
    s4Data.push([e.name, e.date, e.startTime || '', e.endTime || '', e.category, e.description, parseFloat(e.hours)]);
  });
  if (currentName) s4Data.push(['', `[${currentName} 소계]`, '', '', '', '', nameSubtotal]);

  const ws4 = XLSX.utils.aoa_to_sheet(s4Data);
  ws4['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 18 }, { wch: 40 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws4, '개인별 상세');

  // ---- Sheet 5: 인건비 산출 ----
  const s5Data = [
    ['인건비 산출'],
    ['기준 기간', `${startDate} ~ ${endDate}`],
    [],
    ['#', '이름', '직군', '총 시수', 'Hourly Rate', '총 인건비', '비율(%)'],
  ];

  let s5TotalH = 0, s5TotalCost = 0;
  const s5Rows = [];
  activeMembers.forEach((m, i) => {
    const h = sumHours(filterEntries(entries, { name: m.name }));
    const rate = parseFloat(m.rate) || 0;
    const cost = h * rate;
    s5TotalH += h;
    s5TotalCost += cost;
    s5Rows.push([i + 1, m.name, m.role, h, rate, cost, '']);
  });
  s5Rows.forEach(row => {
    row[6] = s5TotalCost > 0 ? (row[5] / s5TotalCost * 100).toFixed(1) + '%' : '0%';
    s5Data.push(row);
  });
  s5Data.push(['', '합계', '', s5TotalH, '', s5TotalCost, '100%']);
  s5Data.push([]);
  s5Data.push(['직군별 요약']);
  s5Data.push(['직군', '인원', '총 인건비', '비율(%)']);

  const roleMap = {};
  activeMembers.forEach(m => {
    const h = sumHours(filterEntries(entries, { name: m.name }));
    const cost = h * (parseFloat(m.rate) || 0);
    if (!roleMap[m.role]) roleMap[m.role] = { count: 0, cost: 0 };
    roleMap[m.role].count++;
    roleMap[m.role].cost += cost;
  });
  Object.entries(roleMap).sort((a, b) => b[1].cost - a[1].cost).forEach(([role, data]) => {
    s5Data.push([role, data.count, data.cost, s5TotalCost > 0 ? (data.cost / s5TotalCost * 100).toFixed(1) + '%' : '0%']);
  });

  const ws5 = XLSX.utils.aoa_to_sheet(s5Data);
  ws5['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws5, '인건비 산출');

  // Download
  const fileName = `ECI_시수관리_${startDate}_${endDate}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`${fileName} 다운로드를 시작합니다.`, 'success');
}

/* ============================================================
   DEPARTMENTS TAB (Admin)
   ============================================================ */
function renderDepartmentsTab() {
  const container = document.getElementById('departments-tab-content');
  container.innerHTML = '';

  // ---- Department List ----
  const deptSection = document.createElement('div');
  deptSection.className = 'admin-section';
  deptSection.innerHTML = `<div class="admin-section-header"><h2>소속 목록</h2></div>`;

  if (STATE.departments.length === 0) {
    deptSection.innerHTML += `<div class="empty-state" style="padding:20px">등록된 소속이 없습니다.</div>`;
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'admin-table-wrap';
    const table = document.createElement('table');
    table.className = 'admin-table';
    table.innerHTML = `<thead><tr><th>소속명</th><th>승인자</th><th>승인자 이메일</th><th style="width:80px">관리</th></tr></thead>`;
    const tbody = document.createElement('tbody');

    STATE.departments.forEach(dept => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(dept.name)}</strong></td>
        <td>${escapeHtml(dept.approverName)}</td>
        <td>${escapeHtml(dept.approverEmail)}</td>
        <td><button class="btn-icon" title="삭제" data-dept="${escapeHtml(dept.name)}">🗑</button></td>`;
      tr.querySelector('.btn-icon').addEventListener('click', async () => {
        const ok = await showConfirm('소속 삭제', `"${dept.name}" 소속을 삭제하시겠습니까?`, '삭제', true);
        if (!ok) return;
        if (!CONFIG.API_URL) {
          STATE.departments = STATE.departments.filter(d => d.name !== dept.name);
          showToast('삭제되었습니다.', 'success', 1500);
          renderDepartmentsTab();
          return;
        }
        showLoading();
        try {
          await apiPost('deleteDepartment', { name: dept.name });
          const res = await apiGet('getDepartments');
          if (Array.isArray(res)) STATE.departments = res;
          showToast('삭제되었습니다.', 'success', 1500);
          renderDepartmentsTab();
        } catch (err) { showToast(`삭제 실패: ${err.message}`, 'error'); }
        finally { hideLoading(); }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    deptSection.appendChild(wrap);
  }

  // Add department form
  const addForm = document.createElement('div');
  addForm.className = 'add-member-form';
  addForm.innerHTML = `
    <div class="form-group"><label class="form-label">소속명</label><input type="text" class="form-control" id="new-dept-name" placeholder="Design"></div>
    <div class="form-group"><label class="form-label">승인자</label>
      <select class="form-control" id="new-dept-approver">
        <option value="">선택</option>
        ${STATE.members.filter(m => m.active).map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">승인자 이메일</label><input type="email" class="form-control" id="new-dept-email" placeholder="approver@example.com"></div>
    <button class="btn-add-member" id="btn-add-dept">+ 소속 추가</button>`;
  deptSection.appendChild(addForm);

  document.getElementById('btn-add-dept')?.addEventListener('click', async () => {
    const name = document.getElementById('new-dept-name').value.trim();
    const approverName = document.getElementById('new-dept-approver').value;
    const approverEmail = document.getElementById('new-dept-email').value.trim();
    if (!name || !approverName) { showToast('소속명과 승인자를 입력해주세요.', 'warning'); return; }
    if (STATE.departments.find(d => d.name === name)) { showToast('이미 존재하는 소속명입니다.', 'warning'); return; }

    if (!CONFIG.API_URL) {
      STATE.departments.push({ name, approverName, approverEmail });
      showToast('소속이 추가되었습니다.', 'success', 1500);
      renderDepartmentsTab();
      return;
    }
    showLoading();
    try {
      await apiPost('addDepartment', { name, approverName, approverEmail });
      const res = await apiGet('getDepartments');
      if (Array.isArray(res)) STATE.departments = res;
      showToast('소속이 추가되었습니다.', 'success', 1500);
      renderDepartmentsTab();
    } catch (err) { showToast(`추가 실패: ${err.message}`, 'error'); }
    finally { hideLoading(); }
  });

  container.appendChild(deptSection);

  // ---- Member Department Assignment ----
  const assignSection = document.createElement('div');
  assignSection.className = 'admin-section';
  assignSection.innerHTML = `<div class="admin-section-header"><h2>인원 소속 배정</h2></div>`;

  const assignList = document.createElement('div');
  assignList.className = 'member-mgmt-list';

  STATE.members.filter(m => m.active).forEach(m => {
    const row = document.createElement('div');
    row.className = 'member-mgmt-row';
    row.innerHTML = `
      <span class="member-name">${escapeHtml(m.name)}</span>
      <span class="member-role-badge">${escapeHtml(m.role)}</span>
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
        <select class="form-control" style="width:150px;font-size:0.82rem" data-member-name="${escapeHtml(m.name)}">
          <option value="">미배정</option>
          ${STATE.departments.map(d => `<option value="${escapeHtml(d.name)}" ${m.department === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>`;

    row.querySelector('select').addEventListener('change', async (e) => {
      const dept = e.target.value;
      m.department = dept;
      if (!CONFIG.API_URL) {
        showToast(`${m.name} → ${dept || '미배정'}`, 'success', 1500);
        return;
      }
      try {
        await apiPost('updateMemberDepartment', { name: m.name, department: dept, email: m.email || '' });
        showToast(`${m.name} → ${dept || '미배정'}`, 'success', 1500);
      } catch (err) { showToast(`변경 실패: ${err.message}`, 'error'); }
    });

    assignList.appendChild(row);
  });

  assignSection.appendChild(assignList);
  container.appendChild(assignSection);
}

/* ============================================================
   LOGOUT
   ============================================================ */
function logout() {
  LS.clearSession();
  initLoginView();
}

/* ============================================================
   UTILS
   ============================================================ */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
