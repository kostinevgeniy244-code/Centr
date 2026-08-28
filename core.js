// core.js — исправленная и стабилизированная версия

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
  matrixDiam: 12.4, // Диаметр матрицы (внешний контур)
  dornDiam: 9.3     // Диаметр дорна (внутренний контур)
};

const MIN_CIRCULARITY = 0.75;
const MIN_AREA = 1500;
const GOOD_FRAMES_NEEDED = 20;
const SCORE_THRESHOLD = 0.7; // Минимальный балл кадра, чтобы считать его «хорошим»

// Буфер хороших кадров
let goodFramesBuffer = [];
let isMeasuring = false;

// Флаг для одноразовой тестовой отрисовки (можно выключить, поставив false)
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
  if (!videoEl) {
    console.error('❌ Элемент #video не найден');
    updateStatus('err', 'Ошибка: нет элемента #video');
    return;
  }

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
    isRunning = false;
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

  ctx.clearRect(0, 0, w, h);

  // --- ТЕСТОВАЯ ОТРИСОВКА (можно отключить, поставив false вместо true) ---
  if (true && !debugDrawDone) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = 'blue';
    ctx.fillRect(w / 2 - 5, h / 2 - 5, 10, 10);

    console.log('🟥🔵 Тестовые линии нарисованы. Если их не видно — проверьте z-index в CSS.');
    debugDrawDone = true;
  }
  // -------------------------------------------------------------------------

  const srcMat = cv.imread(videoEl);
  if (!srcMat || srcMat.empty()) {
    requestAnimationFrame(processFrame);
    return;
  }

  const grayMat = new cv.Mat();
  const blurMat = new cv.Mat();
  const edgesMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(srcMat, grayMat, cv.COLOR_BGRA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

    // Canny для поиска границ
    cv.Canny(blurMat, edgesMat, 40, 120);

    cv.findContours(edgesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    const centerX = w / 2;
    const centerY = h / 2;
    const maxDistFromCenter = Math.min(w, h) * 0.35;

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

      const distFromCenter = Math.hypot(
        ellipse.center.x - centerX,
        ellipse.center.y - centerY
      );

      if (distFromCenter > maxDistFromCenter) continue;

      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity,
        avgRadius: (ellipse.size.width + ellipse.size.height) / 4,
        fullWidth: ellipse.size.width,
        fullHeight: ellipse.size.height
      });
    }

    candidates.sort((a, b) => b.avgRadius - a.avgRadius);

    let outer = null;
    let inner = null;

    if (candidates.length >= 2) {
      outer = candidates[0];
      inner = candidates[1];

      // Внутренний должен быть заметно меньше внешнего
      if (inner.avgRadius > outer.avgRadius * 0.8) {
        inner = null;
      }
    }

    // Отрисовка найденных контуров
    if (outer) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(outer.center.x, outer.center.y, outer.rx, outer.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (inner) {
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(inner.center.x, inner.center.y, inner.rx, inner.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Логика накопления буфера
    if (inner && outer) {
      if (currentState !== STATE.LOCKED) {
        currentState = STATE.LOCKED;
        updateStatus('ok', 'Деталь найдена. Накопление кадров...');
        goodFramesBuffer = [];
      }

      const shapeScore = (inner.circularity + outer.circularity) / 2;

      const aspectPenalty =
        Math.abs(inner.rx - inner.ry) / inner.rx +
        Math.abs(outer.rx - outer.ry) / outer.rx;

      // ROI для контраста
      const innerRect = new cv.Rect(
        Math.max(0, inner.center.x - inner.rx),
        Math.max(0, inner.center.y - inner.ry),
        inner.rx * 2,
        inner.ry * 2
      );
      const innerROI = grayMat.roi(innerRect);
      const meanInner = cv.mean(innerROI);
      const innerDarkness = meanInner.val ? meanInner.val[0] : 128;

      const outerRect = new cv.Rect(
        Math.max(0, outer.center.x - outer.rx),
        Math.max(0, outer.center.y - outer.ry),
        outer.rx * 2,
        outer.ry * 2
      );
      const outerROI = grayMat.roi(outerRect);
      const meanOuter = cv.mean(outerROI);
      const outerBrightness = meanOuter.val ? meanOuter.val[0] : 128;

      const contrastScore = Math.abs(innerDarkness - outerBrightness) / 255.0;

      const score = shapeScore - aspectPenalty + contrastScore;

      // Добавляем кадр только если он достаточно качественный
      if (score >= SCORE_THRESHOLD) {
        goodFramesBuffer.push({ inner, outer, score });
      }

      goodFramesBuffer.sort((a, b) => b.score - a.score);
      if (goodFramesBuffer.length > 50) {
        goodFramesBuffer = goodFramesBuffer.slice(0, 50);
      }

      if (goodFramesBuffer.length >= GOOD_FRAMES_NEEDED) {
        freezeResult(w, h);
      }
    } else {
      if (currentState === STATE.LOCKED) {
        currentState = STATE.SEARCH;
        updateStatus('warn', 'Деталь потеряна. Наведите камеру.');
        goodFramesBuffer = [];
      }
    }
  } catch (err) {
    console.error('❌ Ошибка обработки кадра:', err);
  } finally {
    srcMat.delete();
    grayMat.delete();
    blurMat.delete();
    edgesMat.delete();
    contours.delete();
    hierarchy.delete();
  }

  requestAnimationFrame(processFrame);
}

function freezeResult(w, h) {
  currentState = STATE.FROZEN;
  updateStatus('ok', 'Измерение завершено!');

  if (goodFramesBuffer.length === 0) {
    updateStatus('err', 'Не удалось накопить хорошие кадры');
    return;
  }

  const best = goodFramesBuffer[0]; // лучший по score

  // Диаметр по эллипсу: ellipse.size.width — это полный диаметр по X
  const pxPerMmMatrix = PARAMS.matrixDiam / best.outer.fullWidth;
  const pxPerMmDorn = PARAMS.dornDiam / best.inner.fullWidth;
  const pxPerMm = (pxPerMmMatrix + pxPerMmDorn) / 2;

  const measuredMatrixDiam = best.outer.fullWidth * pxPerMm;
  const measuredDornDiam = best.inner.fullWidth * pxPerMm;

  console.log('Результаты измерения:');
  console.log(`Матрица (эталон ${PARAMS.matrixDiam} мм): ${measuredMatrixDiam.toFixed(2)} мм`);
  console.log(`Дорн (эталон ${PARAMS.dornDiam} мм): ${measuredDornDiam.toFixed(2)} мм`);
  console.log(`Масштаб: 1 мм = ${pxPerMm.toFixed(3)} px`);

  // Здесь можно вызвать функцию для отображения результатов в UI
  // showResults(measuredMatrixDiam, measuredDornDiam, pxPerMm);
}
