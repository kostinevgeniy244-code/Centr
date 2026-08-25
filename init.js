// init.js
let isRunning = false;
let bestFrameData = null;
let bestScore = -1;
let stableCount = 0;
let frameCounter = 0;

const STABLE_THRESHOLD = 20;
const MIN_CIRCULARITY = 0.85;

// Элементы DOM
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const oCtx = overlay.getContext('2d');

const startBtn = document.getElementById('startBtn');
const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const frozenImg = document.getElementById('frozenImg');

const valGapEl = document.getElementById('valGap');
const valNonUniformEl = document.getElementById('valNonUniform');
const valShiftEl = document.getElementById('valShift');
const valXEl = document.getElementById('valX');
const valYEl = document.getElementById('valY');

function setStatus(type, text) {
  statusText.textContent = text;
  statusDot.className = 'dot';
  if (type === 'ok') {
    statusDot.classList.add('status-ok');
  } else if (type === 'warn') {
    statusDot.classList.add('status-warn');
  } else {
    statusDot.classList.add('status-err');
  }
}

function resetMetrics() {
  valGapEl.textContent = '—';
  valNonUniformEl.textContent = '—';
  valShiftEl.textContent = '—';
  valXEl.textContent = '—';
  valYEl.textContent = '—';
}

// Обработчик кнопки
startBtn.onclick = () => {
  isRunning = !isRunning;
  if (isRunning) {
    bestFrameData = null;
    bestScore = -1;
    stableCount = 0;
    frameCounter = 0;
    frozenImg.style.display = 'none';
    resetMetrics();
    setStatus('warn', 'Поиск оптимального кадра...');
    startBtn.textContent = 'Стоп';
    startBtn.classList.remove('stopped');
    startBtn.classList.add('processing');
    checkAndStartProcessing();
  } else {
    setStatus('ok', 'Остановлено');
    startBtn.textContent = 'Старт (автозаморозка)';
    startBtn.classList.remove('processing');
    startBtn.classList.add('stopped');
  }
};

function checkAndStartProcessing() {
  if (!isRunning) return;
  // Ждём готовности видео
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(checkAndStartProcessing, 100);
    return;
  }
  processStream(); // вызов из core.js
}
