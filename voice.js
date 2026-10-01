/* ============================================================
 * voice.js — 廣東話語音播報模組
 * ============================================================ */

let voiceEnabled = (localStorage.getItem('globalVoice') !== 'false');
let voiceLock = false;

function initGlobalVoiceButton() {
  const btn = document.getElementById('global-voice-btn');
  if (!btn) return;
  btn.textContent = voiceEnabled ? '🔊' : '🔇';
  btn.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    localStorage.setItem('globalVoice', voiceEnabled ? 'true' : 'false');
    btn.textContent = voiceEnabled ? '🔊' : '🔇';
    showToast(voiceEnabled ? '語音播報已開啟' : '語音播報已關閉');
  });
}

function speakCantonese(text) {
  return new Promise((resolve) => {
    if (!voiceEnabled || !window.speechSynthesis || !text) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-HK';
    utter.rate = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const hkVoice = voices.find(v => v.lang === 'zh-HK' || v.lang === 'zh-TW');
    if (hkVoice) utter.voice = hkVoice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

async function speakWithDelay(firstText, secondText, delay = 800) {
  await speakCantonese(firstText);
  await new Promise(r => setTimeout(r, delay));
  await speakCantonese(secondText);
}
