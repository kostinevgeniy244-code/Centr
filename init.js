// init.js — выбор тыловой камеры
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
const oCtx = overlay.getContext('2d'); // если overlay — это canvas; если div, то это не нужно
// Рисуем все найденные окружности (полупрозрачные) и лучшую (жирную)
function drawCandidates(candidates, bestIndex) {
  const ctx = oCtx;
  const w = canvas.width;
  const h = canvas.height;

  // Очищаем оверлей
  ctx.clearRect(0, 0, w, h);

  if (!candidates || candidates.length === 0) return;

  candidates.forEach((c, i) => {
    const { x, y, r, score } = c;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (i === bestIndex) {
      // Лучшая окружность: жирная, яркая
      ctx.strokeStyle = '#16a34a';   // success green
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);      // опционально: пунктир
      ctx.stroke();

      // Подпись с score
      ctx.fillStyle = '#16a34a';
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const txt = (score * 100).toFixed(1) + '%';
      ctx.fillText(txt, x + r + 6, y - 12);
    } else {
      // Обычные кандидаты: полупрозрачные, тонкие
      ctx.strokeStyle = 'rgba(255, 128, 0, 0.5)'; // orange, 50% opacity
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  });
}



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
  const backCam = devices.find(d =>
    d.kind === 'videoinput' &&
    !d.label.toLowerCase().includes('front') &&
    !d.label.toLowerCase().includes('selfie')
  );

  if (backCam) return backCam.deviceId;

  const anyCam = devices.find(d => d.kind === 'videoinput');
  return anyCam ? anyCam.deviceId : null;
}

// Глобальная функция синхронизации размеров (должна быть видна везде)
function syncSizes() {
  // video.videoWidth/Height — реальные размеры потока (важны для canvas)
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;

  // Для canvas меняем именно атрибуты width/height (это размер буфера)
  canvas.width = w;
  canvas.height = h;

  // overlay — это div, поэтому размеры задаём через style
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';

  frozenImg.style.width = w + 'px';
  frozenImg.style.height = h + 'px';
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

      // Сбрасываем размеры при каждом новом потоке
      syncSizes();

      video.onloadedmetadata = () => {
        video.play();
        // Сразу после play ещё раз синхронизируем — размеры могут обновиться
        syncSizes();

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

// Слушатель на ресайз окна — чтобы при повороте телефона всё пересчиталось
window.addEventListener('resize', () => {
  if (video && video.readyState >= 4) {
    syncSizes();
  }
});

function checkAndStartProcessing() {
  if (!isRunning) return;
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(checkAndStartProcessing, 100);
    return;
  }
  processStream(); // из core.js
}
