/* ============================================================
 * app.js — 主程式（UI 修復與後台權限全開版）
 * ============================================================ */

/* ---------- 全局音訊單例與基礎工具 ---------- */
let globalAudioCtx = null;
function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume();
  }
  return globalAudioCtx;
}

function safeKey(str) {
  if (!str) return 'unknown';
  return String(str).replace(/[.#$\[\]\/]/g, '_');
}
window.safeKey = safeKey;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
window.esc = esc;

/* ---------- 全局狀態 ---------- */
let currentUser = { uid: null, identifier: null, role: 'passenger', loginTime: null };
let isSuperAdmin = false, isAdmin = false;
let driverData = { mode: 'busy', direction: 0, stationIndex: 0, passengerCount: 0, isActive: false, plate: null, carSeats: 16, isFull: false };
let isLoggingIn = false;
let kickListenRef = null;
let announceListenRef = null;
let broadcastListenRef = null;

/* ---------- Firebase 初始化 ---------- */
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

/* ---------- 界面提示與視圖控制 ---------- */
function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}
window.showToast = showToast;

function isBanned(uid) {
  if (!uid) return Promise.resolve(false);
  return db.ref('bans/' + safeKey(uid)).once('value')
    .then(s => !!s.val())
    .catch(() => false);
}
window.isBanned = isBanned;

function getSavedPlate(identifier) {
  if (!identifier) return null;
  try {
    const data = JSON.parse(localStorage.getItem('savedPlates') || '{}');
    return data[identifier] || null;
  } catch (e) { return null; }
}
function savePlate(identifier, plate) {
  if (!identifier || !plate) return;
  try {
    const data = JSON.parse(localStorage.getItem('savedPlates') || '{}');
    data[identifier] = plate;
    localStorage.setItem('savedPlates', JSON.stringify(data));
  } catch (e) {}
}

function getRoute() { return getRouteByMode(driverData.mode, driverData.direction); }
function getCoords() { return getCoordsByMode(driverData.mode, driverData.direction); }

/* ---------- 播放語音 ---------- */
function playBoostedAudio(base64, boost = 7) {
  if (!base64) return;
  try {
    const ctx = getAudioContext();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    ctx.decodeAudioData(bytes.buffer.slice(0), buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = boost;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    }, err => {
      console.warn('decodeAudioData 錯誤，使用音訊元素播放:', err);
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

/* ---------- 錄音控制器管理 ---------- */
const RecorderManager = {
  instances: {},
  create: function(id, onSend) {
    if (this.instances[id]) return this.instances[id];
    let mr = null, stream = null, chunks = [], timer = null, sec = 0, isRec = false;
    const self = {
      start: function() {
        if (isRec) return;
        isRec = true;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
          stream = s;
          try {
            mr = new MediaRecorder(s, { audioBitsPerSecond: CONFIG.VOICE_BITRATE || 24000, mimeType: 'audio/webm;codecs=opus' });
          } catch (e) {
            mr = new MediaRecorder(s, { audioBitsPerSecond: CONFIG.VOICE_BITRATE || 24000 });
          }
          chunks = [];
          mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
          mr.start();
          sec = 0;
          const st = document.getElementById(id + '-rec-status'); if (st) st.style.display = 'flex';
          const tm = document.getElementById(id + '-rec-time'); if (tm) tm.textContent = '0';
          timer = setInterval(() => {
            sec++;
            if (tm) tm.textContent = sec;
            if (sec >= (CONFIG.RECORD_MAX_SECONDS || 30)) self.stop();
          }, 1000);
        }).catch(err => {
          showToast('無法開啟咪高峰：' + err.message);
          isRec = false;
        });
      },
      stop: function() {
        if (!isRec) return;
        isRec = false;
        if (timer) { clearInterval(timer); timer = null; }
        if (mr && mr.state === 'recording') {
          mr.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => { if (onSend) onSend(reader.result.split(',')[1]); };
            reader.readAsDataURL(blob);
            if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
          };
          mr.stop();
        }
        const st = document.getElementById(id + '-rec-status'); if (st) st.style.display = 'none';
      },
      cancel: function() {
        if (!isRec) return;
        isRec = false;
        if (timer) { clearInterval(timer); timer = null; }
        if (mr && mr.state === 'recording') mr.stop();
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        const st = document.getElementById(id + '-rec-status'); if (st) st.style.display = 'none';
      },
      isRecording: function() { return isRec; }
    };
    this.instances[id] = self;
    return self;
  },
  get: function(id) { return this.instances[id]; }
};
window.RecorderManager = RecorderManager;

function setupRecordButton(btnId, timerId, callback) {
  const btn = document.getElementById(btnId);
  if (!btn || btn._bound) return;
  btn._bound = true;
  const prefix = btnId.replace(/^btn-/, '').replace(/-record$/, '');
  const rec = RecorderManager.create(prefix, callback);

  btn.addEventListener('click', () => {
    if (rec.isRecording()) return;
    rec.start();
    const ctrl = document.getElementById(prefix + '-record-controls');
    if (ctrl) ctrl.style.display = 'flex';
    btn.style.display = 'none';
  });
}
window.setupRecordButton = setupRecordButton;

/* ---------- 角色檢查（增強識別） ---------- */
async function checkRole(identifier) {
  let role = 'passenger';
  let isSuper = false;
  try {
    const adminSnap = await db.ref('admins').once('value');
    adminSnap.forEach(child => {
      const data = child.val();
      if (data && (
        data.identifier === identifier ||
        data.email === identifier ||
        data.phone === identifier ||
        data.uid === identifier ||
        child.key === safeKey(identifier)
      )) {
        role = 'admin';
        if (data.super === true || data.super === 'true') isSuper = true;
      }
    });

    if (SUPER_ADMIN_EMAILS.some(e => e.toLowerCase() === (identifier || '').toLowerCase())) {
      role = 'admin';
      isSuper = true;
    }

    if (role === 'passenger') {
      const driverSnap = await db.ref('drivers').once('value');
      driverSnap.forEach(child => {
        const data = child.val();
        if (data && (
          data.identifier === identifier ||
          data.email === identifier ||
          data.phone === identifier ||
          data.uid === identifier ||
          child.key === safeKey(identifier)
        )) {
          role = 'driver';
        }
      });
    }
  } catch (e) { console.warn('檢查角色失敗:', e); }
  return { role, isSuper };
}

/* ---------- 車牌設定 ---------- */
function bindSetPlateButton() {
  const btn = document.getElementById('btn-set-plate');
  const input = document.getElementById('driver-plate-input');
  if (!btn || !input || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', function () {
    const plate = (input.value || '').trim().toUpperCase();
    if (!plate) { showToast('請輸入車牌'); return; }
    if (!/^[A-Z0-9\u4e00-\u9fa5]{2,10}$/.test(plate)) {
      showToast('車牌格式不正確'); return;
    }
    driverData.plate = plate;
    savePlate(currentUser.identifier, plate);
    updateDriverUI();
    updateDriverDB();
    startDriverMsgListener();
    if (typeof loadShiftClaims === 'function') loadShiftClaims();
    if (typeof initWalkieTalkie === 'function') initWalkieTalkie();
    showToast('✅ 車牌已設定：' + plate);
    if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese(VOICE_TEXTS.carPlateSet);
  });
}

function logLogin(uid, identifier, role) {
  try {
    let device = '未知', os = '未知', browser = '未知';
    if (typeof UAParser === 'function') {
      const r = new UAParser().getResult();
      device = (r.device && r.device.type) ? r.device.type : 'desktop';
      os = (r.os && r.os.name) ? (r.os.name + ' ' + (r.os.version || '')) : '未知';
      browser = (r.browser && r.browser.name) ? (r.browser.name + ' ' + (r.browser.version || '')) : '未知';
    } else if (navigator.userAgent) {
      browser = navigator.userAgent.substring(0, 60);
    }
    db.ref('login_logs').push({
      uid, identifier, role,
      ip: '未能獲取',
      device, os, browser,
      loginTime: Date.now()
    }).catch(e => console.warn('寫入登入記錄失敗:', e));
  } catch (e) { console.warn('logLogin 失敗:', e); }
}

/* ---------- 司機乘客控制 ---------- */
function addPass() {
  if (!driverData.isActive) { showToast('請先開始當值'); return; }
  driverData.passengerCount++;
  updateDriverDB();
  showToast('👥 乘客 +1 → ' + driverData.passengerCount);
}

function subPass() {
  if (!driverData.isActive) { showToast('請先開始當值'); return; }
  if (driverData.passengerCount <= 0) { showToast('已經冇乘客'); return; }
  driverData.passengerCount--;
  updateDriverDB();
  showToast('👥 乘客 -1 → ' + driverData.passengerCount);
}

function toggleFull() {
  driverData.isFull = !driverData.isFull;
  updateDriverDB();
  showToast(driverData.isFull ? '🚫 已標記滿座' : '✅ 已取消滿座');
}

function switchDir() {
  if (!confirm('確定調頭？乘客數會清零。')) return;
  driverData.direction = driverData.direction === 0 ? 1 : 0;
  driverData.stationIndex = 0;
  driverData.passengerCount = 0;
  driverData.isFull = false;
  lastReportedIndex = -1;
  lastDriverScrollIndex = -1;
  updateDriverDB();
  renderDriverRouteStrip();
  showToast('🔄 已調頭，往' + (driverData.direction === 0 ? '元朗' : '大棠'));
  if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese(VOICE_TEXTS.turnAround);
}

/* ---------- 路線切換（視覺與邏輯全面優化） ---------- */
function toggleMode() {
  const next = driverData.mode === 'busy' ? 'normal' : 'busy';
  const name = next === 'busy' ? '西鐵快線' : '市中心循環線';
  if (!confirm('確定切換至「' + name + '」？')) return;
  driverData.mode = next;
  driverData.direction = 0;
  driverData.stationIndex = 0;
  driverData.passengerCount = 0;
  driverData.isFull = false;
  lastReportedIndex = -1;
  lastDriverScrollIndex = -1;
  updateDriverDB();
  renderDriverRouteStrip();
  showToast('🔄 已切換至 ' + name);
  if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese(VOICE_TEXTS.switchedTo + name);
}

function toggleCarSeats() {
  const options = [16, 14, 12];
  const idx = options.indexOf(driverData.carSeats);
  driverData.carSeats = options[(idx + 1) % options.length];
  updateDriverDB();
  const el = document.getElementById('d-car-seats');
  if (el) el.textContent = driverData.carSeats;
  showToast('🚐 座位數：' + driverData.carSeats);
}

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
  
  // 模式標籤與按鈕樣式動態更新（解決白色、看不出掣問題）
  const modeBadge = document.getElementById('d-mode-badge');
  const modeBtn = document.getElementById('d-mode-btn');
  if (driverData.mode === 'busy') {
    if (modeBadge) {
      modeBadge.textContent = '西鐵快線';
      modeBadge.className = 'badge badge-purple';
    }
    if (modeBtn) {
      modeBtn.textContent = '🔄 切換路線：市中心循環線';
      modeBtn.className = 'btn btn-mode-busy';
    }
  } else {
    if (modeBadge) {
      modeBadge.textContent = '市中心循環線';
      modeBadge.className = 'badge badge-gold';
    }
    if (modeBtn) {
      modeBtn.textContent = '🔄 切換路線：西鐵快線';
      modeBtn.className = 'btn btn-mode-normal';
    }
  }
  
  const dirBadge = document.getElementById('d-dir-badge');
  if (dirBadge) dirBadge.textContent = driverData.direction === 0 ? '往元朗' : '往大棠';
  
  const fullBtn = document.getElementById('d-full-btn');
  if (fullBtn) {
    fullBtn.style.background = driverData.isFull ? 'linear-gradient(135deg,#f43f5e,#e11d48)' : 'linear-gradient(135deg,#10b981,#059669)';
    fullBtn.textContent = driverData.isFull ? '✅ 滿座' : '🚫 滿座';
  }
  const carBtn = document.getElementById('d-car-btn');
  if (carBtn) carBtn.textContent = driverData.carSeats + '座';
  const carSeatsEl = document.getElementById('d-car-seats');
  if (carSeatsEl) carSeatsEl.textContent = driverData.carSeats;
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
    node.innerHTML = '<div class="dot"></div><span>' + esc(name) + '</span>';
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

function startDuty() {
  if (!driverData.plate) { showToast('請先設定車牌'); return; }
  if (!navigator.geolocation) showToast('瀏覽器不支援 GPS，但仍可手動操作');
  gpsFirstFix = false;
  if (gpsRetryTimer) { clearTimeout(gpsRetryTimer); gpsRetryTimer = null; }
  voiceLock = false;
  lastPos = null; lastPosTime = 0; lastReportedTime = 0;
  gpsRestartNeeded = false; gpsRetryCount = 0; positionBuffer = [];
  requestWakeLock();
  driverData.isActive = true;
  driverData.stationIndex = 0;
  driverData.direction = 0;
  driverData.passengerCount = 0;
  driverData.isFull = false;
  lastReportedIndex = -1;
  lastDriverScrollIndex = -1;
  updateDriverDB();
  showToast('🟢 已開始當值');
  if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese(VOICE_TEXTS.startDuty);
  if (navigator.geolocation) {
    setTimeout(() => { if (driverData.isActive) startGpsWatch(); }, 1500);
  }
  const sg = document.getElementById('start-gps');
  const stg = document.getElementById('stop-gps');
  if (sg) sg.style.display = 'none';
  if (stg) stg.style.display = 'block';
}

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
  if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese(VOICE_TEXTS.stopDuty);
}
window.startDuty = startDuty;
window.stopDuty = stopDuty;

function initDriverPanel() {
  const savedPlate = getSavedPlate(currentUser.identifier);
  if (savedPlate && !driverData.plate) {
    driverData.plate = savedPlate;
    const inputEl = document.getElementById('driver-plate-input');
    if (inputEl) inputEl.value = savedPlate;
  }
  updateDriverUI();
  bindSetPlateButton();
  if (typeof initBookings === 'function') initBookings();
  if (typeof initWalkieTalkie === 'function') initWalkieTalkie();
  startDriverMsgListener();
  startAnnounceListener();
  startBroadcastListener();
  startKickListener();
  const sg = document.getElementById('start-gps');
  const stg = document.getElementById('stop-gps');
  if (sg) sg.style.display = driverData.isActive ? 'none' : 'block';
  if (stg) stg.style.display = driverData.isActive ? 'block' : 'none';
}

function startDriverMsgListener() {
  if (!driverData.plate) return;
  if (window._driverMsgRef) { try { window._driverMsgRef.off(); } catch (e) {} }
  window._driverMsgRef = db.ref('van/messages').orderByChild('busId').equalTo(driverData.plate);
  window._driverMsgRef.on('value', async snap => {
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
        span.textContent = ' 🎤 語音訊息';
        div.appendChild(span);
      } else {
        const txt = document.createTextNode((msg.senderIdentifier || '') + ': ' + (msg.text || '(訊息)'));
        div.appendChild(txt);
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-secondary';
      delBtn.style.cssText = 'width:auto;padding:4px 10px;font-size:13px;margin-left:auto;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => {
        if (confirm('確定刪除此訊息？')) db.ref('van/messages/' + item.key).remove().then(() => showToast('已刪除'));
      });
      div.appendChild(delBtn);
      el.appendChild(div);
    });
    if (items.length > 0 && items[0].msg.timestamp > (window._lastDriverMsgTs || 0) && window._lastDriverMsgTs) {
      const m = items[0].msg;
      if (typeof showMsgNotification === 'function') {
        showMsgNotification(m.audio ? 'audio' : 'text', m.senderIdentifier, m.text);
      }
    }
    if (items.length > 0) window._lastDriverMsgTs = items[0].msg.timestamp;
  });
}

function startAnnounceListener() {
  if (announceListenRef) { try { announceListenRef.off(); } catch (e) {} }
  announceListenRef = db.ref('van/announcements').orderByChild('timestamp').limitToLast(1);
  announceListenRef.on('value', snap => {
    snap.forEach(child => {
      const ann = child.val();
      if (!ann) return;
      if (window._lastAnnounceTs && ann.timestamp > window._lastAnnounceTs) {
        if (typeof showMsgNotification === 'function') {
          showMsgNotification(ann.audio ? 'audio' : 'text', ann.publisher || '管理員', ann.text || '語音公告');
        }
      }
      window._lastAnnounceTs = ann.timestamp;
    });
  });
}

function startBroadcastListener() {
  if (broadcastListenRef) { try { broadcastListenRef.off(); } catch (e) {} }
  broadcastListenRef = db.ref('van/messages').orderByChild('timestamp').limitToLast(20);
  broadcastListenRef.on('value', snap => {
    snap.forEach(child => {
      const m = child.val();
      if (!m || m.type !== 'broadcast') return;
      if (window._lastBroadcastTs && m.timestamp > window._lastBroadcastTs) {
        if (typeof showMsgNotification === 'function') {
          showMsgNotification(m.audio ? 'audio' : 'text', m.senderIdentifier || '廣播', m.text);
        }
        if (m.audio) playBoostedAudio(m.audio, 10);
      }
      window._lastBroadcastTs = Math.max(window._lastBroadcastTs || 0, m.timestamp);
    });
  });
}

function startKickListener() {
  if (!currentUser.identifier) return;
  if (kickListenRef) { try { kickListenRef.off(); } catch (e) {} }
  kickListenRef = db.ref('van/kick/' + safeKey(currentUser.identifier));
  kickListenRef.on('value', snap => {
    const k = snap.val();
    if (k && k.at && Date.now() - k.at < 60000) {
      showToast('⛔ 你已被管理員踢出');
      if (driverData.isActive) {
        driverData.isActive = false;
        if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
        releaseWakeLock();
        if (driverData.plate) db.ref('van/active_buses/' + driverData.plate).remove().catch(() => {});
        updateDriverUI();
      }
    }
  });
}

/* ---------- Tab 切換（修正後台面板顯示問題） ---------- */
function switchTab(tabName) {
  ['duty','claim','seats','msg','walkie','admin'].forEach(k => {
    const p = document.getElementById('tab-' + k);
    if (p) p.style.display = (k === tabName ? 'block' : 'none');
  });

  const tabButtons = document.querySelectorAll('#main-tabs .tab');
  tabButtons.forEach(b => b.classList.remove('active'));

  const tabMap = { duty: 0, claim: 1, seats: 2, msg: 3, walkie: 4, admin: 5 };
  const idx = tabMap[tabName];
  if (idx !== undefined && tabButtons[idx]) {
    tabButtons[idx].classList.add('active');
  }

  if (tabName === 'seats' && typeof renderSeatView === 'function') {
    renderSeatView();
    renderLoopBookings();
  }
  if (tabName === 'admin') {
    if (typeof loadAdminPanel === 'function') loadAdminPanel();
    if (typeof updateAdminBookingStats === 'function') updateAdminBookingStats();
    if (isSuperAdmin && typeof loadAdminList === 'function') loadAdminList();
  }
}
window.switchTab = switchTab;

/* ---------- 登入成功後處理後台按鈕及身份顯示 ---------- */
function applyUserRoleUI() {
  const adminBtn = document.getElementById('tab-admin-btn');
  const title = document.getElementById('admin-title');
  const roleDisp = document.getElementById('my-role-display');

  if (isAdmin) {
    if (adminBtn) {
      adminBtn.style.display = 'inline-block';
      adminBtn.textContent = isSuperAdmin ? '👑 超管後台' : '👑 總管後台';
    }
    if (title) title.textContent = isSuperAdmin ? '超管後台' : '總管後台';
    if (roleDisp) roleDisp.textContent = (isSuperAdmin ? '👑 超級管理員' : '👤 普通管理員') + '（' + currentUser.identifier + '）';
    
    if (isSuperAdmin) {
      const sec = document.getElementById('admin-section-manage-admins');
      if (sec) sec.style.display = 'block';
      const tb = document.getElementById('tab-manage-admins');
      if (tb) tb.style.display = 'block';
      if (typeof loadAdminList === 'function') loadAdminList();
    }
  } else {
    if (adminBtn) adminBtn.style.display = 'none';
    if (roleDisp) roleDisp.textContent = '🚏 司機（' + currentUser.identifier + '）';
  }
}

async function doLogin() {
  const id = document.getElementById('login-id').value.trim();
  if (!id) { document.getElementById('login-err').textContent = '請輸入電話或電郵'; return; }
  if (isLoggingIn) return;
  isLoggingIn = true;
  document.getElementById('login-err').textContent = '登入中...';
  try {
    await auth.signInAnonymously();
    const uid = auth.currentUser.uid;
    const { role, isSuper } = await checkRole(id);
    
    if (role !== 'driver' && role !== 'admin') {
      document.getElementById('login-err').textContent = '❌ 你不是司機或管理員（請先在後台新增）';
      await auth.signOut();
      isLoggingIn = false;
      return;
    }

    currentUser = { uid, identifier: id, role, loginTime: Date.now() };
    isAdmin = (role === 'admin');
    isSuperAdmin = isSuper;

    await db.ref('users/' + uid).set({ identifier: id, role, super: isSuperAdmin, lastLogin: Date.now() });
    logLogin(uid, id, role);

    document.getElementById('login-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';

    applyUserRoleUI();

    showToast('✅ 登入成功：' + id);
    if (voiceEnabled && typeof speakCantonese === 'function') {
      speakCantonese(isSuperAdmin ? '超級管理員登入成功' : isAdmin ? '管理員登入成功' : '司機登入成功');
    }
    initDriverPanel();
  } catch (e) {
    document.getElementById('login-err').textContent = '登入失敗：' + e.message;
  } finally {
    isLoggingIn = false;
  }
}

async function googleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    const email = user.email;
    const { role, isSuper } = await checkRole(email);

    if (role !== 'admin') {
      showToast('❌ 此 Google 帳戶不是管理員');
      await auth.signOut();
      return;
    }

    currentUser = { uid: user.uid, identifier: email, role, loginTime: Date.now() };
    isAdmin = true;
    isSuperAdmin = isSuper;

    await db.ref('users/' + user.uid).set({ identifier: email, email, role, super: isSuperAdmin, lastLogin: Date.now() });
    logLogin(user.uid, email, role);

    document.getElementById('login-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';

    applyUserRoleUI();

    showToast('✅ Google 登入成功：' + email);
    initDriverPanel();
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user') showToast('登入視窗已關閉');
    else showToast('❌ 登入失敗：' + e.message);
  }
}

window.addEventListener('load', () => {
  if (typeof initGlobalVoiceButton === 'function') initGlobalVoiceButton();
  if (typeof initMsgNotification === 'function') initMsgNotification();

  auth.onAuthStateChanged(async u => {
    if (u) {
      const snap = await db.ref('users/' + u.uid).once('value');
      const d = snap.val();
      if (d && d.identifier && !driverData.plate) {
        const { role, isSuper } = await checkRole(d.identifier);
        currentUser = { uid: u.uid, identifier: d.identifier, role, loginTime: Date.now() };
        isAdmin = (role === 'admin');
        isSuperAdmin = isSuper;

        document.getElementById('login-view').style.display = 'none';
        document.getElementById('main-view').style.display = 'block';

        applyUserRoleUI();
        initDriverPanel();
      }
    }
  });

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
window.addPass = addPass;
window.subPass = subPass;
window.toggleFull = toggleFull;
window.switchDir = switchDir;
window.toggleMode = toggleMode;
window.toggleCarSeats = toggleCarSeats;
window.bindSetPlateButton = bindSetPlateButton;
