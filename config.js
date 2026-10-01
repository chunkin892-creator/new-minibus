/* ============================================================
 * config.js — 全局配置
 * ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAX7Zy5br1ozGOGxHvDeFNY-Ldcjjw8Qgc",
  authDomain: "triple-login-version.firebaseapp.com",
  databaseURL: "https://triple-login-version-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "triple-login-version",
  storageBucket: "triple-login-version.firebasestorage.app",
  messagingSenderId: "66459706459",
  appId: "1:66459706459:web:28f99a455652f393da0b7e"
};

const CONFIG = {
  TRIGGER_DISTANCE: 100,
  GPS_TIMEOUT: 20000,
  GPS_ACCURACY_THRESHOLD: 50,
  GPS_RETRY_DELAY: 5000,
  MIN_SPEED_FOR_TRIGGER: 1.0,
  SMOOTHING_WINDOW: 3,
  VOICE_BITRATE: 24000,
  RECORD_MAX_SECONDS: 30,
  ACTIVE_BUS_TIMEOUT: 300000,
  MESSAGE_LIMIT: 100,
  NO_SHOW_MINUTES: 15,
  WAKE_LOCK_RETRY_MS: 10000
};

const SUPER_ADMIN_EMAILS = [
  'cheungyiufai1810@gmail.com',
  'hujiaboy@gmail.com',
  'chunkin892@gmail.com',
  'zhangyaohuifai@gmail.com',
  'cheungyiufai01@gmail.com'
];

const FIXED_SHIFTS = {
  morning: ['06:20','06:30','06:40','06:50'],
  evening: ['18:15','18:30','18:45','19:00','19:15','19:30','19:45','20:00','20:20']
};

const VOICE_TEXTS = {
  startDuty: '開始當值',
  stopDuty: '已停止當值',
  arrived: '到達 ',
  nextStation: '下一站 ',
  lastStation: '已到達總站',
  turnAround: '已調頭',
  arrivedTerminus: '已到達總站，清客完畢，現已調頭',
  welcomeAdmin: '管理員登入成功',
  welcomeDriver: '司機登入成功',
  welcomePassenger: '乘客登入成功',
  loggedOut: '已登出，下次見',
  permissionDenied: '權限不足',
  passengerPage: '乘客頁面',
  driverPage: '司機頁面',
  adminPage: '管理後台',
  backToLobby: '返回大堂',
  backToList: '返回列表',
  sent: '已發送',
  announce: '自動報站已開啟',
  announceOff: '自動報站已關閉',
  modeBusy: '西鐵快線',
  modeNormal: '市中心循環線',
  switchedTo: '已切換至 ',
  carPlateSet: '車牌已設定',
  bookingConfirmed: '留位已確認',
  newBooking: '有新的乘客留位',
  bookingSuccess: '留位成功'
};
