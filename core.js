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

const MIN_CIRCULARITY = 0.75; // Чуть строже, чтобы отсечь овалы
const MIN_AREA = 1500;         // Чуть больше, чтобы игнорировать шум
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
  const edgesMat = new cv.Mat(); // Используем Canny вместо Threshold
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(srcMat, grayMat, cv.COLOR_BGRA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);
    
    // ВАЖНО: Используем Canny для поиска границ. Это лучше работает с разрывами от бликов.
    // Пороги 40 и 120 подобраны для контрастных металлических деталей.
    cv.Canny(blurMat, edgesMat, 40, 120); 

    cv.findContours(edgesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    const centerX = w / 2;
    const centerY = h / 2;
    // Фильтр: объект должен быть в центральной зоне (радиус 35% от кадра)
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
      
      // ПРОВЕРКА: Центр эллипса должен быть близко к центру экрана
      const distFromCenter = Math.hypot(
        ellipse.center.x - centerX, 
        ellipse.center.y - centerY
      );
      
      if (distFromCenter > maxDistFromCenter) continue; // ОТСЕКАЕМ края и мусор

      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity,
        avgRadius: (ellipse.size.width + ellipse.size.height) / 4
      });
    }

    // Сортируем кандидатов по радиусу (предполагаем, что внешний контур больше)
    candidates.sort((a, b) => b.avgRadius - a.avgRadius);

    let inner = null;
    let outer = null;

    // Пытаемся найти пару: самый большой (матрица) и следующий за ним (дорн)
    if (candidates.length >= 2) {
      outer = candidates; // Внешний контур (матрица)
      inner = candidates[1](https://stackoverflow.com/questions/59334122/how-can-i-get-coordinates-of-points-of-contour-corners-in-opencv-js); // Внутренний контур (дорн)
      
      // Дополнительная проверка: внутренний должен быть существенно меньше внешнего
      if (inner.avgRadius > outer.avgRadius * 0.8) {
        inner = null; // Если размеры похожи, это не кольцо внутри кольца
      }
    }

    // Отрисовка найденных контуров для отладки
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
        goodFramesBuffer = []; // Сброс буфера при новом захвате
      }

      // Расчет качества кадра (Score)
      // 1. Балл за округлость
      const shapeScore = (inner.circularity + outer.circularity) / 2;
      
      // 2. Штраф за вытянутость эллипса
      const aspectPenalty = Math.abs(inner.rx - inner.ry) / inner.rx + Math.abs(outer.rx - outer.ry) / outer.rx;
      
      // 3. Оценка контраста (темное кольцо vs светлый фон)
      // Получаем ROI для внутреннего кольца
      const innerRect = new cv.Rect(
        Math.max(0, inner.center.x - inner.rx), 
        Math.max(0, inner.center.y - inner.ry), 
        inner.rx * 2, 
        inner.ry * 2
      );
      const innerROI = grayMat.roi(innerRect);
      const meanInner = cv.mean(innerROI);
      const innerDarkness = meanInner.val; // 0-255

      // Получаем ROI для внешнего кольца
      const outerRect = new cv.Rect(
        Math.max(0, outer.center.x - outer.rx), 
        Math.max(0, outer.center.y - outer.ry), 
        outer.rx * 2, 
        outer.ry * 2
      );
      const outerROI = grayMat.roi(outerRect);
      const meanOuter = cv.mean(outerROI);
      const outerBrightness = meanOuter.val;

      // Контраст между кольцами
      const contrastScore = Math.abs(innerDarkness - outerBrightness) / 255.0;

      // Итоговый скор (нормализованный)
      const score = shapeScore - aspectPenalty + contrastScore;

      goodFramesBuffer.push({ inner, outer, score });

      // Сортируем буфер по качеству и оставляем только лучшие кадры
      goodFramesBuffer.sort((a, b) => b.score - a.score);
      if (goodFramesBuffer.length > 50) {
        goodFramesBuffer = goodFramesBuffer.slice(0, 50);
      }

      // Если набрали достаточно кадров, переходим в режим заморозки
      if (goodFramesBuffer.length >= GOOD_FRAMES_NEEDED) {
        freezeResult(w, h);
      }
    } else {
      if (currentState === STATE.LOCKED) {
        // Если потеряли деталь, сбрасываем состояние
        currentState = STATE.SEARCH;
        updateStatus('warn', 'Деталь потеряна. Наведите камеру.');
        goodFramesBuffer = [];
      }
    }

  } catch (err) {
    console.error('❌ Ошибка обработки кадра:', err);
  } finally {
    // Освобождение памяти
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
  
  // Берем лучший кадр из буфера
  const best = goodFramesBuffer;
  
  // Расчет масштаба (px per mm)
  // Используем усреднение по двум эталонам для компенсации перспективы
  const pxPerMmMatrix = PARAMS.matrixDiam / (best.outer.rx * 2);
  const pxPerMmDorn = PARAMS.dornDiam / (best.inner.rx * 2);
  const pxPerMm = (pxPerMmMatrix + pxPerMmDorn) / 2;

  // Расчет диаметров в мм на основе лучшего кадра
  const measuredMatrixDiam = (best.outer.rx * 2) * pxPerMm;
  const measuredDornDiam = (best.inner.rx * 2) * pxPerMm;

  console.log('Результаты измерения:');
  console.log(`Матрица (эталон ${PARAMS.matrixDiam} мм): ${measuredMatrixDiam.toFixed(2)} мм`);
  console.log(`Дорн (эталон ${PARAMS.dornDiam} мм): ${measuredDornDiam.toFixed(2)} мм`);
  console.log(`Масштаб: 1 мм = \${pxPerMm.toFixed(3)} px`);

  // Здесь можно вызвать функцию для отображения результатов в UI
  // showResults(measuredMatrixDiam, measuredDornDiam, pxPerMm);
}