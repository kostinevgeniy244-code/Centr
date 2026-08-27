// core.js - ПОЛНАЯ ВЕРСИЯ С БУФЕРОМ КАДРОВ

let cvReady = false;
let isRunning = false;

const STATE = {
  SEARCH: 'search',
  LOCKED: 'locked',
  FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;

let videoEl, canvasEl, overlayEl, frozenImgEl, frozenOverlayEl;

const PARAMS = {
  matrixDiam: 12.4,
  dornDiam: 9.3
};
const MIN_CIRCULARITY = 0.7;
const MIN_AREA = 1000;
const GOOD_FRAMES_NEEDED = 20;

// Буфер хороших кадров
let goodFramesBuffer = [];
let isMeasuring = false;

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
  } else if (currentState === STATE.LOCKED) {
    overlay.className = 'status-overlay state-locked';
    const collected = goodFramesBuffer.length;
    const percent = Math.min((collected / GOOD_FRAMES_NEEDED) * 100, 100);
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressCount) progressCount.textContent = collected;
  } else if (currentState === STATE.FROZEN) {
    overlay.className = 'status-overlay state-frozen';
    if (progressFill) progressFill.style.width = '100%';
    if (progressCount) progressCount.textContent = '20+';
  }
}

async function startCamera() {
  if (document.getElementById('statusOverlay')) {
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

  resizeCanvas();

  const w = overlayEl.width;
  const h = overlayEl.height;
  const ctx = overlayEl.getContext('2d');
  if (!ctx) {
    requestAnimationFrame(processFrame);
    return;
  }

  // Очищаем канвас каждый кадр
  ctx.clearRect(0, 0, w, h);

  // --- ТЕСТОВАЯ ОТРИСОВКА (один раз) ---
  if (!debugDrawDone) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = 'blue';
    ctx.fillRect(w / 2 - 5, h / 2 - 5, 10, 10);

    console.log('🟥🔵 Тестовые линии нарисованы. Если их не видно — проверьте z-index в CSS.');
    debugDrawDone = true;
  }
  // -------------------------------------

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
    cv.adaptiveThreshold(blurMat, threshMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < MIN_AREA) continue;

      const perimeter = cv.arcLength(cnt, true);
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

    // --- ЛОГИКА БУФЕРА КАДРОВ ---
    if (!isMeasuring && candidates.length >= 2) {
      candidates.sort((a, b) => a.avgRadius - b.avgRadius);
      const inner = candidates[0];
      const outer = candidates[candidates.length - 1];

      // Оценка качества кадра:
      // выше circularity + меньше вытянутость эллипса = лучше
      const score =
        (inner.circularity + outer.circularity) / 2
        - Math.abs(inner.rx - inner.ry) / inner.rx
        - Math.abs(outer.rx - outer.ry) / outer.rx;

      // Сохраняем кадр в буфер
      goodFramesBuffer.push({ inner, outer, score });

      // Рисуем найденные кольца
      drawOverlayLive(ctx, inner, outer);

      // Обновляем статус
      currentState = STATE.LOCKED;
      const collected = goodFramesBuffer.length;
      const percent = Math.min((collected / GOOD_FRAMES_NEEDED) * 100, 100);
      const progressFill = document.getElementById('statusProgress');
      const progressCount = document.getElementById('statusCount');
      if (progressFill) progressFill.style.width = percent + '%';
      if (progressCount) progressCount.textContent = collected;
      updateStatus('warn', `Накопление: ${collected}/${GOOD_FRAMES_NEEDED}`);

      // Набрали нужное количество — выбираем лучший
      if (goodFramesBuffer.length >= GOOD_FRAMES_NEEDED) {
        isMeasuring = true;

        let best = goodFramesBuffer[0];
        for (const f of goodFramesBuffer) {
          if (f.score > best.score) best = f;
        }

        console.log(
          '🏆 Лучший кадр: score =', best.score.toFixed(4),
          'inner circ =', best.inner.circularity.toFixed(3),
          'outer circ =', best.outer.circularity.toFixed(3)
        );

        currentState = STATE.FROZEN;
        updateStatus('warn', 'Лучший кадр выбран. Замер...');

        freezeFrameAndMeasure(best.inner, best.outer);

        // Очищаем буфер для следующего замера
        goodFramesBuffer = [];
        isMeasuring = false;
      }
    } else if (!isMeasuring) {
      // Пара не найдена — просто ждём, буфер НЕ сбрасываем
      currentState = STATE.SEARCH;
      updateStatus('warn', 'Не вижу деталь. Наведите камеру.');
    }
    // ----------------------------

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

  calculateOnFrozen(canvasEl, canvasEl.width, canvasEl.height, inner, outer);
}

function calculateOnFrozen(canvas, w, h, inner, outer) {
  // Масштаб: пиксели в мм по известному диаметру матрицы
  const pxPerMm = PARAMS.matrixDiam / (outer.rx * 2);

  const dornPx = inner.rx * 2;
  const matrixPx = outer.rx * 2;

  const dornMm = dornPx * pxPerMm;
  const matrixMm = matrixPx * pxPerMm;

  // Смещение центров
  const dx = outer.center.x - inner.center.x;
  const dy = outer.center.y - inner.center.y;
  const offsetMm = Math.sqrt(dx * dx + dy * dy) * pxPerMm;

  // Неравномерность (разница радиусов по осям)
  const innerUneven = Math.abs(inner.rx - inner.ry);
  const outerUneven = Math.abs(outer.rx - outer.ry);

  console.log({
    dornMm: dornMm.toFixed(3),
    matrixMm: matrixMm.toFixed(3),
    offsetMm: offsetMm.toFixed(3),
    offsetDxMm: (dx * pxPerMm).toFixed(3),
    offsetDyMm: (dy * pxPerMm).toFixed(3),
    innerUnevenPx: innerUneven.toFixed(2),
    outerUnevenPx: outerUneven.toFixed(2),
    pxPerMm: pxPerMm.toFixed(3)
  });

  // Обновление DOM-элементов с результатами
  const setMetric = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };

  setMetric('.metric-value.dorn', dornMm.toFixed(2));
  setMetric('.metric-value.matrix', matrixMm.toFixed(2));
  setMetric('.metric-value.offset', offsetMm.toFixed(2));
  setMetric('.metric-value.offset-dx', (dx * pxPerMm).toFixed(2));
  setMetric('.metric-value.offset-dy', (dy * pxPerMm).toFixed(2));

  updateStatus('ok', 'Замер завершён.');
}

function resetApp() {
  currentState = STATE.SEARCH;
  goodFramesBuffer = [];
  isMeasuring = false;
  isRunning = false;

  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  if (overlayEl) {
    const ctx = overlayEl.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
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