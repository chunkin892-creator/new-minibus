/* ============================================================
 * bookings.js — 留位系統模組（v2 完整修復）
 * 負責：班次認領、座位圖、循環線留位、留位審核、No-show 清理
 * 修復：滿座超訂、重複初始化、XSS、廣播一致性
 * ============================================================ */

let claimsCache = {};
let bookingsCache = {};
let loopCache = {};
let shiftClaimRef = null;
let bookingListenerRef = null;
let loopListenerRef = null;
const notifiedBookingIds = new Set();
const notifiedLoopIds = new Set();
let _bookingsInited = false;

/* ---------- 工具 ---------- */
function getToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getSid(date, time) { return date + '_' + time.replace(':', ''); }
function getShiftTimestamp(date, time) {
  const parts = time.split(':');
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const d = new Date(date + 'T00:00:00');
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
function isPastShift(tm) { return Date.now() > getShiftTimestamp(getToday(), tm); }

/* ============================================================
 * 一、班次認領
 * ============================================================ */
function loadShiftClaims() {
  if (shiftClaimRef) { try { shiftClaimRef.off(); } catch (e) {} }
  shiftClaimRef = db.ref('booking_seats/' + getToday());
  shiftClaimRef.on('value', snap => {
    claimsCache = snap.val() || {};
    renderShiftList();
    renderSeatView();
  });
}

function renderShiftList() {
  const elM = document.getElementById('shift-morning');
  const elE = document.getElementById('shift-evening');
  if (elM) elM.innerHTML = FIXED_SHIFTS.morning.map(tm => renderShiftCard(tm)).join('');
  if (elE) elE.innerHTML = FIXED_SHIFTS.evening.map(tm => renderShiftCard(tm)).join('');
}

function renderShiftCard(tm) {
  const hhmm = tm.replace(':', '');
  const claim = claimsCache[hhmm] || {};
  const plate = claim.plate || null;
  const isMine = plate && driverData.plate && plate === driverData.plate;
  const isOther = plate && !isMine;
  const cls = isMine ? 'mine' : isOther ? 'other' : '';
  let tag;
  if (isMine) tag = '<span class="plate-tag mine">✅ 你認領中：' + esc(plate) + '</span>';
  else if (isOther) tag = '<span class="plate-tag taken">🚐 已被 ' + esc(plate) + ' 認領</span>';
  else tag = '<span class="plate-tag">⚪ 未認領</span>';
  let btn = '';
  if (!driverData.plate) btn = '<button class="btn btn-secondary btn-sm" disabled style="width:100%">請先設車牌</button>';
  else if (isMine) btn = '<button class="btn btn-danger btn-sm" onclick="unclaimShift(\'' + tm + '\')" style="width:100%">取消認領</button>';
  else if (isOther) btn = '<button class="btn btn-secondary btn-sm" disabled style="width:100%">已被佔用</button>';
  else btn = '<button class="btn btn-gold btn-sm" onclick="claimShift(\'' + tm + '\')" style="width:100%">認領</button>';
  return '<div class="shift-card ' + cls + '"><div><div class="time">' + tm + '</div><div class="origin">' + (parseInt(tm.split(':')[0]) < 12 ? '🌅 大棠黃泥墩開出' : '🌆 元朗港鐵站 H 出口開出') + '</div>' + tag + '</div><div style="min-width:110px">' + btn + '</div></div>';
}

async function claimShift(tm) {
  if (!driverData.plate) { showToast('請先設定車牌'); return; }
  const hhmm = tm.replace(':', '');
  if (!confirm('確認認領 ' + tm + ' 班次？')) return;
  try {
    const ref = db.ref('booking_seats/' + getToday() + '/' + hhmm);
    const result = await ref.transaction(current => {
      if (current && current.plate && current.plate !== driverData.plate) return;
      return {
        plate: driverData.plate,
        quota: 16,
        seats: 16,
        driverUid: currentUser.uid,
        driverName: currentUser.identifier,
        claimedAt: Date.now()
      };
    });
    if (result.committed) {
      showToast('✅ 已認領 ' + tm);
      if (voiceEnabled) speakCantonese('已認領 ' + tm + ' 班次');
    } else {
      const cur = result.snapshot.val();
      showToast('❌ 已被 ' + (cur && cur.plate ? cur.plate : '其他司機') + ' 認領');
    }
  } catch (e) { showToast('❌ ' + e.message); }
}

async function unclaimShift(tm) {
  if (!confirm('確定取消認領 ' + tm + '？')) return;
  try {
    const hhmm = tm.replace(':', '');
    const cur = await db.ref('booking_seats/' + getToday() + '/' + hhmm + '/plate').once('value');
    if (cur.val() !== driverData.plate) { showToast('❌ 車牌不符'); return; }
    await db.ref('booking_seats/' + getToday() + '/' + hhmm + '/plate').remove();
    showToast('已取消認領');
  } catch (e) { showToast('❌ ' + e.message); }
}

/* ============================================================
 * 二、座位圖
 * ============================================================ */
function renderSeatView() {
  const sel = document.getElementById('seat-shift-select');
  const view = document.getElementById('seat-view');
  if (!sel || !view) return;
  if (!driverData.plate) { sel.innerHTML = '<option>請先設定車牌</option>'; view.innerHTML = ''; return; }
  const myShifts = FIXED_SHIFTS.morning.concat(FIXED_SHIFTS.evening).filter(tm => {
    const c = claimsCache[tm.replace(':', '')];
    return c && c.plate === driverData.plate;
  });
  if (!myShifts.length) {
    sel.innerHTML = '<option value="">-- 你未認領任何班次 --</option>';
    view.innerHTML = '<div style="text-align:center;color:#a89b7a;padding:16px;font-size:14px">請先到「班次認領」認領班次</div>';
    return;
  }
  const cur = sel.value;
  sel.innerHTML = myShifts.map(tm => '<option value="' + tm + '"' + (tm === cur ? ' selected' : '') + '>' + tm + '</option>').join('');
  const tm = sel.value || myShifts[0];
  const sid = getSid(getToday(), tm);
  const items = Object.entries(bookingsCache)
    .filter(([k, b]) => b && b.scheduleId === sid && (b.status === 'pending' || b.status === 'reserved' || b.status === 'boarded'))
    .map(([k, b]) => Object.assign({}, b, { id: k }));
  const confirmed = items.filter(b => b.status === 'reserved' || b.status === 'boarded');
  const pending = items.filter(b => b.status === 'pending');
  const totalBooked = confirmed.reduce((s, b) => s + (b.seats || 1), 0);
  const remaining = 16 - totalBooked;
  let seats = [];
  let idx = 1;
  confirmed.forEach(b => {
    for (let i = 0; i < (b.seats || 1); i++) {
      if (idx <= 16) seats.push({ num: idx, name: b.passengerName, status: b.status });
      idx++;
    }
  });
  while (seats.length < 16) seats.push({ num: seats.length + 1, name: null, status: 'empty' });

  let h = '';
  h += '<div class="row" style="margin-bottom:12px">';
  h += '<div class="stat-box"><div class="label">班次</div><div class="value" style="font-size:16px">' + tm + '</div></div>';
  h += '<div class="stat-box"><div class="label">已留位</div><div class="value">' + totalBooked + '</div></div>';
  h += '<div class="stat-box"><div class="label">剩餘</div><div class="value" style="color:' + (remaining > 0 ? '#86efac' : '#fca5a5') + '">' + remaining + '</div></div>';
  h += '</div>';
  if (pending.length) {
    h += '<div style="background:rgba(251,191,36,.08);border-left:3px solid #fbbf24;padding:10px;border-radius:8px;margin-bottom:10px"><div style="font-size:14px;font-weight:700;color:#fbbf24">⏳ 有 ' + pending.length + ' 位待確認</div></div>';
    pending.forEach(b => {
      h += '<div class="pending-item"><div class="name">' + esc(b.passengerName) + ' (' + (b.seats || 1) + '位)</div>';
      h += '<div class="info">📞 ' + esc(b.passengerPhone) + '</div>';
      if (b.pickupLocation) h += '<div class="info" style="color:#22c55e">📍 ' + esc(b.pickupLocation) + '</div>';
      h += '<div class="actions">';
      h += '<button style="background:linear-gradient(135deg,#16a34a,#15803d)" onclick="confirmBooking(\'' + b.date + '\',\'' + b.id + '\')">✅ 確認</button>';
      h += '<button style="background:linear-gradient(135deg,#dc2626,#991b1b)" onclick="rejectBooking(\'' + b.date + '\',\'' + b.id + '\')">❌ 拒絕</button>';
      h += '</div></div>';
    });
  }
  h += '<div style="font-size:13px;color:#a89b7a;margin-top:6px">🚐 座位圖（' + totalBooked + ' / 16）</div>';
  h += '<div class="seat-grid">';
  seats.forEach(s => {
    if (s.status === 'empty') h += '<div class="seat empty"><div class="num">' + s.num + '</div><div style="font-size:9px">空</div></div>';
    else h += '<div class="seat taken"><div class="num">' + s.num + '</div><div class="nm">' + esc(s.name) + '</div></div>';
  });
  h += '</div>';
  view.innerHTML = h;
}

/* ============================================================
 * 三、循環線留位
 * ============================================================ */
function renderLoopBookings() {
  const c = document.getElementById('loop-bookings');
  if (!c) return;
  const lp = Object.entries(loopCache).filter(([k, x]) => x && x.status === 'pending');
  const lr = Object.entries(loopCache).filter(([k, x]) => x && x.status === 'reserved');
  const el = document.getElementById('loop-pending-count');
  if (el) el.textContent = lp.length + ' 待確認';
  let h = '';
  if (!lp.length && !lr.length) {
    c.innerHTML = '<div style="text-align:center;color:#a89b7a;padding:20px;font-size:14px">🔄 暫無循環線留位</div>';
    return;
  }
  if (lp.length) {
    h += '<div style="font-size:13px;font-weight:700;color:#7dd3fc;margin-bottom:8px">⏳ 待確認（' + lp.length + '）</div>';
    lp.forEach(([id, x]) => {
      h += '<div class="loop-pending">';
      h += '<div style="font-size:16px;font-weight:700;color:#fff">👤 ' + esc(x.name) + '</div>';
      h += '<div style="font-size:13px;color:#a89b7a;margin-top:4px">📞 ' + esc(x.phone) + '</div>';
      if (x.pickupLocation) h += '<div style="font-size:13px;color:#22c55e;margin-top:4px">📍 ' + esc(x.pickupLocation) + '</div>';
      h += '<div style="display:flex;gap:6px;margin-top:10px">';
      h += '<button style="flex:1;padding:12px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700" onclick="confirmLoop(\'' + id + '\')">✅ 確認</button>';
      h += '<button style="flex:1;padding:12px;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700" onclick="rejectLoop(\'' + id + '\')">❌ 拒絕</button>';
      h += '</div></div>';
    });
  }
  if (lr.length) {
    h += '<div style="font-size:13px;font-weight:700;color:#86efac;margin:10px 0 8px">✅ 已確認（' + lr.length + '）</div>';
    lr.forEach(([id, x]) => {
      h += '<div class="loop-item">';
      h += '<div style="font-size:15px;font-weight:700;color:#fff">👤 ' + esc(x.name) + '</div>';
      h += '<div style="font-size:13px;color:#a89b7a;margin-top:4px">📞 ' + esc(x.phone) + '</div>';
      if (x.pickupLocation) h += '<div style="font-size:13px;color:#22c55e;margin-top:4px">📍 ' + esc(x.pickupLocation) + '</div>';
      if (x.confirmedBy) h += '<div style="font-size:13px;color:#ffd700;margin-top:4px;font-weight:700">🚐 車牌：' + esc(x.confirmedBy) + '</div>';
      h += '</div>';
    });
  }
  c.innerHTML = h;
}

/* ============================================================
 * 四、留位監聽
 * ============================================================ */
function startBookingListener() {
  const t = getToday();
  if (bookingListenerRef) { try { bookingListenerRef.off(); } catch (e) {} }
  if (loopListenerRef) { try { loopListenerRef.off(); } catch (e) {} }

  bookingListenerRef = db.ref('booking/' + t);
  bookingListenerRef.on('value', snap => {
    const ab = snap.val() || {};
    let newPending = 0;
    const newIds = [];
    Object.keys(ab).forEach(k => {
      const b = ab[k];
      if (b && b.status === 'pending' && !notifiedBookingIds.has('pending_' + k)) {
        newPending++;
        newIds.push(k);
      }
    });
    if (newPending > 0) {
      newIds.forEach(k => notifiedBookingIds.add('pending_' + k));
      if (typeof showBookingNotif === 'function') {
        showBookingNotif('🔔 有 ' + newPending + ' 位乘客留位！', newPending);
      } else if (typeof showToast === 'function') {
        showToast('🔔 有 ' + newPending + ' 位乘客留位！');
      }
      playAlertSound();
      if (voiceEnabled) speakCantonese('有 ' + newPending + ' 位乘客留位');
    }
    bookingsCache = ab;
    renderSeatView();
  });

  loopListenerRef = db.ref('booking_loop/' + t);
  loopListenerRef.on('value', snap => {
    const ab = snap.val() || {};
    let newLoopPending = 0;
    const newIds = [];
    Object.keys(ab).forEach(k => {
      const b = ab[k];
      if (b && b.status === 'pending' && !notifiedLoopIds.has(k)) {
        newLoopPending++;
        newIds.push(k);
      }
    });
    if (newLoopPending > 0) {
      newIds.forEach(k => notifiedLoopIds.add(k));
      if (typeof showBookingNotif === 'function') {
        showBookingNotif('🔄 有 ' + newLoopPending + ' 位循環線留位！', newLoopPending);
      } else if (typeof showToast === 'function') {
        showToast('🔄 有 ' + newLoopPending + ' 位循環線留位！');
      }
      playAlertSound();
      if (voiceEnabled) speakCantonese('有 ' + newLoopPending + ' 位循環線留位');
    }
    loopCache = ab;
    renderLoopBookings();
  });
}

/* ---------- 通知聲音 ---------- */
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.35;
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.2);
    };
    beep(880, 0);
    beep(1320, 0.26);
    beep(880, 0.52);
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([300, 100, 300]); } catch (e) {}
}

/* ============================================================
 * 五、確認 / 拒絕留位（座位自動扣減 + 滿座防護）
 * ============================================================ */
async function confirmBooking(date, id) {
  if (!id || id === 'undefined') { showToast('❌ 無效嘅預訂 ID'); return; }
  try {
    const snap = await db.ref('booking/' + date + '/' + id).once('value');
    const b = snap.val();
    if (!b) { showToast('❌ 預訂唔存在'); return; }

    /* 滿座檢查：用 booking_seats 嘅剩餘座位做 transaction */
    const tm = b.time;
    const hhmm = tm.replace(':', '');
    const seatsRef = db.ref('booking_seats/' + date + '/' + hhmm + '/seats');
    const seatsTx = await seatsRef.transaction(cur => {
      const c = cur == null ? 16 : cur;
      if (c - (b.seats || 1) < 0) return; // abort
      return c - (b.seats || 1);
    });
    if (!seatsTx.committed) {
      showToast('❌ 剩餘座位不足，無法確認');
      return;
    }

    await db.ref('booking/' + date + '/' + id).update({
      status: 'reserved',
      confirmedAt: Date.now(),
      confirmedBy: driverData.plate || currentUser.identifier
    });
    if (driverData.plate) {
      await db.ref('van/active_buses/' + driverData.plate + '/passengerCount').transaction(c => {
        return (c || 0) + (b.seats || 1);
      });
    }
    showToast('✅ 已確認留位，座位 +' + (b.seats || 1));
    if (voiceEnabled) speakCantonese(VOICE_TEXTS.bookingConfirmed);
  } catch (e) {
    console.error('❌ confirmBooking:', e);
    showToast('❌ 確認失敗：' + e.message);
  }
}

async function rejectBooking(date, id) {
  if (!confirm('確定拒絕？')) return;
  try {
    const snap = await db.ref('booking/' + date + '/' + id).once('value');
    const b = snap.val();
    if (!b) return;
    await db.ref('booking/' + date + '/' + id).update({ status: 'rejected', rejectedAt: Date.now() });
    if (b.status === 'reserved' && b.confirmedBy) {
      await db.ref('van/active_buses/' + b.confirmedBy + '/passengerCount').transaction(c => Math.max(0, (c || 0) - (b.seats || 1)));
    }
    // 回退座位
    if (b.status === 'reserved' && b.time) {
      const hhmm = b.time.replace(':', '');
      await db.ref('booking_seats/' + date + '/' + hhmm + '/seats').transaction(c => {
        const cur = c == null ? 16 : c;
        return Math.min(16, cur + (b.seats || 1));
      });
    }
    showToast('已拒絕');
  } catch (e) { showToast('❌ ' + e.message); }
}

async function confirmLoop(id) {
  try {
    await db.ref('booking_loop/' + getToday() + '/' + id).update({
      status: 'reserved',
      confirmedAt: Date.now(),
      confirmedBy: driverData.plate || currentUser.identifier
    });
    if (driverData.plate) {
      await db.ref('van/active_buses/' + driverData.plate + '/passengerCount').transaction(c => (c || 0) + 1);
    }
    showToast('✅ 循環線已確認，座位 +1');
    if (voiceEnabled) speakCantonese('循環線留位已確認');
  } catch (e) { showToast('❌ ' + e.message); }
}

async function rejectLoop(id) {
  if (!confirm('確定拒絕？')) return;
  try {
    const snap = await db.ref('booking_loop/' + getToday() + '/' + id).once('value');
    const b = snap.val();
    if (!b) return;
    await db.ref('booking_loop/' + getToday() + '/' + id).update({ status: 'rejected', rejectedAt: Date.now() });
    if (b.status === 'reserved' && b.confirmedBy) {
      await db.ref('van/active_buses/' + b.confirmedBy + '/passengerCount').transaction(c => Math.max(0, (c || 0) - 1));
    }
    showToast('已拒絕');
  } catch (e) { showToast('❌ ' + e.message); }
}

/* ============================================================
 * 六、自動 No-show 清理（每 5 分鐘）
 * ============================================================ */
async function autoCleanNoShow() {
  try {
    const t = getToday();
    const snap = await db.ref('booking/' + t).once('value');
    const all = snap.val() || {};
    for (const id in all) {
      const b = all[id];
      if (!b || b.status !== 'reserved') continue;
      const shiftTime = getShiftTimestamp(t, b.time);
      if (Date.now() > shiftTime + (CONFIG.NO_SHOW_MINUTES || 15) * 60 * 1000) {
        await db.ref('booking/' + t + '/' + id).update({ status: 'no-show', noShowAt: Date.now() });
        if (b.confirmedBy) {
          await db.ref('van/active_buses/' + b.confirmedBy + '/passengerCount').transaction(c => Math.max(0, (c || 0) - (b.seats || 1)));
        }
        const hhmm = b.time.replace(':', '');
        await db.ref('booking_seats/' + t + '/' + hhmm + '/seats').transaction(c => {
          const cur = c == null ? 16 : c;
          return Math.min(16, cur + (b.seats || 1));
        });
      }
    }
  } catch (e) { console.warn('自動清理失敗:', e); }
}

/* ============================================================
 * 七、初始化留位系統（只初始化一次）
 * ============================================================ */
function initBookings() {
  if (_bookingsInited) return;
  _bookingsInited = true;
  loadShiftClaims();
  startBookingListener();
  setInterval(autoCleanNoShow, 5 * 60 * 1000);
  setTimeout(autoCleanNoShow, 3000);
}

/* ---------- 全域暴露 ---------- */
window.confirmBooking = confirmBooking;
window.rejectBooking = rejectBooking;
window.confirmLoop = confirmLoop;
window.rejectLoop = rejectLoop;
window.claimShift = claimShift;
window.unclaimShift = unclaimShift;
window.renderSeatView = renderSeatView;
window.renderLoopBookings = renderLoopBookings;