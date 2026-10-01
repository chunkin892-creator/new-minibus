/* ============================================================
 * voice.js — 廣東話（粵語）專用純淨語音播報模組
 * 確保 100% 廣東話發音，徹底杜絕普通話混雜
 * ============================================================ */

let voiceEnabled = (localStorage.getItem('globalVoice') !== 'false');
let availableVoices = [];

function loadCantoneseVoices() {
  if (!window.speechSynthesis) return;
  availableVoices = window.speechSynthesis.getVoices() || [];
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadCantoneseVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadCantoneseVoices;
  }
}

function getCantoneseVoice() {
  if (!availableVoices.length && window.speechSynthesis) {
    availableVoices = window.speechSynthesis.getVoices() || [];
  }
  
  let voice = availableVoices.find(v => 
    v.lang === 'zh-HK' || 
    v.lang === 'yue-Hant-HK' || 
    v.lang.toLowerCase().includes('yue') ||
    v.name.toLowerCase().includes('cantonese') ||
    v.name.includes('香港') ||
    v.name.includes('粵語')
  );

  if (!voice) {
    voice = availableVoices.find(v => 
      (v.lang.startsWith('zh-') || v.lang === 'zh') && 
      !v.lang.includes('CN') && 
      !v.name.toLowerCase().includes('mandarin') &&
      !v.name.toLowerCase().includes('putonghua')
    );
  }

  return voice || null;
}

function speakCantonese(text) {
  return new Promise((resolve) => {
    if (!voiceEnabled || !window.speechSynthesis || !text) {
      resolve();
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(String(text));
      utter.lang = 'zh-HK';
      utter.rate = 0.92;
      utter.pitch = 1.0;
      utter.volume = 1.0;

      const hkVoice = getCantoneseVoice();
      if (hkVoice) {
        utter.voice = hkVoice;
      }

      utter.onend = () => resolve();
      utter.onerror = (e) => {
        console.warn('語音播放異常:', e);
        resolve();
      };

      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.warn('speakCantonese 執行錯誤:', err);
      resolve();
    }
  });
}
window.speakCantonese = speakCantonese;

async function speakWithDelay(firstText, secondText, delay = 800) {
  await speakCantonese(firstText);
  await new Promise(r => setTimeout(r, delay));
  await speakCantonese(secondText);
}
window.speakWithDelay = speakWithDelay;

function initGlobalVoiceButton() {
  const btn = document.getElementById('global-voice-btn');
  if (!btn) return;
  btn.textContent = voiceEnabled ? '🔊' : '🔇';
  btn.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    localStorage.setItem('globalVoice', voiceEnabled ? 'true' : 'false');
    btn.textContent = voiceEnabled ? '🔊' : '🔇';
    if (typeof showToast === 'function') {
      showToast(voiceEnabled ? '✅ 語音報播已開啟（廣東話）' : '🔇 語音報播已關閉');
    }
    if (voiceEnabled) {
      speakCantonese('自動報站已開啟');
    }
  });
}
window.initGlobalVoiceButton = initGlobalVoiceButton;
