/* ============================================================
 * admin.js — 管理員後台模組（黑金版）
 * 負責：監控、設備、對講機、封鎖、踢出、公告、廣播、管理員管理
 * 依賴：config.js、voice.js、messages.js、walkie.js、bookings.js
 * ============================================================ */

let adminMsgRef = null;
let adminBusesRef = null;
let adminAnnounceRef = null;

/* ---------- 超級管理員檢查 ---------- */
function isSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.some(e => e.toLowerCase() === (email || '').toLowerCase());
}
function isTargetSuperAdmin(identifier) { return isSuperAdminEmail(identifier); }
function isAnnounceFromSuperAdmin(announce) {
  if (!announce || !announce.publisher) return false;
  return isSuperAdminEmail(announce.publisher);
}
function requireSuperAdmin() {
  if (!isSuperAdmin) { showToast('⛔ 只有超級管理員可以執行此操作'); return false; }
  return true;
}
function checkTargetNotSuperAdmin(targetIdentifier) {
  if (isTargetSuperAdmin(targetIdentifier)) { showToast('⛔ 無法操作超級管理員'); return false; }
  return true;
}
function checkCanDeleteAnnounce(announce) {
  if (!isSuperAdmin && isAnnounceFromSuperAdmin(announce)) {
    showToast('⛔ 此公告由超級管理員發出，普通管理員不能刪除');
    return false;
  }
  return true;
}

/* ---------- 載入管理員面板 ---------- */
function loadAdminPanel() {
  try {
    // 在線車輛
    if (adminBusesRef) adminBusesRef.off();
    adminBusesRef = db.ref('van/active_buses');
    adminBusesRef.on('value', snap => {
      try {
        const data = snap.val() || {};
        let count = 0, total = 0;
        const now = Date.now();
        for (const plate in data) {
          if (now - data[plate].lastUpdate < CONFIG.ACTIVE_BUS_TIMEOUT) {
            count++;
            total += data[plate].passengerCount || 0;
          }
        }
        const activeEl = document.getElementById('admin-active-count');
        const passEl = document.getElementById('admin-passenger-count');
        if (activeEl) activeEl.textContent = count;
        if (passEl) passEl.textContent = total;
        updateOnlineLists(data);
      } catch (e) { console.error('更新在線列表失敗:', e); }
    });

    // 訊息監控
    if (adminMsgRef) adminMsgRef.off();
    adminMsgRef = db.ref('van/messages').orderByChild('timestamp').limitToLast(CONFIG.MESSAGE_LIMIT);
    adminMsgRef.on('value', snap => {
      try {
        const container = document.getElementById('admin-msg-list');
        if (!container) return;
        let html = '';
        let count = 0;
        const items = [];
        snap.forEach(child => {
          const msg = child.val();
          const time = new Date(msg.timestamp).toLocaleTimeString('zh-HK');
          items.push({ key: child.key, msg, time });
        });
        items.sort((a, b) => b.msg.timestamp - a.msg.timestamp);
        items.slice(0, 20).forEach(item => {
          const msg = item.msg;
          count++;
          const borderColor = msg.audio ? 'var(--orange)' : 'var(--gold)';
          html += '<div class="admin-item" style="border-left-color:' + borderColor + '">';
          html += '<div class="info">[' + item.time + '] ' + (msg.busId || '廣播') + ' (' + (msg.senderIdentifier || '未知') + ')</div>';
          html += '<div style="font-size:15px;color:#ffd700;">' + (msg.audio ? '🎤 [語音訊息]' : (msg.text || '')) + '</div>';
          if (msg.audio) html += '<button class="play-audio" onclick="playBoostedAudio(\'' + msg.audio + '\', 10)">▶ 播放</button>';
          html += ' <button class="btn btn-danger btn-sm" onclick="adminDeleteMsg(\'' + item.key + '\')">🗑️ 刪除</button>';
          html += '</div>';
        });
        container.innerHTML = html || '<div class="item">暫無訊息</div>';
        const msgEl = document.getElementById('admin-msg-count');
        if (msgEl) msgEl.textContent = count;
      } catch (e) { console.error('監聽訊息失敗:', e); }
    });

    // 留位統計
    updateAdminBookingStats();

    // 對講機
    if (typeof initAdminWalkie === 'function') initAdminWalkie();

    // 設備、封鎖、公告
    loadDeviceList();
    loadBans();
    loadAdminAnnounce();
  } catch (e) { console.error('載入後台失敗:', e); }
}

/* ---------- 留位統計 ---------- */
async function updateAdminBookingStats() {
  try {
    const t = getToday();
    const bs = (await db.ref('booking/' + t).once('value')).val() || {};
    const lp = (await db.ref('booking_loop/' + t).once('value')).val() || {};
    const cl = (await db.ref('booking_seats/' + t).once('value')).val() || {};
    const claimCount = Object.keys(cl).filter(k => cl[k] && cl[k].plate).length;
    let pending = 0, reserved = 0, boarded = 0;
    Object.values(bs).forEach(b => {
      if (b.status === 'pending') pending++;
      else if (b.status === 'reserved') reserved++;
      else if (b.status === 'boarded') boarded++;
    });
    const elClaims = document.getElementById('ad-claims');
    const elBookings = document.getElementById('ad-bookings');
    const elLoop = document.getElementById('ad-loop');
    if (elClaims) elClaims.textContent = claimCount;
    if (elBookings) elBookings.textContent = Object.keys(bs).length;
    if (elLoop) elLoop.textContent = Object.keys(lp).length;

    const statsEl = document.getElementById('ad-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="item">📋 今日留位：<b>' + Object.keys(bs).length + '</b> 筆</div>' +
        '<div class="item">⏳ 待確認：<b>' + pending + '</b> · ✅ 已確認：<b>' + reserved + '</b> · 🚐 已上車：<b>' + boarded + '</b></div>' +
        '<div class="item">🔄 循環線：<b>' + Object.keys(lp).length + '</b> 筆</div>' +
        '<div class="item">🎫 已認領：<b>' + claimCount + '</b></div>';
    }
  } catch (e) { console.warn('留位統計失敗:', e); }
}

/* ---------- 更新在線列表 ---------- */
function updateOnlineLists(busesData) {
  try {
    const now = Date.now();
    const isSuper = isSuperAdmin;

    const driverContainer = document.getElementById('admin-online-drivers-ban');
    if (driverContainer) {
      let html = '', found = false;
      for (const plate in busesData) {
        const bus = busesData[plate];
        if (now - bus.lastUpdate < CONFIG.ACTIVE_BUS_TIMEOUT && bus.driverIdentifier) {
          found = true;
          const driverId = bus.driverUid || bus.driverIdentifier || plate;
          const isTargetSuper = isSuperAdminEmail(driverId);
          html += '<div class="admin-online-item"><div><span class="name">🚐 ' + plate + '</span> <span class="info">' + (bus.driverIdentifier || '') + '</span></div>' +
            (isTargetSuper ? '<span style="color:#888;font-size:13px;">⭐ 超級管理員</span>' : '<button class="action-btn ban" data-uid="' + driverId + '" data-type="driver">封鎖</button>') +
            '</div>';
        }
      }
      if (!found) html = '<div style="color:#888;text-align:center;padding:12px;font-size:14px;">沒有在線司機</div>';
      driverContainer.innerHTML = html;
      driverContainer.querySelectorAll('.action-btn.ban').forEach(btn => {
        btn.addEventListener('click', function () {
          const uid = this.dataset.uid;
          if (!checkTargetNotSuperAdmin(uid)) return;
          if (confirm('確定封鎖 ' + uid + ' 嗎？')) {
            db.ref('bans/' + uid).set({ identifier: uid, bannedAt: Date.now(), type: this.dataset.type })
              .then(() => { showToast('已封鎖 ' + uid); });
          }
        });
      });
    }

    const vehicleContainer = document.getElementById('admin-online-vehicles-kick');
    if (vehicleContainer) {
      let html = '', found = false;
      for (const plate in busesData) {
        const bus = busesData[plate];
        if (now - bus.lastUpdate < CONFIG.ACTIVE_BUS_TIMEOUT) {
          found = true;
          const driverId = bus.driverUid || bus.driverIdentifier || plate;
          const isTargetSuper = isSuperAdminEmail(driverId);
          html += '<div class="admin-online-item"><div><span class="name">🚐 ' + plate + '</span> <span class="info">👥 ' + (bus.passengerCount || 0) + '人 · ' + (bus.currentStation || '未知') + '</span></div>' +
            (isTargetSuper ? '<span style="color:#888;font-size:13px;">⭐ 超級管理員</span>' : '<button class="action-btn kick" data-plate="' + plate + '" data-uid="' + driverId + '">踢出</button>') +
            '</div>';
        }
      }
      if (!found) html = '<div style="color:#888;text-align:center;padding:12px;font-size:14px;">沒有在線車輛</div>';
      vehicleContainer.innerHTML = html;
      vehicleContainer.querySelectorAll('.action-btn.kick').forEach(btn => {
        btn.addEventListener('click', function () {
          const plate = this.dataset.plate;
          const uid = this.dataset.uid;
          if (!checkTargetNotSuperAdmin(uid)) return;
          if (confirm('確定踢走車輛 ' + plate + ' 嗎？')) {
            const clearEl = document.getElementById('admin-kick-clear-msgs');
            const clear = clearEl ? clearEl.checked : false;
            db.ref('van/active_buses/' + plate).remove().then(() => {
              if (clear) {
                db.ref('van/messages').orderByChild('busId').equalTo(plate).once('value', s => {
                  s.forEach(c => c.ref.remove());
                });
              }
              showToast('已踢走車輛 ' + plate);
              const st = document.getElementById('admin-kick-status');
              if (st) st.textContent = '✅ 已踢走 ' + plate;
            });
          }
        });
      });
    }

    // 在線乘客
    const passengerContainer = document.getElementById('admin-online-passengers-ban');
    if (passengerContainer) {
      db.ref('van/messages').orderByChild('timestamp').limitToLast(20).once('value', snap => {
        let html = '', found = false, seen = new Set();
        snap.forEach(child => {
          const msg = child.val();
          const identifier = msg.senderIdentifier;
          if (identifier && !seen.has(identifier) && !identifier.includes('👑')) {
            seen.add(identifier); found = true;
            const isTargetSuper = isSuperAdminEmail(identifier);
            html += '<div class="admin-online-item"><div><span class="name">🧍 ' + identifier + '</span> <span class="info">最近活躍</span></div>' +
              (isTargetSuper ? '<span style="color:#888;font-size:13px;">⭐ 超級管理員</span>' : '<button class="action-btn ban" data-uid="' + identifier + '" data-type="passenger">封鎖</button>') +
              '</div>';
          }
        });
        if (!found) html = '<div style="color:#888;text-align:center;padding:12px;font-size:14px;">沒有活躍乘客</div>';
        passengerContainer.innerHTML = html;
        passengerContainer.querySelectorAll('.action-btn.ban').forEach(btn => {
          btn.addEventListener('click', function () {
            const uid = this.dataset.uid;
            if (!checkTargetNotSuperAdmin(uid)) return;
            if (confirm('確定封鎖 ' + uid + ' 嗎？')) {
              db.ref('bans/' + uid).set({ identifier: uid, bannedAt: Date.now(), type: this.dataset.type })
                .then(() => showToast('已封鎖 ' + uid));
            }
          });
        });
      });
    }

    const kickPassengerContainer = document.getElementById('admin-online-passengers-kick');
    if (kickPassengerContainer) {
      db.ref('van/messages').orderByChild('timestamp').limitToLast(20).once('value', snap => {
        let html = '', found = false, seen = new Set();
        snap.forEach(child => {
          const msg = child.val();
          const identifier = msg.senderIdentifier;
          if (identifier && !seen.has(identifier) && !identifier.includes('👑')) {
            seen.add(identifier); found = true;
            const isTargetSuper = isSuperAdminEmail(identifier);
            html += '<div class="admin-online-item"><div><span class="name">🧍 ' + identifier + '</span> <span class="info">最近活躍</span></div>' +
              (isTargetSuper ? '<span style="color:#888;font-size:13px;">⭐ 超級管理員</span>' : '<button class="action-btn kick" data-identifier="' + identifier + '">踢出</button>') +
              '</div>';
          }
        });
        if (!found) html = '<div style="color:#888;text-align:center;padding:12px;font-size:14px;">沒有活躍乘客</div>';
        kickPassengerContainer.innerHTML = html;
        kickPassengerContainer.querySelectorAll('.action-btn.kick').forEach(btn => {
          btn.addEventListener('click', function () {
            const identifier = this.dataset.identifier;
            if (!checkTargetNotSuperAdmin(identifier)) return;
            if (confirm('確定踢走乘客 ' + identifier + ' 嗎？')) {
              const clearEl = document.getElementById('admin-kick-clear-msgs');
              const clear = clearEl ? clearEl.checked : false;
              db.ref('van/messages').orderByChild('senderIdentifier').equalTo(identifier).once('value', snap => {
                let count = 0;
                snap.forEach(c => { if (clear) c.ref.remove(); else c.ref.update({ hidden: true }); count++; });
                showToast('已處理 ' + count + ' 條訊息');
                const st = document.getElementById('admin-kick-status');
                if (st) st.textContent = '✅ 已處理乘客 ' + identifier + ' 嘅 ' + count + ' 條訊息';
              });
            }
          });
        });
      });
    }
  } catch (e) { console.error('updateOnlineLists 失敗:', e); }
}

/* ---------- 設備列表 ---------- */
function loadDeviceList() {
  try {
    const container = document.getElementById('admin-device-list');
    if (!container) return;
    db.ref('login_logs').orderByChild('loginTime').limitToLast(100).on('value', snap => {
      const data = snap.val() || {};
      let arr = [];
      for (const key in data) {
        const log = data[key];
        arr.push({
          uid: log.uid, identifier: log.identifier || '未知',
          role: log.role || '未知', ip: log.ip || '未能獲取',
          device: log.device || '未知', os: log.os || '未知',
          browser: log.browser || '未知',
          loginTime: log.loginTime || 0,
          loginTimeStr: log.loginTime ? new Date(log.loginTime).toLocaleString('zh-HK') : '未知'
        });
      }
      arr.sort((a, b) => (b.loginTime || 0) - (a.loginTime || 0));
      let html = '';
      arr.slice(0, 20).forEach(item => {
        html += '<div class="admin-item" style="border-left-color:var(--gold);padding:10px;">';
        html += '<div class="title" style="color:#ffd700;font-weight:700;">📱 ' + item.device + '</div>';
        html += '<div class="info" style="color:#ffd700;">';
        html += '<strong style="color:#fff;">識別:</strong> ' + item.identifier + '<br>';
        html += '<strong style="color:#fff;">角色:</strong> ' + item.role + '<br>';
        html += '<strong style="color:#fff;">系統:</strong> ' + item.os + ' | <strong style="color:#fff;">瀏覽器:</strong> ' + item.browser + '<br>';
        html += '<strong style="color:#fff;">IP:</strong> ' + item.ip + '<br>';
        html += '<strong style="color:#fff;">登入時間:</strong> ' + item.loginTimeStr;
        html += '</div></div>';
      });
      container.innerHTML = html || '<div class="item">暫無登入記錄</div>';
    });
  } catch (e) { console.error('loadDeviceList 失敗:', e); }
}

/* ---------- 封鎖列表 ---------- */
function loadBans() {
  try {
    db.ref('bans').on('value', snap => {
      const data = snap.val() || {};
      let html = '';
      Object.keys(data).forEach(uid => {
        const ban = data[uid];
        html += '<div class="item">🚫 ' + (ban.identifier || uid) + ' <button class="btn btn-outline btn-sm" onclick="removeBan(\'' + uid + '\')">解除</button></div>';
      });
      const el = document.getElementById('admin-banned-phones');
      if (el) el.innerHTML = html || '<div class="item">無封鎖記錄</div>';
    });
  } catch (e) { console.error('loadBans 失敗:', e); }
}

async function removeBan(uid) {
  if (!confirm('確定解除封鎖？')) return;
  await db.ref('bans/' + uid).remove();
  showToast('✅ 已解除');
}

/* ---------- 公告列表 ---------- */
function loadAdminAnnounce() {
  try {
    db.ref('van/announcements').orderByChild('timestamp').limitToLast(20).on('value', snap => {
      let html = '';
      const items = [];
      snap.forEach(child => { items.push({ key: child.key, ann: child.val() }); });
      items.sort((a, b) => b.ann.timestamp - a.ann.timestamp);
      items.slice(0, 10).forEach(item => {
        const ann = item.ann, isAudio = !!ann.audio;
        const isSuperPub = isAnnounceFromSuperAdmin(ann);
        html += '<div class="item">[' + new Date(ann.timestamp).toLocaleString('zh-HK') + '] ';
        html += (isSuperPub ? '⭐ ' : '') + (isAudio ? '🎤 語音公告' : (ann.text || ''));
        if (isAudio) html += ' <button class="play-audio" onclick="playBoostedAudio(\'' + ann.audio + '\', 10)">▶ 播放</button>';
        html += ' <button class="btn btn-danger btn-sm" onclick="deleteAnnounce(\'' + item.key + '\',\'' + (ann.publisher || '') + '\')">🗑️</button>';
        html += '</div>';
      });
      const c = document.getElementById('admin-announce-list');
      if (c) c.innerHTML = html || '<div class="item">暫無公告</div>';
    });
  } catch (e) { console.error('loadAdminAnnounce 失敗:', e); }
}

async function deleteAnnounce(key, publisher) {
  if (!isSuperAdmin && isSuperAdminEmail(publisher)) {
    return showToast('⛔ 此公告由超管發出，普通管理員不能刪除');
  }
  if (!confirm('確定刪除此公告？')) return;
  await db.ref('van/announcements/' + key).remove();
  showToast('✅ 已刪除');
}

async function clearAllAnnounce() {
  if (!requireSuperAdmin()) return;
  if (!confirm('⚠️ 確定清除所有公告？')) return;
  await db.ref('van/announcements').remove();
  showToast('✅ 已清除');
}

/* ---------- 管理員列表 ---------- */
function loadAdminList() {
  if (!isSuperAdmin) return;
  const container = document.getElementById('admin-list');
  if (!container) return;
  db.ref('admins').once('value', snap => {
    const data = snap.val() || {};
    let html = '';
    for (const key in data) {
      const admin = data[key];
      const email = admin.identifier || admin.email || '未知';
      const isSuper = isSuperAdminEmail(email);
      const isMe = email === currentUser.identifier;
      html += '<div class="item">' + (isSuper ? '👑' : '👤') + ' ' + email;
      if (isMe) html += ' <span style="color:#fff;font-size:12px">（你）</span>';
      if (!isMe && admin.super !== undefined) html += ' <button class="btn btn-outline btn-sm" onclick="toggleSuper(\'' + key + '\')">切換</button>';
      if (!isMe) html += ' <button class="btn btn-danger btn-sm" onclick="removeAdmin(\'' + key + '\')">移除</button>';
      html += '</div>';
    }
    container.innerHTML = html || '<div class="item">暫無管理員</div>';
  });
}

async function removeAdmin(key) {
  if (!isSuperAdmin) return showToast('❌ 只有超管');
  if (!confirm('確定移除？')) return;
  const snap = await db.ref('admins/' + key).once('value');
  const data = snap.val();
  if (data && (data.email === currentUser.identifier || data.identifier === currentUser.identifier)) return showToast('❌ 唔可以移除自己');
  await db.ref('admins/' + key).remove();
  showToast('✅ 已移除');
  loadAdminList();
}

async function toggleSuper(key) {
  if (!isSuperAdmin) return showToast('❌ 只有超管');
  const snap = await db.ref('admins/' + key).once('value');
  const data = snap.val();
  if (!data) return;
  if (data.email === currentUser.identifier || data.identifier === currentUser.identifier) return showToast('❌ 唔可以改自己');
  await db.ref('admins/' + key).update({ super: !data.super });
  showToast('✅ 已切換');
  loadAdminList();
}

/* ---------- 套用管理員權限 ---------- */
function applyAdminPermissions() {
  const tab = document.getElementById('tab-manage-admins');
  if (tab) tab.style.display = isSuperAdmin ? 'block' : 'none';
  const section = document.getElementById('admin-section-manage-admins');
  if (section) section.style.display = isSuperAdmin ? 'block' : 'none';
  if (isSuperAdmin) loadAdminList();
}

/* ---------- 刪除訊息 ---------- */
async function adminDeleteMsg(key) {
  if (!isAdmin) return showToast('❌ 冇權限');
  if (!confirm('確定刪除？')) return;
  await db.ref('van/messages/' + key).remove();
  showToast('✅ 已刪除');
}

async function adminDeleteWalkie(key) {
  if (!isAdmin) return showToast('❌ 冇權限');
  if (!confirm('確定刪除？')) return;
  await db.ref('van/walkie_talkie/' + key).remove();
  showToast('✅ 已刪除');
}

async function clearAllMessages() {
  if (!isAdmin) return showToast('❌ 冇權限');
  if (!confirm('⚠️ 確定清除所有訊息？')) return;
  await db.ref('van/messages').remove();
  showToast('✅ 已清除');
}

async function clearAllWalkie() {
  if (!isAdmin) return showToast('❌ 冇權限');
  if (!confirm('⚠️ 確定清除所有對講機訊息？')) return;
  await db.ref('van/walkie_talkie').remove();
  showToast('✅ 已清除');
}

/* ---------- 公告發佈 ---------- */
async function publishAnnounce() {
  const i = document.getElementById('admin-announce-text');
  const text = i ? i.value.trim() : '';
  if (!text) return showToast('請輸入公告內容');
  await db.ref('van/announcements').push({ text, publisher: currentUser.identifier, timestamp: Date.now() });
  if (i) i.value = '';
  showToast('✅ 公告已發佈');
}

/* ---------- 新增司機 ---------- */
async function addDriver() {
  const input = document.getElementById('admin-add-driver-identifier');
  const identifier = input ? input.value.trim() : '';
  if (!identifier) return showToast('請輸入電郵或電話');
  await db.ref('drivers').push({ identifier, addedBy: currentUser.identifier, createdAt: Date.now() });
  if (input) input.value = '';
  const st = document.getElementById('admin-add-driver-status');
  if (st) st.textContent = '✅ 已新增司機：' + identifier;
  showToast('✅ 司機已新增');
}

/* ---------- 新增管理員 ---------- */
async function addAdmin() {
  if (!isSuperAdmin) return showToast('❌ 只有超管');
  const emailEl = document.getElementById('admin-add-admin-email');
  const isSuperEl = document.getElementById('admin-add-admin-super');
  const email = emailEl ? emailEl.value.trim().toLowerCase() : '';
  const isSuper = isSuperEl ? isSuperEl.value === 'true' : false;
  if (!email || !email.includes('@')) return showToast('請輸入有效電郵');
  const exist = await db.ref('admins').orderByChild('email').equalTo(email).once('value');
  if (exist.exists()) return showToast('⚠️ 已存在');
  const key = email.split('@')[0].replace(/[.#$\[\]]/g, '_');
  await db.ref('admins/' + key).set({ email, identifier: email, super: isSuper, addedBy: currentUser.identifier, addedAt: Date.now() });
  if (emailEl) emailEl.value = '';
  const st = document.getElementById('admin-add-admin-status');
  if (st) st.textContent = '✅ 已新增 ' + (isSuper ? '超級' : '普通') + '管理員：' + email;
  showToast('✅ 管理員已新增');
  loadAdminList();
}

/* ---------- 廣播 ---------- */
async function sendBroadcast() {
  const targetEl = document.getElementById('admin-broadcast-target');
  const inputEl = document.getElementById('admin-broadcast-input');
  const target = targetEl ? targetEl.value.trim().toUpperCase() : '';
  const text = inputEl ? inputEl.value.trim() : '';
  if (!text) return showToast('請輸入廣播訊息');
  await db.ref('van/messages').push({
    busId: target || '廣播',
    senderUid: currentUser.uid,
    senderIdentifier: currentUser.identifier + ' (👑廣播)',
    text,
    timestamp: Date.now(),
    type: 'broadcast'
  });
  if (inputEl) inputEl.value = '';
  const st = document.getElementById('admin-broadcast-status');
  if (st) st.textContent = '✅ 已發送廣播至 ' + (target || '全體');
  showToast('廣播已發送');
}