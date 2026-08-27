// core.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

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

// Флаг для одноразовой тестовой отрисовки (чтобы не мешал потом)
let debugDrawDone = false; 

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

  // --- ИСПРАВЛЕНИЕ: Очищаем только свой канвас, используя правильные имена переменных ---
  // Мы НЕ делаем clearRect здесь, если хотим видеть и CSS-крестик, и контуры одновременно.
  // Но если контуры накладываются друг на друга и становятся жирными, раскомментируй строку ниже:
  // ctx.clearRect(0, 0, w, h); 

  // --- ТЕСТОВАЯ ОТРИСОВКА (Только один раз для проверки работы слоев) ---
  if (!debugDrawDone) {
    // Красная рамка по периметру
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    // Синяя точка в центре
    ctx.fillStyle = 'blue';
    ctx.fillRect(w/2 - 5, h/2 - 5, 10, 10);
    
    console.log('🟥🔵 Тестовые линии нарисованы. Если их не видно на экране - проблема в CSS слоях (z-index).');
    debugDrawDone = true; // Больше не рисуем эти линии
  }
  // ---------------------------------------------------------------------

  // 3. Логика OpenCV (Поиск колец)
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

    if (candidates.length >= 2) {
      // Сортируем: меньший диаметр - это дорн (inner), больший - матрица (outer)
      candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
      
      const inner = candidates;
      const outer = candidates[candidates.length - 1];

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
    }
  } catch (e) {
    console.error('💥 Ошибка в обработке кадра:', e);
  }

  requestAnimationFrame(processFrame);
}

function drawOverlayLive(inner, outer) {
  const ctx = overlayEl.getContext('2d');
  
  // ВАЖНО: Не делаем clearRect здесь, чтобы не стирать фон и CSS-крестик.
  // Если контуры становятся слишком жирными из-за наложения кадров, 
  // лучше очищать канвас в начале processFrame (см. комментарий там).

  // Рисуем найденные кольца (зеленые)
  drawCircle(ctx, inner.center.x, inner.center.y, inner.rx, 'green', 3);
  drawCircle(ctx, outer.center.center.x, outer.center.y, outer.rx, 'green', 3); // Исправлено: было outer.center.x

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
  frozenCtx.drawImage(videoEl, 0, 0);

  if (typeof calculateOnFrozen === 'function') {
    calculateOnFrozen(canvasEl, canvasEl.width, canvasEl.height, inner, outer);
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
  
  // Очищаем канвас отрисовки
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
