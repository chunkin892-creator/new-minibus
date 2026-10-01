/* ============================================================
 * messages.js — 訊息系統模組
 * ============================================================ */

let notificationTimer = null;

function showMsgNotification(type, sender, text) {
  const el = document.getElementById('msg-notification');
  const icon = document.getElementById('notif-icon');
  const title = document.getElementById('notif-title2');
  const sub = document.getElementById('notif-sub');
  if (!el) return;
  if (notificationTimer) { clearTimeout(notificationTimer); notificationTimer = null; }
  if (type === 'audio') {
    if (icon) icon.textContent = '🎤';
    if (title) title.textContent = '新語音訊息';
    if (sub) sub.textContent = `來自 ${sender || '乘客'}`;
  } else {
    if (icon) icon.textContent = '📩';
    if (title) title.textContent = text ? text.substring(0, 30) + (text.length > 30 ? '...' : '') : '新訊息';
    if (sub) sub.textContent = `來自 ${sender || '乘客'}`;
  }
  el.classList.add('show');
  notificationTimer = setTimeout(() => { el.classList.remove('show'); notificationTimer = null; }, 3500);
}

function initMsgNotification() {
  const btn = document.getElementById('notif-close');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const el = document.getElementById('msg-notification');
    if (el) el.classList.remove('show');
    if (notificationTimer) { clearTimeout(notificationTimer); notificationTimer = null; }
  });
}

function sendDriverMsg(inputId) {
  const input = document.getElementById(inputId);
  const text = input ? input.value.trim() : '';
  if (!text || !driverData.plate) {
    if (typeof showToast === 'function') showToast('請先設定車牌或輸入內容');
    return;
  }
  db.ref('van/messages').push({
    busId: driverData.plate, senderUid: currentUser.uid, senderIdentifier: currentUser.identifier,
    text: text, timestamp: Date.now(), type: 'text'
  }).then(() => {
    input.value = '';
    if (typeof showToast === 'function') showToast('已發送訊息');
    if (voiceEnabled && typeof speakCantonese === 'function') speakCantonese('訊息已發送');
  });
}
