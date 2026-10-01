/* ============================================================
 * voice.js — 語音報站模組
 * 負責：粵語發音、連續發兩句、全域語音開關
 * ============================================================ */

let voiceEnabled = true;
let voiceLock = false;

function speakCantonese(text) {
  if (!voiceEnabled || !window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-HK';
    utter.volume = 1;
    utter.rate = 0.9;
    let voicesLoaded = false;
    const trySetVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const voice = voices.find(v => v.lang === 'zh-HK') || voices.find(v => v.lang.startsWith('zh')) || null;
        if (voice) utter.voice = voice;
        voicesLoaded = true;
      }
    };
    trySetVoice();
    if (!voicesLoaded) {
      const onVoicesChanged = () => {
        trySetVoice();
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        if (!utter.voice) trySetVoice();
      }, 3000);
    }
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 5000);
    utter.onend = () => { clearTimeout(timer); done(); };
    utter.onerror = () => { clearTimeout(timer); done(); };
    window.speechSynthesis.speak(utter);
  });
}

async function speakWithDelay(phrase1, phrase2) {
  voiceLock = false;
  try {
    await speakCantonese(phrase1);
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (phrase2) await speakCantonese(phrase2);
  } catch (e) {
    console.error('❌ speakWithDelay 錯誤:', e);
  } finally {
    voiceLock = false;
  }
}

function initGlobalVoiceButton() {
  const btn = document.getElementById('global-voice-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    voiceEnabled = !voiceEnabled;
    this.textContent = voiceEnabled ? '🔊' : '🔇';
    this.classList.toggle('muted');
    if (typeof showToast === 'function') showToast(voiceEnabled ? '語音已開啟' : '語音已關閉');
    localStorage.setItem('globalVoice', voiceEnabled ? 'on' : 'off');
    if (!voiceEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  if (localStorage.getItem('globalVoice') === 'off') {
    voiceEnabled = false;
    btn.textContent = '🔇';
    btn.classList.add('muted');
  }
}