/* ============================================================
 * walkie.js — 對講機模組
 * 負責：司機對講機、管理員對講機
 * ============================================================ */

let walkieRef = null;
let adminWalkieRef = null;

function initWalkieTalkie() {
  if (!driverData.plate) return;
  updateWalkieTargets();
  if (walkieRef) walkieRef.off();
  walkieRef = db.ref('van/walkie_talkie').orderByChild('timestamp').limitToLast(50);
  walkieRef.on('value', async snap => {
    const container = document.getElementById('walkie-messages');
    if (!container) return;
    container.innerHTML = '';
    const banned = await isBanned(currentUser.uid);
    const items = [];
    snap.forEach(child => {
      const msg = child.val();
      if (msg.hidden || banned) return;
      if (msg.target === 'all' || msg.target === driverData.plate || msg.senderPlate === driverData.plate) {
        items.push({ key: child.key, msg });
      }
    });
    items.sort((a, b) => b.msg.timestamp - a.msg.timestamp);
    items.forEach(item => {
      const msg = item.msg;
      const div = document.createElement('div');
      div.style.cssText = 'padding:4px 0;border-bottom:1px solid #333;font-size:14px;';
      const time = new Date(msg.timestamp).toLocaleTimeString('zh-HK');
      const sender = msg.senderPlate || '未知司機';
      const spanTime = document.createElement('span');
      spanTime.style.color = '#888';
      spanTime.textContent = `[${time}] `;
      div.appendChild(spanTime);
      const strong = document.createElement('strong');
      strong.textContent = sender + ': ';
      div.appendChild(strong);
      if (msg.audio) {
        const btn = document.createElement('button');
        btn.className = 'play-audio';
        btn.textContent = '▶ 語音';
        btn.addEventListener('click', () => playBoostedAudio(msg.audio, 10));
        div.appendChild(btn);
      } else {
        const txt = document.createTextNode(msg.text || '');
        div.appendChild(txt);
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-secondary';
      delBtn.style.cssText = 'width:auto;padding:4px 10px;font-size:13px;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => {
        if (confirm('確定刪除此對講機訊息？')) db.ref('van/walkie_talkie/' + item.key).remove().then(() => {
          if (typeof showToast === 'function') showToast('已刪除');
        });
      });
      div.appendChild(delBtn);
      container.appendChild(div);
    });
    if (container.children.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#888;font-size:14px;text-align:center;padding:12px;';
      empty.textContent = '暫無對講機訊息';
      container.appendChild(empty);
    }
    if (items.length > 0) container.scrollTop = container.scrollHeight;
  });
}

function updateWalkieTargets() {
  const select = document.getElementById('walkie-target');
  if (!select) return;
  db.ref('van/active_buses').once('value', snap => {
    const data = snap.val() || {};
    let html = '<option value="all">📢 全部司機</option>';
    for (const plate in data) {
      if (plate !== driverData.plate && Date.now() - data[plate].lastUpdate < CONFIG.ACTIVE_BUS_TIMEOUT) {
        html += `<option value="${plate}">🚐 ${plate}</option>`;
      }
    }
    select.innerHTML = html;
    const display = document.getElementById('walkie-target-display');
    if (display) display.textContent = '廣播給：全部司機';
    select.addEventListener('change', function () {
      if (display) display.textContent = this.value === 'all' ? '廣播給：全部司機' : '廣播給：' + this.value;
    });
  });
}

function initAdminWalkie() {
  if (!isAdmin) return;
  try {
    updateAdminWalkieTargets();
    if (adminWalkieRef) adminWalkieRef.off();
    adminWalkieRef = db.ref('van/walkie_talkie').orderByChild('timestamp').limitToLast(50);
    adminWalkieRef.on('value', snap => {
      try {
        const container = document.getElementById('admin-walkie-messages');
        if (!container) return;
        container.innerHTML = '';
        snap.forEach(child => {
          const msg = child.val();
          if (msg.hidden) return;
          const time = new Date(msg.timestamp).toLocaleTimeString('zh-HK');
          const sender = msg.senderPlate || '未知司機';
          const target = msg.target === 'all' ? '📢全部' : msg.target;
          const div = document.createElement('div');
          div.style.cssText = 'padding:4px 0;border-bottom:1px solid #333;font-size:14px;';
          const spanTime = document.createElement('span');
          spanTime.style.color = '#888';
          spanTime.textContent = `[${time}] `;
          div.appendChild(spanTime);
          const strong = document.createElement('strong');
          strong.textContent = sender + ' → ' + target + ': ';
          div.appendChild(strong);
          if (msg.audio) {
            const btn = document.createElement('button');
            btn.className = 'play-audio';
            btn.textContent = '▶ 語音';
            btn.addEventListener('click', () => playBoostedAudio(msg.audio, 10));
            div.appendChild(btn);
          } else {
            const txt = document.createTextNode(msg.text || '');
            div.appendChild(txt);
          }
          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-secondary';
          delBtn.style.cssText = 'width:auto;padding:4px 10px;font-size:13px;';
          delBtn.textContent = '🗑️';
          delBtn.addEventListener('click', () => {
            if (confirm('管理員刪除此對講機訊息？')) {
              db.ref('van/walkie_talkie/' + child.key).remove().then(() => {
                if (typeof showToast === 'function') showToast('已刪除');
              });
            }
          });
          div.appendChild(delBtn);
          container.appendChild(div);
        });
        if (container.children.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:#888;font-size:14px;text-align:center;padding:12px;';
          empty.textContent = '暫無對講機訊息';
          container.appendChild(empty);
        }
      } catch (e) { console.error('渲染管理員對講機失敗:', e); }
    });
  } catch (e) { console.error('initAdminWalkie 失敗:', e); }
}

function updateAdminWalkieTargets() {
  const select = document.getElementById('admin-walkie-target');
  if (!select) return;
  db.ref('van/active_buses').once('value', snap => {
    const data = snap.val() || {};
    let html = '<option value="all">📢 全部司機</option>';
    for (const plate in data) {
      if (Date.now() - data[plate].lastUpdate < CONFIG.ACTIVE_BUS_TIMEOUT) {
        html += `<option value="${plate}">🚐 ${plate}</option>`;
      }
    }
    select.innerHTML = html;
  });
}