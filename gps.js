/* ============================================================
 * gps.js — GPS 定位與自動報站模組
 * 負責：GPS 監聽、距離計算、自動觸發報站、手動上下站、屏幕鎖
 * ============================================================ */

let gpsWatchId = null;
let gpsFirstFix = false;
let gpsRetryTimer = null;
let gpsRetryCount = 0;
let gpsRestartNeeded = false;
let lastPos = null;
let lastPosTime = 0;
let lastReportedIndex = -1;
let lastReportedTime = 0;
let positionBuffer = [];
let lastDriverScrollIndex = -1;

/* ---------- 屏幕鎖（強健版） ---------- */
let wakeLockSentinel = null;
let wakeLockRetryInterval = null;

async function requestWakeLock() {
  if (wakeLockSentinel) return true;
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      const el = document.getElementById('wake-lock-status');
      if (el) { el.textContent = '🔋 屏幕鎖: 已啟用 ✅'; el.classList.add('active'); }
      console.log('✅ 屏幕鎖已啟用');
      wakeLockSentinel.addEventListener('release', () => {
        console.log('⚠️ 屏幕鎖被釋放');
        wakeLockSentinel = null;
        const el2 = document.getElementById('wake-lock-status');
        if (el2) { el2.textContent = '🔋 屏幕鎖: 已釋放，重試中…'; el2.classList.remove('active'); }
        if (document.visibilityState === 'visible' && driverData.isActive) {
          setTimeout(requestWakeLock, 1000);
        }
      });
      return true;
    } else {
      const el = document.getElementById('wake-lock-status');
      if (el) el.textContent = '🔋 屏幕鎖: 不支援';
      return false;
    }
  } catch (err) {
    console.error('❌ 請求屏幕鎖失敗:', err);
    if (!wakeLockRetryInterval) {
      wakeLockRetryInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && driverData.isActive && !wakeLockSentinel) {
          requestWakeLock();
        }
      }, CONFIG.WAKE_LOCK_RETRY_MS);
    }
    return false;
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLockSentinel) { await wakeLockSentinel.release(); wakeLockSentinel = null; }
    if (wakeLockRetryInterval) { clearInterval(wakeLockRetryInterval); wakeLockRetryInterval = null; }
  } catch (e) {}
  const el = document.getElementById('wake-lock-status');
  if (el) { el.textContent = '🔋 屏幕鎖: 未啟用'; el.classList.remove('active'); }
}

/* ---------- 頁面可見性監聽 ---------- */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && driverData.isActive) {
    if (!wakeLockSentinel) requestWakeLock();
    if (!gpsWatchId || gpsRestartNeeded) {
      gpsRestartNeeded = false;
      if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
      startGpsWatch();
    }
  }
});

/* ---------- 距離計算 ---------- */
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ---------- 啟動 GPS ---------- */
function startGpsWatch() {
  if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  if (gpsRetryTimer) { clearTimeout(gpsRetryTimer); gpsRetryTimer = null; }
  console.log('📍 開始 GPS 監聽');
  const statusEl = document.getElementById('d-gps-status');
  const debugEl = document.getElementById('gps-debug');
  if (statusEl) statusEl.textContent = '📍 GPS 定位中⋯';
  if (debugEl) { debugEl.style.display = 'block'; debugEl.textContent = '⏳ 等待衛星信號⋯'; }
  let firstFix = false;
  gpsFirstFix = false;
  lastPos = null; lastPosTime = 0; positionBuffer = [];

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (pos.coords.accuracy > CONFIG.GPS_ACCURACY_THRESHOLD) {
        if (debugEl) debugEl.textContent = `⚠️ 精度不足 (${Math.round(pos.coords.accuracy)}m)`;
        return;
      }
      if (!firstFix) {
        firstFix = true; gpsFirstFix = true; gpsRetryCount = 0;
        console.log('✅ GPS 首次定位成功');
        if (typeof showToast === 'function') showToast('GPS 已定位');
        if (statusEl) statusEl.textContent = '📍 GPS 已定位';
        if (gpsRetryTimer) { clearTimeout(gpsRetryTimer); gpsRetryTimer = null; }
      }
      if (!driverData.isActive || !driverData.plate) return;
      const now = Date.now();
      positionBuffer.push({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (positionBuffer.length > CONFIG.SMOOTHING_WINDOW) positionBuffer.shift();
      let avgLat = 0, avgLng = 0;
      positionBuffer.forEach(p => { avgLat += p.lat; avgLng += p.lng; });
      avgLat /= positionBuffer.length;
      avgLng /= positionBuffer.length;
      let speed = 0;
      if (lastPos) {
        const dt = (now - lastPosTime) / 1000;
        if (dt > 0) {
          const dist = calcDistance(lastPos.lat, lastPos.lng, pos.coords.latitude, pos.coords.longitude);
          speed = dist / dt;
        }
      }
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastPosTime = now;
      const coords = getCoords();
      const route = getRoute();
      if (!coords || !coords.length) return;
      let minDist = Infinity, nearestIdx = 0;
      for (let i = 0; i < coords.length; i++) {
        const d = calcDistance(avgLat, avgLng, coords[i].lat, coords[i].lng);
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }
      if (debugEl) debugEl.textContent = `📍 ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)} | 精確度 ${Math.round(pos.coords.accuracy)}m | 最近站: ${route[nearestIdx]} (${Math.round(minDist)}m) | 速度: ${speed.toFixed(1)}m/s`;
      if (statusEl) statusEl.textContent = `📍 ${route[nearestIdx]} (${Math.round(minDist)}m) · ${speed.toFixed(1)}m/s`;

      if (minDist < CONFIG.TRIGGER_DISTANCE && nearestIdx > lastReportedIndex) {
        if (speed < CONFIG.MIN_SPEED_FOR_TRIGGER) return;
        lastReportedIndex = nearestIdx;
        lastReportedTime = now;
        driverData.stationIndex = nearestIdx;
        updateDriverDB();
        renderDriverRouteStrip();
        const stationName = route[nearestIdx];
        const nextIdx = nearestIdx + 1;
        let nextStationName = (nextIdx < route.length) ? route[nextIdx] : null;
        if (voiceEnabled) {
          if (nextStationName) speakWithDelay(VOICE_TEXTS.arrived + stationName, VOICE_TEXTS.nextStation + nextStationName);
          else speakCantonese(VOICE_TEXTS.arrived + stationName).then(() => setTimeout(() => speakCantonese(VOICE_TEXTS.lastStation), 2000));
        }
        if (nearestIdx === route.length - 1 && driverData.isActive) {
          setTimeout(() => {
            if (!driverData.isActive) return;
            driverData.direction = driverData.direction === 0 ? 1 : 0;
            driverData.stationIndex = 0;
            driverData.passengerCount = 0;
            driverData.isFull = false;
            lastReportedIndex = -1;
            lastDriverScrollIndex = -1;
            updateDriverDB();
            renderDriverRouteStrip();
            if (typeof showToast === 'function') showToast('🔄 已到總站，自動掉頭');
            if (voiceEnabled) {
              const newRoute = getRoute();
              if (newRoute.length > 1) setTimeout(() => speakCantonese(VOICE_TEXTS.nextStation + newRoute[1]), 500);
            }
          }, 3000);
        }
      }
    },
    (err) => {
      console.error('❌ GPS 錯誤:', err);
      if (statusEl) statusEl.textContent = '📍 GPS 定位失敗，請檢查權限';
      if (debugEl) debugEl.textContent = `⚠️ 錯誤: ${err.message}`;
      if (err.code === 3 || err.code === 1) {
        if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
        setTimeout(() => { if (driverData.isActive) startGpsWatch(); }, CONFIG.GPS_RETRY_DELAY);
      }
    },
    { enableHighAccuracy: true, timeout: CONFIG.GPS_TIMEOUT, maximumAge: 0 }
  );

  gpsRetryTimer = setTimeout(() => {
    if (!gpsFirstFix && driverData.isActive) {
      if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
      startGpsWatch();
    }
  }, 10000);
}

/* ---------- 手動下一站 ---------- */
async function goToNextStation() {
  if (!driverData.isActive) { if (typeof showToast === 'function') showToast('請先開始當值'); return; }
  const route = getRoute();
  if (driverData.stationIndex < route.length - 1) {
    driverData.stationIndex++;
  } else {
    driverData.direction = driverData.direction === 0 ? 1 : 0;
    driverData.stationIndex = 0;
    driverData.passengerCount = 0; driverData.isFull = false;
    lastReportedIndex = -1; lastDriverScrollIndex = -1;
    if (typeof showToast === 'function') showToast('🔄 已到總站，調頭清客');
    if (voiceEnabled) speakCantonese(VOICE_TEXTS.arrivedTerminus);
    updateDriverDB(); renderDriverRouteStrip(); return;
  }
  lastReportedIndex = driverData.stationIndex; lastReportedTime = Date.now();
  updateDriverDB(); renderDriverRouteStrip();
  const newRoute = getRoute();
  const currentStation = newRoute[driverData.stationIndex];
  const nextIdx = driverData.stationIndex + 1;
  let nextStationName = (nextIdx < newRoute.length) ? newRoute[nextIdx] : null;
  if (voiceEnabled) {
    if (nextStationName) await speakWithDelay(VOICE_TEXTS.arrived + currentStation, VOICE_TEXTS.nextStation + nextStationName);
    else { await speakCantonese(VOICE_TEXTS.arrived + currentStation); setTimeout(() => speakCantonese(VOICE_TEXTS.lastStation), 2000); }
  }
}

/* ---------- 手動上一站 ---------- */
async function goToPrevStation() {
  if (!driverData.isActive) { if (typeof showToast === 'function') showToast('請先開始當值'); return; }
  if (driverData.stationIndex > 0) {
    driverData.stationIndex--;
  } else {
    driverData.direction = driverData.direction === 0 ? 1 : 0;
    const newRoute = getRoute();
    driverData.stationIndex = newRoute.length - 1;
    lastReportedIndex = -1; lastDriverScrollIndex = -1;
    if (typeof showToast === 'function') showToast('🔄 已調頭至總站');
    if (voiceEnabled) speakCantonese(VOICE_TEXTS.turnAround);
    updateDriverDB(); renderDriverRouteStrip(); return;
  }
  lastReportedIndex = driverData.stationIndex; lastReportedTime = Date.now();
  updateDriverDB(); renderDriverRouteStrip();
  const newRoute = getRoute();
  const currentStation = newRoute[driverData.stationIndex];
  const nextIdx = driverData.stationIndex + 1;
  let nextStationName = (nextIdx < newRoute.length) ? newRoute[nextIdx] : null;
  if (voiceEnabled) {
    if (nextStationName) await speakWithDelay(VOICE_TEXTS.arrived + currentStation, VOICE_TEXTS.nextStation + nextStationName);
    else { await speakCantonese(VOICE_TEXTS.arrived + currentStation); setTimeout(() => speakCantonese(VOICE_TEXTS.lastStation), 2000); }
  }
}