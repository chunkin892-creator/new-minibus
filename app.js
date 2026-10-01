/* ============================================================
 * app.js — 主程式（黑金整合版）
 * 負責：Firebase 初始化、角色檢查、登入、Tab 切換、司機面板、事件綁定
 * 依賴：config.js, routes.js, voice.js, gps.js, messages.js, walkie.js, bookings.js, admin.js
 * ============================================================ */

/* ---------- 全局狀態 ---------- */
let currentUser = { uid: null, identifier: null, role: 'passenger', loginTime: null };
let isSuperAdmin = false, isAdmin = false;
let driverData = { mode: 'busy', direction: 0, stationIndex: 0, passengerCount: 0, isActive: false, plate: null, carSeats: 16, isFull: false };
let currentBusId = null;
let busListRef = null;
let isLoggingIn = false;

/* ---------- Firebase 初始化 ---------- */
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
console.log('🔥 Firebase DB:', firebase.app().options.databaseURL);

/* ---------- 工具 ---------- */
function showToast(msg, duration) {
  if (!duration) duration = 3000;
  const t = document.getElementById('toast');
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function isBanned(uid) {
  if (!uid) return Promise.resolve(false);
  return db.ref('bans/' + uid).once('value').then(s => !!s.val()).catch(() => false);
}

function getSavedPlate(identifier) {
  if (!identifier) return null;
  try { const data = JSON.parse(localStorage.getItem('savedPlates') || '{}'); return data[identifier] || null; } catch (e) { return null; }
}
function savePlate(identifier, plate) {
  if (!identifier || !plate) return;
  try { const data = JSON.parse(localStorage.getItem('savedPlates') || '{}'); data[identifier] = plate; localStorage.setItem('savedPlates', JSON.stringify(data)); } catch (e) {}
}

function getRoute() { return getRouteByMode(driverData.mode, driverData.direction); }
function getCoords() { return getCoordsByMode(driverData.mode, driverData.direction); }

/* ---------- 播放語音（放大音量） ---------- */
function playBoostedAudio(base64, boost) {
  if (!base64) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    ctx.decodeAudioData(bytes.buffer, buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = boost || 7;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    }, err => {
      const audio = new Audio('data:audio/webm;base64,' + base64);
      audio.volume = 1.0;
      audio.play().catch(() => {});
    });
  } catch (e) {
    const audio = new Audio('data:audio/webm;base64,' + base64);
    audio.volume = 1.0;
    audio.play().catch(() => {});
  }
}
window.playBoostedAudio = playBoostedAudio;

/* ---------- 長按錄音按鈕 ---------- */
function setupRecordButton(btnId, timerId, callback) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const timer = document.getElementById(timerId);
  let longPress = null, isRecording = false, mediaRecorder = null, mediaStream = null, audioChunks = [], recordingTimer = null, recSeconds = 0;

  function startRec(e) {
    e.preventDefault();
    if (isRecording) return;
    isRecording = true;
    longPress = setTimeout(() => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showToast('不支援錄音'); isRecording = false; return; }
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          mediaStream = stream;
          try { mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: CONFIG.VOICE_BITRATE, mimeType: 'audio/webm;codecs=opus' }); }
          catch (e) { mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: CONFIG.VOICE_BITRATE }); }
          audioChunks = [];
          mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
          mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result.split(',')[1];
              if (callback) callback(base64);
              showToast('錄音完成');
            };
            reader.readAsDataURL(blob);
            btn.classList.remove('recording');
            if (timer) { timer.style.display = 'none'; timer.textContent = '0s'; }
            clearInterval(recordingTimer);
            recordingTimer = null;
          };
          mediaRecorder.start();
          btn.classList.add('recording');
          recSeconds = 0;
          if (timer) { timer.style.display = 'block'; timer.textContent = '0s'; }
          recordingTimer = setInterval(() => {
            recSeconds++;
            if (timer) timer.textContent = recSeconds + 's';
            if (recSeconds >= CONFIG.RECORD_MAX_SECONDS) {
              if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
              }
              isRecording = false;
              clearInterval(recordingTimer);
              recordingTimer = null;
              btn.classList.remove('recording');
              if (timer) { timer.style.display = 'none'; }
              showToast('錄音已達上限 ' + CONFIG.RECORD_MAX_SECONDS + ' 秒');
            }
          }, 1000);
        })
        .catch(() => { showToast('無法開啟咪高峰'); isRecording = false; btn.classList.remove('recording'); });
    }, 500);
  }
  function stopRec(e) {
    e.preventDefault();
    clearTimeout(longPress);
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    }
    isRecording = false;
  }
  btn.addEventListener('touchstart', startRec, { passive: false });
  btn.addEventListener('touchend', stopRec, { passive: false });
  btn.addEventListener('touchcancel', stopRec, { passive: false });
  btn.addEventListener('mousedown', startRec);
  btn.addEventListener('mouseup', stopRec);
  btn.addEventListener('mouseleave', stopRec);
}

/* ---------- 角色檢查（合併邏輯） ---------- */
async function checkRole(identifier) {
  let role = 'passenger';
  try {
    const adminSnap = await db.ref('admins').once('value');
    adminSnap.forEach(child => {
      const data = child.val();
      if (data.identifier === identifier || data.email === identifier || data.phone === identifier || data.uid === identifier) role = 'admin';
    });
    if (role === 'passenger') {
      const driverSnap = await db.ref('drivers').once('value');
      driverSnap.forEach(child => {
        const data = child.val();
        if (data.identifier === identifier || data.email === identifier || data.phone === identifier || data.uid === identifier) role = 'driver';
      });
    }
  } catch (e) { console.warn('檢查角色失敗:', e); }
  return role;
}

/* ---------- 安全點擊 ---------- */
function safeClick(el, cb) {
  if (!el) return;
  el.addEventListener('click', function (e) {
    if (this.disabled) return;
    this.disabled = true;
    try { cb(e); } catch (err) { console.error(err); showToast('操作錯誤'); }
    setTimeout(() => { this.disabled = false; }, 300);
  });
}

/* ============================================================
 * 司機 UI
 * ============================================================ */
function updateDriverUI() {
  const route = getRoute();
  const idx = driverData.stationIndex || 0;
  const station = route[idx] || '未知';
  const nextIdx = idx + 1 < route.length ? idx + 1 : 0;
  const nextStation = route[nextIdx] || '終點';
  const infoEl = document.getElementById('d-info');
  if (infoEl) infoEl.textContent = '🚐 ' + (driverData.plate || '未設定') + ' | 司機: ' + (currentUser.identifier || '未登入');
  const stationEl = document.getElementById('d-station');
  if (stationEl) stationEl.textContent = station;
  const targetEl = document.getElementById('d-target');
  if (targetEl) targetEl.textContent = '下一站：' + nextStation;
  const passEl = document.getElementById('d-pass-count');
  if (passEl) passEl.textContent = driverData.passengerCount;
  const modeBadge = document.getElementById('d-mode-badge');
  if (modeBadge) modeBadge.textContent = driverData.mode === 'busy' ? '西鐵快線' : '市中心循環線';
  const dirBadge = document.getElementById('d-dir-badge');
  if (dirBadge) dirBadge.textContent = driverData.direction === 0 ? '往元朗' : '往大棠';
  const fullBtn = document.getElementById('d-full-btn');
  if (fullBtn) {
    fullBtn.style.background = driverData.isFull ? 'linear-gradient(135deg,#f43f5e,#e11d48)' : 'linear-gradient(135deg,#10b981,#059669)';
    fullBtn.textContent = driverData.isFull ? '✅ 滿座' : '🚫 滿座';
  }
  const carBtn = document.getElementById('d-car-btn');
  if (carBtn) carBtn.textContent = driverData.carSeats + '座';
  renderDriverRouteStrip();
}

function renderDriverRouteStrip() {
  const strip = document.getElementById('d-route-strip');
  if (!strip) return;
  const route = getRoute();
  const idx = driverData.stationIndex || 0;
  strip.innerHTML = '';
  route.forEach((name, i) => {
    const node = document.createElement('div');
    node.className = 'dot-node';
    if (i < idx) node.classList.add('passed');
    else if (i === idx) node.classList.add('current');
    else if (i === idx + 1) node.classList.add('next');
    node.innerHTML = '<div class="dot"></div><span>' + name + '</span>';
    strip.appendChild(node);
  });
  if (idx !== lastDriverScrollIndex) {
    const current = strip.querySelector('.dot-node.current');
    if (current) {
      const stripRect = strip.getBoundingClientRect();
      const nodeRect = current.getBoundingClientRect();
      const offset = nodeRect.left - stripRect.left - (stripRect.width / 2) + (nodeRect.width / 2);
      strip.scrollLeft += offset;
    }
    lastDriverScrollIndex = idx;
  }
}

function updateDriverDB() {
  const route = getRoute();
  const idx = driverData.stationIndex || 0;
  const data = {
    plate: driverData.plate, mode: driverData.mode, direction: driverData.direction,
    stationIndex: idx, currentStation: route[idx] || '未知',
    nextStation: route[idx + 1] || '終點',
    passengerCount: driverData.passengerCount, isActive: driverData.isActive,
    carSeats: driverData.carSeats, isFull: driverData.isFull,
    lastUpdate: Date.now(), driverUid: currentUser.uid, driverIdentifier: currentUser.identifier
  };
  if (driverData.plate) db.ref('van/active_buses/' + driverData.plate).update(data).catch(console.warn);
  updateDriverUI();
}

/* ---------- 開始當值 ---------- */
function startDuty() {
  if (!driverData.plate) { showToast('請先設定車牌'); return; }
  if (!navigator.geolocation) showToast('瀏覽器不支援 GPS，但你仍然可以手動操作');
  gpsFirstFix = false;
  if (gpsRetryTimer) { clearTimeout(gpsRetryTimer); gpsRetryTimer = null; }
  voiceLock = false;
  lastPos = null; lastPosTime = 0; lastReportedTime = 0; gpsRestartNeeded = false; gpsRetryCount = 0; positionBuffer = [];
  requestWakeLock();
  driverData.isActive = true;
  driverData.stationIndex = 0;
  driverData.direction = 0;
  driverData.passengerCount = 0;
  driverData.isFull = false;
  lastReportedIndex = -1;
  lastDriverScrollIndex = -1;
  updateDriverDB();
  showToast('🟢 已開始當值' + (navigator.geolocation ? '' : '（GPS 不支援，請手動操作）'));
  if (voiceEnabled) speakCantonese(VOICE_TEXTS.startDuty);
  if (navigator.geolocation) {
    setTimeout(() => { if (driverData.isActive) startGpsWatch(); }, 1500);
  }
  const sg = document.getElementById('start-gps');
  const stg = document.getElementById('stop-gps');
  if (sg) sg.style.display = 'none';
  if (stg) stg.style.display = 'block';
}

/* ---------- 停止當值 ---------- */
function stopDuty() {
  if (!confirm('確定停止當值？')) return;
  driverData.isActive = false;
  if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  if (gpsRetryTimer) { clearTimeout(gpsRetryTimer); gpsRetryTimer = null; }
  releaseWakeLock();
  if (driverData.plate) db.ref('van/active_buses/' + driverData.plate).remove().catch(() => {});
  updateDriverUI();
  const sg = document.getElementById('start-gps');
  const stg = document.getElementById('stop-gps');
  if (sg) sg.style.display = 'block';
  if (stg) stg.style.display = 'none';
  showToast('🔴 已停止當值');
  if (voiceEnabled) speakCantonese(VOICE_TEXTS.stopDuty);
}

/* ---------- 司機面板初始化 ---------- */
function initDriverPanel() {
  const savedPlate = getSavedPlate(currentUser.identifier);
  if (savedPlate && !driverData.plate) {
    driverData.plate = savedPlate;
    const inputEl = document.getElementById('driver-plate-input');
    if (inputEl) inputEl.value = savedPlate;
  }
  updateDriverUI();
  // 啟動留位系統
  if (typeof initBookings === 'function') initBookings();
  // 對講機
  if (typeof initWalkieTalkie === 'function') initWalkieTalkie();
  // 訊息監聽
  startDriverMsgListener();
  const sg = document.getElementById('start-gps');
  const stg = document.getElementById('stop-gps');
  if (sg) sg.style.display = driverData.isActive ? 'none' : 'block';
  if (stg) stg.style.display = driverData.isActive ? 'block' : 'none';
}

/* ---------- 司機訊息監聽 ---------- */
function startDriverMsgListener() {
  if (!driverData.plate) return;
  const ref = db.ref('van/messages').orderByChild('busId').equalTo(driverData.plate);
  ref.on('value', async snap => {
    const banned = await isBanned(currentUser.uid);
    const el = document.getElementById('driver-msg-list');
    if (!el) return;
    el.innerHTML = '';
    const items = [];
    snap.forEach(child => {
      const msg = child.val();
      if (msg.hidden || banned) return;
      items.push({ key: child.key, msg });
    });
    items.sort((a, b) => b.msg.timestamp - a.msg.timestamp);
    let lastMsg = null, lastSender = null, lastType = 'text';
    items.forEach(item => {
      const msg = item.msg;
      const div = document.createElement('div');
      div.className = 'msg-row';
      const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('zh-HK') : '';
      const timeSpan = document.createElement('span');
      timeSpan.style.cssText = 'color:#888;font-size:12px;';
      timeSpan.textContent = timeStr ? '[' + timeStr + '] ' : '';
      div.appendChild(timeSpan);
      if (msg.audio) {
        const btn = document.createElement('button');
        btn.className = 'play-audio';
        btn.textContent = '▶ 語音';
        btn.addEventListener('click', () => playBoostedAudio(msg.audio, 7));
        div.appendChild(btn);
        const span = document.createElement('span');
        span.textContent = '🎤 語音訊息';
        div.appendChild(span);
        if (!lastMsg) { lastMsg = '🎤 語音訊息'; lastSender = msg.senderIdentifier || '乘客'; lastType = 'audio'; }
      } else {
        const txt = document.createTextNode((msg.senderIdentifier || '') + ': ' + (msg.text || '(訊息)'));
        div.appendChild(txt);
        if (!lastMsg) { lastMsg = msg.text || '(訊息)'; lastSender = msg.senderIdentifier || '乘客'; lastType = 'text'; }
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-secondary';
      delBtn.style.cssText = 'width:auto;padding:4px 10px;font-size:13px;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => {
        if (confirm('確定刪除此訊息？')) db.ref('van/messages/' + item.key).remove().then(() => showToast('已刪除'));
      });
      div.appendChild(delBtn);
      el.appendChild(div);
    });
  });
}

/* ============================================================
 * Tab 切換
 * ============================================================ */
function switchTab(tabName) {
  ['duty','claim','seats','msg','walkie','admin'].forEach(k => {
    const p = document.getElementById('tab-' + k);
    if (p) p.style.display = (k === tabName ? 'block' : 'none');
  });
  document.querySelectorAll('#main-tabs .tab').forEach(b => b.classList.remove('active'));
  const idx = { duty: 0, claim: 1, seats: 2, msg: 3, walkie: 4, admin: 5 }[tabName];
  const btns = document.querySelectorAll('#main-tabs .tab');
  if (btns[idx]) btns[idx].classList.add('active');
  if (tabName === 'seats' && typeof renderSeatView === 'function') { renderSeatView(); renderLoopBookings(); }
  if (tabName === 'admin') { updateAdminBookingStats(); if (isSuperAdmin) loadAdminList(); }
}

window.switchTab = switchTab;

/* ============================================================
 * 登入
 * ============================================================ */
async function doLogin() {
  const id = document.getElementById('login-id').value.trim();
  if (!id) { document.getElementById('login-err').textContent = '請輸入電話或電郵'; return; }
  document.getElementById('login-err').textContent = '登入中...';
  try {
    await auth.signInAnonymously();
    const uid = auth.currentUser.uid;
    const role = await checkRole(id);
    currentUser = { uid, identifier: id, role, loginTime: Date.now() };
    isAdmin = (role === 'admin');
    isSuperAdmin = isSuperAdminEmail(id);
    await db.ref('users/' + uid).set({ identifier: id, role, super: isSuperAdmin, lastLogin: Date.now() });
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
    if (isAdmin) {
      document.getElementById('tab-admin').style.display = 'inline-block';
      document.getElementById('tab-admin').textContent = isSuperAdmin ? '👑 超管後台' : '👑 總管後台';
      const title = document.getElementById('admin-title');
      if (title) title.textContent = isSuperAdmin ? '超管後台' : '總管後台';
      const roleDisp = document.getElementById('my-role-display');
      if (roleDisp) roleDisp.textContent = (isSuperAdmin ? '👑 超級管理員' : '👤 普通管理員') + '（' + id + '）';
      if (isSuperAdmin) {
        const sec = document.getElementById('admin-section-manage-admins');
        if (sec) sec.style.display = 'block';
        const tb = document.getElementById('tab-manage-admins');
        if (tb) tb.style.display = 'block';
        loadAdminList();
      }
    } else {
      const roleDisp = document.getElementById('my-role-display');
      if (roleDisp) roleDisp.textContent = '🚏 司機（' + id + '）';
    }
    showToast('✅ 登入成功：' + id);
    if (voiceEnabled) speakCantonese(isSuperAdmin ? '超級管理員登入成功' : isAdmin ? '管理員登入成功' : '司機登入成功');
    initDriverPanel();
  } catch (e) {
    document.getElementById('login-err').textContent = '登入失敗：' + e.message;
  }
}

async function googleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    const email = user.email;
    const role = await checkRole(email);
    if (role !== 'admin') {
      showToast('❌ 此 Google 帳戶不是管理員');
      await auth.signOut();
      return;
    }
    currentUser = { uid: user.uid, identifier: email, role, loginTime: Date.now() };
    isAdmin = true;
    isSuperAdmin = isSuperAdminEmail(email);
    await db.ref('users/' + user.uid).set({ identifier: email, email, role, super: isSuperAdmin, lastLogin: Date.now() });
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
    document.getElementById('tab-admin').style.display = 'inline-block';
    document.getElementById('tab-admin').textContent = isSuperAdmin ? '👑 超管後台' : '👑 總管後台';
    if (isSuperAdmin) {
      const sec = document.getElementById('admin-section-manage-admins');
      if (sec) sec.style.display = 'block';
      const tb = document.getElementById('tab-manage-admins');
      if (tb) tb.style.display = 'block';
      loadAdminList();
    }
    showToast('✅ Google 登入成功：' + email);
    initDriverPanel();
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user') showToast('登入視窗已關閉');
    else showToast('❌ 登入失敗：' + e.message);
  }
}

/* ============================================================
 * 頁面載入
 * ============================================================ */
window.addEventListener('load', () => {
  // 語音按鈕
  if (typeof initGlobalVoiceButton === 'function') initGlobalVoiceButton();
  // 通知關閉按鈕
  if (typeof initMsgNotification === 'function') initMsgNotification();

  // Auth 狀態監聽
  auth.onAuthStateChanged(async u => {
    if (u) {
      const snap = await db.ref('users/' + u.uid).once('value');
      const d = snap.val();
      if (d && d.identifier && !driverData.plate) {
        const role = await checkRole(d.identifier);
        currentUser = { uid: u.uid, identifier: d.identifier, role, loginTime: Date.now() };
        isAdmin = (role === 'admin');
        isSuperAdmin = isSuperAdminEmail(d.identifier);
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('main-view').style.display = 'block';
        if (isAdmin) {
          document.getElementById('tab-admin').style.display = 'inline-block';
          document.getElementById('tab-admin').textContent = isSuperAdmin ? '👑 超管後台' : '👑 總管後台';
          if (isSuperAdmin) {
            const sec = document.getElementById('admin-section-manage-admins');
            if (sec) sec.style.display = 'block';
            const tb = document.getElementById('tab-manage-admins');
            if (tb) tb.style.display = 'block';
            loadAdminList();
          }
        }
        initDriverPanel();
      }
    }
  });

  // 連線狀態
  db.ref('.info/connected').on('value', snap => {
    const s = document.getElementById('connection-status');
    if (!s) return;
    if (snap.val()) {
      s.textContent = '🟢 已連線';
      s.className = 'connection-status online';
      setTimeout(() => { s.style.display = 'none'; }, 2500);
    } else {
      s.textContent = '🔴 網絡中斷';
      s.className = 'connection-status offline';
      s.style.display = 'block';
    }
  });
});

window.doLogin = doLogin;
window.googleLogin = googleLogin;