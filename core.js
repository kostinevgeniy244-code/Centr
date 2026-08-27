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
const STABLE_THRESHOLD = 20;
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
  
  // Проверка наличия overlay
  if (!overlayEl) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Элемент <canvas id="overlay"> не найден в HTML!');
    updateStatus('err', 'Ошибка: нет элемента #overlay');
    return;
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!videoEl || !overlayEl) return;
  
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;

  // Если видео еще не загрузило реальные размеры, выходим
  if (w === 0 || h === 0) return;

  console.log(`📐 Размеры: Видео ${w}x${h}, Канвас ${overlayEl.width}x${overlayEl.height}`);

  if (canvasEl) {
    canvasEl.width = w; 
    canvasEl.height = h;
  }
  
  // ВАЖНО: Меняем именно атрибуты width/height, а не CSS
  overlayEl.width = w;
  overlayEl.height = h;
}

function processFrame() {
  if (!isRunning || !videoEl || videoEl.paused || videoEl.ended) {
    requestAnimationFrame(processFrame);
    return;
  }

  // 1. Синхронизируем размеры
  resizeCanvas();

  const w = overlayEl.width;
  const h = overlayEl.height;
  const ctx = overlayEl.getContext('2d');

  if (!ctx) {
    console.error('❌ Контекст канваса не получен!');
    requestAnimationFrame(processFrame);
    return;
  }

  // 2. === ТЕСТОВАЯ ОТРИСОВКА (Гарантированно должна быть видна) ===
  ctx.clearRect(0, 0, w, h);
  
  // Красная рамка по периметру (проверка позиционирования)
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // Синяя точка в центре (проверка масштаба)
  ctx.fillStyle = 'blue';
  ctx.fillRect(w/2 - 5, h/2 - 5, 10, 10);

  // Если ты видишь эти элементы, значит отрисовка работает!
  // Логику OpenCV можно включать ниже.
  // ==========================================================

  // 3. Логика OpenCV (Поиск колец)
  // Используем imread вместо несуществующего MatFromImage
  const srcMat = cv.imread(videoEl);
  
  if (!srcMat || srcMat.empty()) {
    console.warn('⚠️ Кадр не прочитан (srcMat пуст). Ждем следующего кадра...');
    requestAnimationFrame(processFrame);
    return;
  }

  const grayMat = new cv.Mat();
  const blurMat = new cv.Mat();
  const threshMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    // Конвертация цветов
    cv.cvtColor(srcMat, grayMat, cv.COLOR_BGRA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

    // Бинаризация
    cv.adaptiveThreshold(blurMat, threshMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    // Поиск контуров
    cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      
      // Фильтр по площади (подбери под свой размер детали)
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

    // Освобождаем память
    srcMat.delete(); grayMat.delete(); blurMat.delete(); threshMat.delete();
    contours.delete(); hierarchy.delete();

    // Логика стабилизации и отрисовки найденных колец
    if (candidates.length >= 2) {
      candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
      const inner = candidates;
      const outer = candidates;

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
      // clearOverlay(); // Не чистим, чтобы видеть красную рамку теста
    }
  } catch (e) {
    console.error('💥 Ошибка в обработке кадра:', e);
    // clearOverlay();
  }

  requestAnimationFrame(processFrame);
}

function drawOverlayLive(inner, outer) {
  const ctx = overlayEl.getContext('2d');
  // Не делаем clearRect здесь, чтобы не стирать тестовую красную рамку, 
  // если ты хочешь видеть и её, и кольца. Если нужно только кольца - раскомментируй:
  // ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  // Рисуем найденные кольца
  drawCircle(ctx, inner.center.x, inner.center.y, inner.rx, 'green', 3);
  drawCircle(ctx, outer.center.x, outer.center.y, outer.rx, 'green', 3);

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
  if(ctx) ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
}

function freezeFrameAndMeasure(inner, outer) {
  isRunning = false;
  currentState = STATE.FROZEN;

  const frozenCanvas = document.getElementById('canvas');
  if (!frozenCanvas) return;

  frozenCanvas.width = videoEl.videoWidth;
  frozenCanvas.height = videoEl.videoHeight;
  const frozenCtx = frozenCanvas.getContext('2d');
  frozenCtx.drawImage(videoEl, 0, 0);

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

  document.querySelectorAll('.metric-value').forEach(el => el.textContent = '--');

  if (frozenImgEl) frozenImgEl.style.display = 'none';
  if (frozenOverlayEl) frozenOverlayEl.style.display = 'none';

  updateStatus('ok', 'Сброшено. Нажмите "ЗАПУСТИТЬ КАМЕРУ" для нового замера.');
}

function drawCircle(ctx, x, y, r, color = 'blue', width = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

document.addEventListener('DOMContentLoaded', () => {
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetApp);
  }
});
