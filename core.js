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

const MIN_CIRCULARITY = 0.75;
const MIN_AREA = 1500;
const GOOD_FRAMES_NEEDED = 20;
const SCORE_THRESHOLD = 0.7;

let goodFramesBuffer = [];

function onOpenCVLoad() {
  cvReady = true;
  console.log('✅ OpenCV загружен');
  updateStatus('ok', 'OpenCV готов. Нажмите "ЗАПУСТИТЬ КАМЕРУ".');
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const txtPanel = document.getElementById('statusTextPanel');
  const progressFill = document.getElementById('statusProgress');
  const progressCount = document.getElementById('statusCount');
  const overlay = document.getElementById('statusOverlay');

  if (txt) txt.textContent = text;
  if (txtPanel) txtPanel.textContent = text;

  if (dot) {
    dot.className = 'dot status-' + type;
  }

  if (!overlay) return;

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
    if (progressCount) progressCount.textContent = GOOD_FRAMES_NEEDED + '+';
  }
}

async function startCamera() {
  // Останавливаем предыдущий поток, если был
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  resetApp(false);

  videoEl = document.getElementById('video');
  if (!videoEl) {
    console.error('❌ Элемент #video не найден');
    updateStatus('err', 'Ошибка: нет элемента #video');
    return;
  }

  const overlay = document.getElementById('statusOverlay');
  if (overlay) {
    overlay.className = 'status-overlay state-search';
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
    console.error('❌ Элемент <canvas id="overlay"> не найден!');
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

  // Подгоняем соотношение сторон контейнера под видео,
  // чтобы object-fit: contain не оставлял чёрных полос
  const videoArea = document.querySelector('.video-area');
  if (videoArea) {
    videoArea.style.aspectRatio = w + ' / ' + h;
  }
}

function processFrame() {
  if (!isRunning || !videoEl || videoEl.paused || videoEl.ended) {
    if (isRunning) requestAnimationFrame(processFrame);
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
      if (inner.avgRadius > outer.avgRadius * 0.8) {
        inner = null;
      }
    }

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

    if (inner && outer) {
      if (currentState !== STATE.LOCKED) {
        currentState = STATE.LOCKED;
        updateStatus('ok', 'Деталь найдена. Накопление кадров...');
        goodFramesBuffer = [];
      }

      const shapeScore = (inner.circularity + outer.circularity) / 2;
      const aspectPenalty =
        Math.abs(inner.rx - inner.ry) / Math.max(inner.rx, 1) +
        Math.abs(outer.rx - outer.ry) / Math.max(outer.rx, 1);

      // ROI для оценки контраста (с ограничением границ)
      const ix1 = Math.max(0, Math.floor(inner.center.x - inner.rx));
      const iy1 = Math.max(0, Math.floor(inner.center.y - inner.ry));
      const ix2 = Math.min(w, Math.floor(inner.center.x + inner.rx));
      const iy2 = Math.min(h, Math.floor(inner.center.y + inner.ry));

      let innerDarkness = 128;
      if (ix2 > ix1 && iy2 > iy1) {
        const innerROI = grayMat.roi(new cv.Rect(ix1, iy1, ix2 - ix1, iy2 - iy1));
        const meanInner = cv.mean(innerROI);
        innerDarkness = meanInner.val ? meanInner.val[0] : 128;
        innerROI.delete();
      }

      const ox1 = Math.max(0, Math.floor(outer.center.x - outer.rx));
      const oy1 = Math.max(0, Math.floor(outer.center.y - outer.ry));
      const ox2 = Math.min(w, Math.floor(outer.center.x + outer.rx));
      const oy2 = Math.min(h, Math.floor(outer.center.y + outer.ry));

      let outerBrightness = 128;
      if (ox2 > ox1 && oy2 > oy1) {
        const outerROI = grayMat.roi(new cv.Rect(ox1, oy1, ox2 - ox1, oy2 - oy1));
        const meanOuter = cv.mean(outerROI);
        outerBrightness = meanOuter.val ? meanOuter.val[0] : 128;
        outerROI.delete();
      }

      const contrastScore = Math.abs(innerDarkness - outerBrightness) / 255.0;
      const score = shapeScore - aspectPenalty + contrastScore;

      if (score >= SCORE_THRESHOLD) {
        goodFramesBuffer.push({ inner, outer, score });
      }

      goodFramesBuffer.sort((a, b) => b.score - a.score);
      if (goodFramesBuffer.length > GOOD_FRAMES_NEEDED * 2) {
        goodFramesBuffer = goodFramesBuffer.slice(0, GOOD_FRAMES_NEEDED * 2);
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

  if (isRunning && currentState !== STATE.FROZEN) {
    requestAnimationFrame(processFrame);
  }
}

function freezeResult(w, h) {
  currentState = STATE.FROZEN;
  isRunning = false;
  updateStatus('ok', 'Измерение завершено!');

  if (goodFramesBuffer.length === 0) {
    updateStatus('err', 'Не удалось накопить хорошие кадры');
    return;
  }

  const best = goodFramesBuffer[0];

  // Замораживаем кадр: копируем текущий кадр видео в frozenImg
  if (videoEl && frozenImgEl) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(videoEl, 0, 0, w, h);
    frozenImgEl.src = tempCanvas.toDataURL('image/jpeg', 0.92);
    frozenImgEl.style.display = 'block';
    videoEl.style.display = 'none';
  }

  // Показываем оверлей для финальной отрисовки
  if (frozenOverlayEl) {
    frozenOverlayEl.width = w;
    frozenOverlayEl.height = h;
    frozenOverlayEl.style.display = 'block';
  }

  // Скрываем live-оверлей и перекрестие
  if (overlayEl) overlayEl.style.display = 'none';
  const crosshair = document.querySelector('.crosshair-fixed');
  if (crosshair) crosshair.style.display = 'none';

  // Вызываем расчёт метрик
  if (typeof calculateOnFrozen === 'function') {
    calculateOnFrozen(canvasEl, w, h, best.inner, best.outer);
  } else {
    console.error('❌ Функция calculateOnFrozen не найдена. Проверьте подключение result.js.');
  }

  // Останавливаем поток камеры
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
}

function resetApp(stopCamera) {
  if (stopCamera === undefined) stopCamera = true;

  isRunning = false;
  currentState = STATE.SEARCH;
  goodFramesBuffer = [];

  // Показываем видео, скрываем замороженный кадр
  if (videoEl) videoEl.style.display = 'block';
  if (overlayEl) overlayEl.style.display = 'block';
  if (frozenImgEl) {
    frozenImgEl.style.display = 'none';
    frozenImgEl.src = '';
  }
  if (frozenOverlayEl) {
    frozenOverlayEl.style.display = 'none';
  }

  // Показываем перекрестие
  const crosshair = document.querySelector('.crosshair-fixed');
  if (crosshair) crosshair.style.display = 'block';

  // Сбрасываем метрики
  const metricIds = [
    'valGap', 'valNonUniform', 'valShift', 'valShiftX', 'valShiftY',
    'valGapLeft', 'valGapRight', 'valGapTop', 'valGapBottom'
  ];
  metricIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '--';
  });

  if (stopCamera && videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  updateStatus('ok', 'Сброшено. Нажмите "ЗАПУСТИТЬ КАМЕРУ".');
}