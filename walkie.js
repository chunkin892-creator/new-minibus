let walkieListenerRef = null;

function updateWalkieTargets() {
  const sel = document.getElementById('walkie-target');
  if (!sel) return;
  db.ref('van/active_buses').once('value', snap => {
    const data = snap.val() || {};
    let options = '<option value="all">📢 全部司機</option>';
    const now = Date.now();
    for (const plate in data) {
      if (now - data[plate].lastUpdate < (CONFIG.ACTIVE_BUS_TIMEOUT || 300000)) {
        if (!driverData.plate || plate !== driverData.plate) {
          options += `<option value="${plate}">🚐 ${plate}</option>`;
        }
      }
    }
    sel.innerHTML = options;
    if (typeof showToast === 'function') showToast('已刷新對講機目標');
  });
}
window.updateWalkieTargets = updateWalkieTargets;

function updateAdminWalkieTargets() {
  const sel = document.getElementById('admin-walkie-target');
  if (!sel) return;
  db.ref('van/active_buses').once('value', snap => {
    const data = snap.val() || {};
    let options = '<option value="all">📢 全部司機</option>';
    const now = Date.now();
    for (const plate in data) {
      if (now - data[plate].lastUpdate < (CONFIG.ACTIVE_BUS_TIMEOUT || 300000)) {
        options += `<option value="${plate}">🚐 ${plate}</option>`;
      }
    }
    sel.innerHTML = options;
  });
}
window.updateAdminWalkieTargets = updateAdminWalkieTargets;

function initWalkieTalkie() {
  if (walkieListenerRef) { try { walkieListenerRef.off(); } catch (e) {} }
  walkieListenerRef = db.ref('van/walkie_talkie').orderByChild('timestamp').limitToLast(20);
  walkieListenerRef.on('value', snap => {
    const container = document.getElementById('walkie-messages');
    if (!container) return;
    const items = [];
    snap.forEach(child => {
      const val = child.val();
      if (!val) return;
      if (val.target === 'all' || val.target === driverData.plate || val.senderPlate === driverData.plate) {
        items.push({ key: child.key, data: val });
      }
    });
    items.sort((a, b) => b.data.timestamp - a.data.timestamp);
    let html = '';
    items.forEach(it => {
      const d = it.data;
      const time = new Date(d.timestamp).toLocaleTimeString('zh-HK');
      const isMine = d.senderPlate === driverData.plate;
      html += `<div style="padding:6px 0;border-bottom:1px solid rgba(212,175,55,.2);font-size:13px;display:flex;align-items:center;justify-content:space-between;">`;
      html += `<div><span style="color:#a89b7a;">[${time}]</span> <b style="color:${isMine ? '#86efac' : '#ffd700'}">${esc(d.senderPlate || d.senderIdentifier)}</b>: 🎙️ 語音訊息</div>`;
      html += `<button class="play-audio" onclick="playBoostedAudio('${d.audio}', 8)">▶ 播放</button>`;
      html += `</div>`;
    });
    container.innerHTML = html || '<div style="color:#a89b7a;text-align:center;padding:10px;">暫無對講訊息</div>';
  });
}
window.initWalkieTalkie = initWalkieTalkie;

function initAdminWalkie() {
  db.ref('van/walkie_talkie').orderByChild('timestamp').limitToLast(20).on('value', snap => {
    const container = document.getElementById('admin-walkie-messages');
    if (!container) return;
    const items = [];
    snap.forEach(child => items.push({ key: child.key, data: child.val() }));
    items.sort((a, b) => b.data.timestamp - a.data.timestamp);
    let html = '';
    items.forEach(it => {
      const d = it.data;
      const time = new Date(d.timestamp).toLocaleTimeString('zh-HK');
      html += `<div class="item">`;
      html += `<div style="font-size:12px;color:#a89b7a;">[${time}] ${esc(d.senderPlate || d.senderIdentifier)} ➔ ${esc(d.target)}</div>`;
      html += `<button class="play-audio" onclick="playBoostedAudio('${d.audio}', 8)">▶ 播放</button>`;
      html += ` <button class="btn btn-danger btn-sm" onclick="adminDeleteWalkie('${it.key}')">🗑️ 刪除</button>`;
      html += `</div>`;
    });
    container.innerHTML = html || '<div class="item">暫無對講記錄</div>';
  });
}
window.initAdminWalkie = initAdminWalkie;
