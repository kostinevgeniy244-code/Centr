// init.js — выбор тыловой камеры
let isRunning = false;
let bestFrameData = null;
let bestScore = -1;
let stableCount = 0;
let frameCounter = 0;

const STABLE_THRESHOLD = 20;
const MIN_CIRCULARITY = 0.85;

// Элементы DOM (оставь как было)
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
function syncSizes() {
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;

  // Для canvas важно менять именно атрибуты width/height (не CSS!)
  canvas.width = w;
  canvas.height = h;

  // overlay — это div, меняем через стиль
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';

  // frozenImg тоже должен быть по размеру области
  frozenImg.style.width = w + 'px';
  frozenImg.style.height = h + 'px';
}

// Вызываем при загрузке метаданных и при ресайзе
video.addEventListener('loadedmetadata', syncSizes);
window.addEventListener('resize', syncSizes);



function setStatus(type, text) {
  statusText.textContent = text;
  statusDot.className = 'dot';
  if (type === 'ok') statusDot.classList.add('status-ok');
  else if (type === 'warn') statusDot.classList.add('status-warn');
  else statusDot.classList.add('status-err');
}

function resetMetrics() {
  valGapEl.textContent = '—';
  valNonUniformEl.textContent = '—';
  valShiftEl.textContent = '—';
  valXEl.textContent = '—';
  valYEl.textContent = '—';
}

async function getBackCameraDeviceId() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  // Ищем камеру, которая не фронтальная
  const backCam = devices.find(d =>
    d.kind === 'videoinput' &&
    !d.label.toLowerCase().includes('front') &&
    !d.label.toLowerCase().includes('selfie')
  );

  if (backCam) return backCam.deviceId;

  // Если не нашли «тыловую» по названию, берём первую видеокамеру
  const anyCam = devices.find(d => d.kind === 'videoinput');
  return anyCam ? anyCam.deviceId : null;
}

startBtn.onclick = async () => {
  isRunning = !isRunning;
  if (isRunning) {
    bestFrameData = null;
    bestScore = -1;
    stableCount = 0;
    frameCounter = 0;
    frozenImg.style.display = 'none';
    resetMetrics();
    setStatus('warn', 'Выбор камеры...');

    try {
      const deviceId = await getBackCameraDeviceId();
      if (!deviceId) {
        throw new Error('Камеры не найдены');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { min: 320, max: 1280 },
          height: { min: 240, max: 720 }
        }
      });

      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        setStatus('warn', 'Поиск оптимального кадра...');
        startBtn.textContent = 'Стоп';
        startBtn.classList.remove('stopped');
        startBtn.classList.add('processing');
        checkAndStartProcessing();
      };
    } catch (err) {
      isRunning = false;
      console.error(err);
      setStatus('err', 'Ошибка доступа к камере: ' + err.message);
      startBtn.textContent = 'Старт (автозаморозка)';
      startBtn.classList.remove('processing');
      startBtn.classList.add('stopped');
    }
  } else {
    const stream = video.srcObject;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    setStatus('ok', 'Остановлено');
    startBtn.textContent = 'Старт (автозаморозка)';
    startBtn.classList.remove('processing');
    startBtn.classList.add('stopped');
  }
};

function checkAndStartProcessing() {
  if (!isRunning) return;
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(checkAndStartProcessing, 100);
    return;
  }
  processStream(); // из core.js
}
