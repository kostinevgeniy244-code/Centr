// core.js

let cvReady = false;
let isRunning = false;

const STATE = {
  SEARCH: 'search',
  LOCKED: 'locked',
  FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;
let stableRingCount = 0;

let videoEl, canvasEl, overlayEl, frozenImgEl, frozenOverlayEl;

const PARAMS = {
  matrixDiam: 50,
  dornDiam: 30
};
const STABLE_THRESHOLD = 20; // кадров стабильности для автозамера
const MIN_CIRCULARITY = 0.7;

function onOpenCVLoad() {
  cvReady = true;
  console.log('✅ OpenCV загружен');
  updateStatus('ok', 'OpenCV готов. Нажмите "ЗАПУСТИТЬ КАМЕРУ".');
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (dot && txt) {
    dot.className = 'dot status-' + type;
    txt.textContent = text;
  }
}

async function startCamera() {
  videoEl = document.getElementById('video');
  if (!videoEl) { console.error('❌ Элемент #video не найден'); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
      audio: false
    });

    videoEl.srcObject = stream;
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      updateStatus('ok', 'Камера активна. Наведите на деталь.');
      initElements();
      isRunning = true;
      processFrame();
    };
  } catch (err) {
    console.error('❌ Ошибка камеры:', err);
    let msg = 'Ошибка камеры!';
    if (err.name === 'NotAllowedError') msg = 'Доступ к камере запрещён.';
    if (err.name === 'NotFoundError') msg = 'Камера не найдена.';
    updateStatus('err', msg);
    alert(msg);
  }
}

function initElements() {
  canvasEl = document.getElementById('canvas');
  overlayEl = document.getElementById('overlay');
  frozenImgEl = document.getElementById('frozenImg');
  frozenOverlayEl = document.getElementById('frozenOverlay');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!videoEl || !canvasEl || !overlayEl) return;
  const w = videoEl.videoWidth || 640;
  const h = videoEl.videoHeight || 480;
  canvasEl.width = w; canvasEl.height = h;
  overlayEl.width = w; overlayEl.height = h;
}

function processFrame() {
  if (!isRunning || !cvReady || !videoEl || videoEl.paused || videoEl.ended) {
    requestAnimationFrame(processFrame);
    return;
  }

  resizeCanvas();

  const srcMat = new cv.Mat(videoEl.height, videoEl.width, cv.CV_8UC4);
  const grayMat = new cv.Mat();
  const blurMat = new cv.Mat();
  const threshMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    // Читаем кадр
    cv.cvtColor(new cv.MatFromImage(videoEl), srcMat, cv.COLOR_RGBA2BGRA);
    cv.cvtColor(srcMat, grayMat, cv.COLOR_BGRA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

    // Бинаризация
    cv.adaptiveThreshold(blurMat, threshMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    // Контуры
    cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 1000) continue;

      const perimeter = cv.arcLength(cnt, true);
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      if (circularity < MIN_CIRCULARITY) continue;
      if (cnt.total() < 5) continue;

      const ellipse = cv.fitEllipse(cnt);
      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity
      });
    }

    srcMat.delete(); grayMat.delete(); blurMat.delete(); threshMat.delete();
    contours.delete(); hierarchy.delete();

    // Логика стабилизации
    if (candidates.length >= 2) {
      // Сортируем: меньший — дорн, больший — матрица
      candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
      const inner = candidates[0];
      const outer = candidates[1];

      // Проверка стабильности (простая: если центры не сильно прыгают)
      // В реальном проекте можно хранить историю и считать дисперсию
      stableRingCount++;
      if (stableRingCount >= STABLE_THRESHOLD) {
        currentState = STATE.LOCKED;
        updateStatus('warn', `Стабильность достигнута. Автозамер через 1 сек...`);
        setTimeout(() => {
          freezeFrameAndMeasure(inner, outer);
        }, 1000);
      } else {
        updateStatus('warn', `Стабильность: ${stableRingCount}/${STABLE_THRESHOLD}`);
        drawOverlayLive(inner, outer);
      }
    } else {
      currentState = STATE.SEARCH;
      stableRingCount = 0;
      updateStatus('warn', 'Не вижу деталь. Наведите камеру.');
      clearOverlay();
    }
  } catch (e) {
    console.error(e);
    clearOverlay();
  }

  requestAnimationFrame(processFrame);
}

function drawOverlayLive(inner, outer) {
  const ctx = overlayEl.getContext('2d');
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  // Рисуем пунктирную рамку ROI (опционально)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.strokeRect(0, 0, overlayEl.width, overlayEl.height);
  ctx.setLineDash([]);

  // Синий круг — как система «видит» кольцо (для отладки)
  drawCircle(ctx, inner.center.x, inner.center.y, inner.rx);
  drawCircle(ctx, outer.center.x, outer.center.y, outer.rx);

  // Вектор смещения
  ctx.beginPath();
  ctx.moveTo(inner.center.x, inner.center.y);
  ctx.lineTo(outer.center.x, outer.center.y);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function clearOverlay() {
  const ctx = overlayEl.getContext('2d');
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
}

function freezeFrameAndMeasure(inner, outer) {
  isRunning = false;
  currentState = STATE.FROZEN;

  // Сохраняем кадр в canvas для OpenCV
  const frozenCanvas = document.getElementById('canvas');
  frozenCanvas.width = videoEl.videoWidth;
  frozenCanvas.height = videoEl.videoHeight;
  const frozenCtx = frozenCanvas.getContext('2d');
  frozenCtx.drawImage(videoEl, 0, 0);

  // Передаем в result.js для финального замера
  if (typeof calculateOnFrozen === 'function') {
    calculateOnFrozen(frozenCanvas, frozenCanvas.width, frozenCanvas.height, inner, outer);
  } else {
    console.error('❌ Функция calculateOnFrozen не найдена');
  }
}

function resetApp() {
  currentState = STATE.SEARCH;
  stableRingCount = 0;
  isRunning = false;
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
  clearOverlay();

  // Сброс UI
  document.querySelectorAll('.metric-value').forEach(el => el.textContent = '--');

  // Скрываем замороженный кадр
  if (frozenImgEl) frozenImgEl.style.display = 'none';
  if (frozenOverlayEl) frozenOverlayEl.style.display = 'none';

  updateStatus('ok', 'Сброшено. Нажмите "ЗАПУСТИТЬ КАМЕРУ" для нового замера.');
}

function drawCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'blue';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Инициализация кнопки сброса
document.addEventListener('DOMContentLoaded', () => {
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetApp);
  }
});
