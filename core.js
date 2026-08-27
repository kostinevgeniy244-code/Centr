// core.js - ИСПРАВЛЕННАЯ И УЛУЧШЕННАЯ ВЕРСИЯ

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

// Параметры по умолчанию (дорн и матрица)
const PARAMS = {
  matrixDiam: 12.4,
  dornDiam: 9.3
};
const STABLE_THRESHOLD = 20;
const MIN_CIRCULARITY = 0.7;
const MIN_AREA = 1000; // можно подбирать под реальное разрешение

// Флаг для одноразовой тестовой отрисовки
let debugDrawDone = false; 

function onOpenCVLoad() {
  cvReady = true;
  console.log('✅ OpenCV загружен');
  updateStatus('ok', 'OpenCV готов. Нажмите "ЗАПУСТИТЬ КАМЕРУ".');
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const progressFill = document.getElementById('statusProgress');
  const progressCount = document.getElementById('statusCount');
  const overlay = document.getElementById('statusOverlay');

  if (!overlay) return;

  if (txt) txt.textContent = text;

  if (dot) {
    dot.className = 'dot status-' + type;
  }

  if (currentState === STATE.SEARCH) {
    overlay.className = 'status-overlay state-search';
    if (progressFill) progressFill.style.width = '0%';
    if (progressCount) progressCount.textContent = '0';
  } 
  else if (currentState === STATE.LOCKED) {
    overlay.className = 'status-overlay state-locked';
    const percent = Math.min((stableRingCount / STABLE_THRESHOLD) * 100, 100);
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressCount) progressCount.textContent = stableRingCount;
  } 
  else if (currentState === STATE.FROZEN) {
    overlay.className = 'status-overlay state-frozen';
    if (progressFill) progressFill.style.width = '100%';
    if (progressCount) progressCount.textContent = '20+';
  }
}

async function startCamera() {
  if(document.getElementById('statusOverlay')) {
    document.getElementById('statusOverlay').className = 'status-overlay state-search';
  }

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
  if (w === 0 || h === 0) return;

  if (canvasEl) {
    canvasEl.width = w; 
    canvasEl.height = h;
  }
  overlayEl.width = w;
  overlayEl.height = h;
}

function processFrame() {
  if (!isRunning || !videoEl || videoEl.paused || videoEl.ended) {
    requestAnimationFrame(processFrame);
    return;
  }

  // Пересчитываем размеры только если они изменились (можно добавить проверку)
  resizeCanvas();

  const w = overlayEl.width;
  const h = overlayEl.height;
  const ctx = overlayEl.getContext('2d');
  if (!ctx) {
    requestAnimationFrame(processFrame);
    return;
  }

  // --- ТЕСТОВАЯ ОТРИСОВКА (один раз) ---
  if (!debugDrawDone) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = 'blue';
    ctx.fillRect(w/2 - 5, h/2 - 5, 10, 10);

    console.log('🟥🔵 Тестовые линии нарисованы. Если их не видно — проверьте z-index в CSS.');
    debugDrawDone = true;
  }
  // -------------------------------------

  // Очищаем канвас для отрисовки новых контуров (CSS-крестик должен быть поверх)
  ctx.clearRect(0, 0, w, h);

  // OpenCV: поиск колец
  const srcMat = cv.imread(videoEl);
  if (!srcMat || srcMat.empty()) {
    requestAnimationFrame(processFrame);
    return;
  }

  const grayMat = new cv.Mat();
  const blurMat = new cv.Mat();
  const threshMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(srcMat, grayMat, cv.COLOR_BGRA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);
    // Можно подстроить параметры adaptiveThreshold под освещение
    cv.adaptiveThreshold(blurMat, threshMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < MIN_AREA) continue;

      const perimeter = cv.arcLength(cnt, true);
      // Защита от деления на ноль
      if (perimeter === 0) continue;
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

      if (circularity < MIN_CIRCULARITY) continue;
      if (cnt.total() < 5) continue;

      const ellipse = cv.fitEllipse(cnt);
      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity,
        avgRadius: (ellipse.size.width + ellipse.size.height) / 4
      });
    }

    srcMat.delete(); grayMat.delete(); blurMat.delete(); threshMat.delete();
    contours.delete(); hierarchy.delete();

    // Ищем ровно два кольца: дорн (меньший) и матрицу (больший)
    if (candidates.length >= 2) {
      // Сортируем по среднему радиусу
      candidates.sort((a, b) => a.avgRadius - b.avgRadius);

      // Предполагаем: первые N — это дорн, последние — матрица.
      // Если у тебя всегда 2 основных кольца, можно взять candidates[0] и candidates[candidates.length-1]
      const inner = candidates[0];
      const outer = candidates[candidates.length - 1];

      stableRingCount++;
      if (stableRingCount >= STABLE_THRESHOLD) {
        currentState = STATE.LOCKED;
        updateStatus('warn', `Стабильность достигнута. Автозамер через 1 сек...`);
        setTimeout(() => {
          freezeFrameAndMeasure(inner, outer);
        }, 1000);
      } else {
        currentState = STATE.LOCKED; // показываем прогресс накопления
        updateStatus('warn', `Стабильность: ${stableRingCount}/${STABLE_THRESHOLD}`);
        drawOverlayLive(ctx, inner, outer);
      }
    } else {
      currentState = STATE.SEARCH;
      stableRingCount = 0;
      updateStatus('warn', 'Не вижу деталь. Наведите камеру.');
    }
  } catch (e) {
    console.error('💥 Ошибка в обработке кадра:', e);
  }

  requestAnimationFrame(processFrame);
}

function drawOverlayLive(ctx, inner, outer) {
  // Рисуем найденные кольца (зелёные)
  drawCircle(ctx, inner.center.x, inner.center.y, inner.rx, 'green', 3);
  drawCircle(ctx, outer.center.x, outer.center.y, outer.rx, 'green', 3);

  // Вектор смещения (оранжевый)
  ctx.beginPath();
  ctx.moveTo(inner.center.x, inner.center.y);
  ctx.lineTo(outer.center.x, outer.center.y);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function freezeFrameAndMeasure(inner, outer) {
  isRunning = false;
  currentState = STATE.FROZEN;

  if (!canvasEl || !videoEl) return;

  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  const frozenCtx = canvasEl.getContext('2d');
  if (!frozenCtx) return;
  frozenCtx.drawImage(videoEl, 0, 0);

  // Здесь можно сразу сделать расчёт, если нет отдельной функции
  calculateOnFrozen(canvasEl, canvasEl.width, canvasEl.height, inner, outer);
}

function calculateOnFrozen(canvas, w, h, inner, outer) {
  // Примерный расчёт: переводим пиксели в мм, используя известные диаметры
  // Это упрощённо: в реальности нужна калибровка по эталону
  const pxPerMm = PARAMS.matrixDiam / (outer.rx * 2); // масштаб по матрице

  const dornPx = inner.rx * 2;
  const matrixPx = outer.rx * 2;

  const dornMm = dornPx * pxPerMm;
  const matrixMm = matrixPx * pxPerMm;

  const dx = outer.center.x - inner.center.x;
  const dy = outer.center.y - inner.center.y;
  const offsetMm = Math.sqrt(dx*dx + dy*dy) * pxPerMm;

  // Неравномерность (разница радиусов по осям)
  const innerUneven = Math.abs(inner.rx - inner.ry);
  const outerUneven = Math.abs(outer.rx - outer.ry);

  console.log({
    dornMm,
    matrixMm,
    offsetMm,
    innerUneven,
    outerUneven,
    pxPerMm
  });

  // Тут обновляй DOM-элементы с результатами (например .metric-value)
  // document.querySelector('.metric-value.dorn').textContent = dornMm.toFixed(2);
  // и т.д.
}

function resetApp() {
  currentState = STATE.SEARCH;
  stableRingCount = 0;
  isRunning = false;

  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  if(overlayEl) {
    const ctx = overlayEl.getContext('2d');
    if(ctx) ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  }

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