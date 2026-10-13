const examples = Object.freeze({
  mug: { word: 'mug', ipa: '/mʌɡ/' },
  fridge: { word: 'fridge', ipa: '/frɪdʒ/' },
  lamp: { word: 'lamp', ipa: '/læmp/' },
  chair: { word: 'chair', ipa: '/tʃɛr/' },
});
const options = [...document.querySelectorAll('[data-word]')];
const word = document.getElementById('demo-word');
const ipa = document.getElementById('demo-ipa');
const paper = document.querySelector('.label-paper');
const listen = document.getElementById('listen');
const status = document.getElementById('speech-status');
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
listen.disabled = !canSpeak;
let selected = 'mug';
let speechVersion = 0;
let speechTimer;

function stopSpeech() {
  speechVersion += 1;
  clearTimeout(speechTimer);
  if (canSpeak) window.speechSynthesis.cancel();
  listen.disabled = !canSpeak;
  listen.removeAttribute('aria-busy');
}

for (const option of options) {
  option.disabled = false;
  option.addEventListener('click', () => {
    if (!Object.hasOwn(examples, option.dataset.word)) return;
    stopSpeech();
    selected = option.dataset.word;
    word.textContent = examples[selected].word;
    ipa.textContent = examples[selected].ipa;
    for (const button of options) button.setAttribute('aria-pressed', String(button === option));
    listen.setAttribute('aria-label', `朗读英文 ${examples[selected].word}`);
    status.textContent = canSpeak ? '' : '当前浏览器不支持朗读，可在 App 中使用。';
    paper.classList.remove('changed');
    requestAnimationFrame(() => paper.classList.add('changed'));
  });
}
paper.addEventListener('animationend', () => paper.classList.remove('changed'));

if (!canSpeak) {
  listen.disabled = true;
  status.textContent = '当前浏览器不支持朗读，可在 App 中使用。';
}
listen.addEventListener('click', () => {
  if (!canSpeak) return;
  stopSpeech();
  const version = speechVersion;
  const utterance = new SpeechSynthesisUtterance(examples[selected].word);
  utterance.lang = 'en-US';
  utterance.rate = .85;
  utterance.voice = speechSynthesis.getVoices().find(voice => voice.lang === 'en-US') || null;
  listen.disabled = true;
  listen.setAttribute('aria-busy', 'true');
  status.textContent = '正在朗读…';
  const finish = message => {
    if (version !== speechVersion) return;
    clearTimeout(speechTimer);
    listen.disabled = false;
    listen.removeAttribute('aria-busy');
    status.textContent = message;
  };
  utterance.onend = () => finish('');
  utterance.onerror = () => finish('朗读暂不可用，请检查设备语音设置后重试。');
  speechTimer = setTimeout(() => {
    if (version !== speechVersion) return;
    stopSpeech();
    status.textContent = '朗读暂不可用，请检查设备语音设置后重试。';
  }, 10000);
  try { speechSynthesis.speak(utterance); }
  catch { finish('朗读暂不可用，请检查设备语音设置后重试。'); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopSpeech(); if (canSpeak) status.textContent = ''; }
});
window.addEventListener('pagehide', stopSpeech);
