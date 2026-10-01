/* ============================================================
 * messages.js — 訊息系統模組
 * 負責：訊息顯示、隱藏、還原、通知氣泡
 * ============================================================ */

let notificationTimer = null;
let driverMsgScrollTimer = null;

function showMsgNotification(type, sender, text) {
  const el = document.getElementById('msg-notification');
  const icon = document.getElementById('notif-icon');
  const title = document.getElementById('notif-title');
  const sub = document.getElementById('notif-sub');
  if (!el) return;
  if (notificationTimer) { clearTimeout(notificationTimer); notificationTimer = null; }
  if (type === 'audio') {
    icon.textContent = '🎤'; title.textContent = '新語音訊息'; sub.textContent = `來自 ${sender || '乘客'}`;
  } else {
    icon.textContent = '📩';
    title.textContent = text ? text.substring(0, 30) + (text.length > 30 ? '...' : '') : '新訊息';
    sub.textContent = `來自 ${sender || '乘客'}`;
  }
  el.classList.add('show');
  notificationTimer = setTimeout(() => { el.classList.remove('show'); notificationTimer = null; }, 3500);
}

function initMsgNotification() {
  const btn = document.getElementById('notif-close');
  if (!btn) return;
  btn.addEventListener('click', function () {
    document.getElementById('msg-notification').classList.remove('show');
    if (notificationTimer) { clearTimeout(notificationTimer); notificationTimer = null; }
  });
}

function sendDriverMsg(inputId) {
  const input = document.getElementById(inputId);
  const text = input?.value.trim();
  if (!text || !driverData.plate) return;
  db.ref('van/messages').push({
    busId: driverData.plate, senderUid: currentUser.uid, senderIdentifier: currentUser.identifier,
    text: text, timestamp: Date.now(), type: 'text'
  }).then(() => {
    input.value = '';
    if (typeof showToast === 'function') showToast('已廣播');
    if (voiceEnabled) speakCantonese('廣播已發送');
  });
}

function clearDriverMsgs(restoreBtnId) {
  if (!confirm('確定隱藏所有訊息？可還原。')) return;
  db.ref('van/messages').orderByChild('busId').equalTo(driverData.plate).once('value', snap => {
    const updates = {};
    snap.forEach(child => { updates[child.key + '/hidden'] = true; });
    db.ref('van/messages').update(updates).then(() => {
      if (typeof showToast === 'function') showToast('已隱藏所有訊息');
      document.getElementById(restoreBtnId).style.display = 'block';
    });
  });
}

function restoreDriverMsgs(restoreBtnId) {
  if (!confirm('確定還原所有隱藏訊息？')) return;
  db.ref('van/messages').orderByChild('busId').equalTo(driverData.plate).once('value', snap => {
    const updates = {};
    snap.forEach(child => { if (child.val().hidden) updates[child.key + '/hidden'] = false; });
    db.ref('van/messages').update(updates).then(() => {
      if (typeof showToast === 'function') showToast('已還原所有訊息');
      document.getElementById(restoreBtnId).style.display = 'none';
    });
  });
}