let cvReady = false;
let isRunning = false;

const STATE = {
  SEARCH: 'search',
  LOCKED: 'locked',
  FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;

let videoEl, canvasEl, overlayEl, frozenImgEl, frozenOverlayEl;

// Фиксированное рабочее разрешение для OpenCV (быстрее и стабильнее на мобильном)
const PROCESS_WIDTH = 320;
const PROCESS_HEIGHT = 240;

// Исходные размеры потока (зафиксируем один раз при старте)
let srcW = 0, srcH = 0;

const PARAMS = {
  matrixDiam: 12.4,
  dornDiam: 9.3,
  GOOD_FRAMES_NEEDED: 20,
  SCORE_THRESHOLD: 0.6,
  MIN_CIRCULARITY: 0.6
};

// Глобальные переменные для накопления кадров
let goodFramesBuffer = [];
let lastScore = 0;

function initElements() {
  videoEl = document.getElementById('video');
  canvasEl = document.getElementById('overlay');
  overlayEl = document.getElementById('overlay');
  frozenImgEl = document.getElementById('frozenImg');
  frozenOverlayEl = document.getElementById('frozenOverlay');

  resizeCanvas();
}

function resizeCanvas() {
  if (!videoEl || !overlayEl || videoEl.videoWidth === 0) return;

  srcW = videoEl.videoWidth;
  srcH = videoEl.videoHeight;

  overlayEl.width = srcW;
  overlayEl.height = srcH;
}

async function startCamera() {
  // Сброс состояния при перезапуске (смена оснастки)
  goodFramesBuffer = [];
  lastScore = 0;
  currentState = STATE.SEARCH;
  isRunning = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'environment' // тыловая камера по умолчанию
      },
      audio: false
    });

    videoEl.srcObject = stream;
    videoEl.onloadedmetadata = () => {
      // Один раз фиксируем реальные размеры потока
      srcW = videoEl.videoWidth;
      srcH = videoEl.videoHeight;
      console.log('Исходный поток:', srcW, 'x', srcH);

      resizeCanvas(); // подгоняем canvas под реальные размеры
      videoEl.play();
      updateStatus('ok', 'Камера активна. Наведите на деталь.');
      processFrame();
    };
  } catch (err) {
    console.error(err);
    updateStatus('err', 'Ошибка доступа к камере');
    isRunning = false;
  }
}

function updateStatus(type, text) {
  const el = document.getElementById('status');
  el.className = 'status ' + type;
  el.textContent = text;
}

// Динамический порог площади в зависимости от ожидаемого размера кольца
function getMinAreaForDiameter(diameterMm) {
  // Оценка масштаба: ~0.056 мм/пиксель для типичного Android на 20 см
  const mmPerPixel = 0.056;
  const diameterPx = diameterMm / mmPerPixel;
  const radiusPx = diameterPx / 2;

  // Площадь круга ≈ π * r^2
  const expectedArea = Math.PI * radiusPx * radiusPx;

  // Для маленьких колец ослабляем порог, но не ниже разумного минимума
  return Math.max(250, expectedArea * 0.4);
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

  // Ресайз до рабочего размера для OpenCV
  const smallSrc = new cv.Mat();
  cv.resize(srcMat, smallSrc, new cv.Size(PROCESS_WIDTH, PROCESS_HEIGHT));

  const grayMat = new cv.Mat();
  const blurMat = new cv.Mat();
  const edgesMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  cv.cvtColor(smallSrc, grayMat, cv.COLOR_BGRA2GRAY);
  cv.GaussianBlur(grayMat, blurMat, new cv.Size(3, 3), 0);

  // Морфология: закрываем мелкие разрывы от бликов
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  cv.morphologyEx(blurMat, blurMat, cv.MORPH_CLOSE, kernel);

  cv.Canny(blurMat, edgesMat, 60, 130);
  cv.findContours(edgesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Коэффициенты масштабирования для отрисовки обратно на полный canvas
  const scaleX = w / PROCESS_WIDTH;
  const scaleY = h / PROCESS_HEIGHT;

  // Получаем введённые размеры оснастки
  const dornDiamVal = parseFloat(document.getElementById('dornDiam').value) || PARAMS.dornDiam;
  const matrDiamVal = parseFloat(document.getElementById('matrDiam').value) || PARAMS.matrixDiam;

  const minAreaInner = getMinAreaForDiameter(dornDiamVal);
  const minAreaOuter = getMinAreaForDiameter(matrDiamVal);

  let candidates = [];

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);

    // Пропускаем слишком маленькие контуры
    if (area < Math.min(minAreaInner, minAreaOuter)) continue;

    const ellipse = cv.fitEllipse(cnt);
    const center = ellipse.center;
    const rx = ellipse.size.width / 2;
    const ry = ellipse.size.height / 2;

    // Оценка «круглости»
    const perimeter = cv.arcLength(cnt, true);
    let circularity = 0;
    if (perimeter > 0 && area > 0) {
      circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    }

    if (circularity < PARAMS.MIN_CIRCULARITY) continue;

    candidates.push({
      center, rx, ry, area, circularity,
      // Масштабируем координаты для отрисовки
      realX: center.x * scaleX,
      realY: center.y * scaleY,
      realRx: rx * scaleX,
      realRy: ry * scaleY
    });
  }

  contours.delete();
  hierarchy.delete();

  // Ищем пару «внутреннее + внешнее»
  let innerCandidate = null;
  let outerCandidate = null;

  // Простая эвристика: сортируем по площади, ищем вложенность
  candidates.sort((a, b) => b.area - a.area);

  for (const c of candidates) {
    // Если ещё нет внешнего — это кандидат на внешнее
    if (!outerCandidate) {
      outerCandidate = c;
      continue;
    }
    // Проверяем, находится ли центр текущего внутри внешнего (по bounding box)
    const inside =
      c.center.x > outerCandidate.center.x - outerCandidate.rx * 0.8 &&
      c.center.x < outerCandidate.center.x + outerCandidate.rx * 0.8 &&
      c.center.y > outerCandidate.center.y - outerCandidate.ry * 0.8 &&
      c.center.y < outerCandidate.center.y + outerCandidate.ry * 0.8;

    if (inside) {
      innerCandidate = c;
      break;
    }
  }

  // Отрисовка эллипсов
  if (outerCandidate) {
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(outerCandidate.realX, outerCandidate.realY, outerCandidate.realRx, outerCandidate.realRy, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (innerCandidate) {
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(innerCandidate.realX, innerCandidate.realY, innerCandidate.realRx, innerCandidate.realRy, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Вектор смещения
    ctx.strokeStyle = '#f59e0b';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(outerCandidate.realX, outerCandidate.realY);
    ctx.lineTo(innerCandidate.realX, innerCandidate.realY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Накопление хороших кадров
  if (innerCandidate && outerCandidate) {
    const dx = innerCandidate.center.x - outerCandidate.center.x;
    const dy = innerCandidate.center.y - outerCandidate.center.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);

    // Оценка качества пары (простая метрика)
    const score = 1 - (distPx / Math.max(outerCandidate.rx, outerCandidate.ry, 1));
    lastScore = score;

    if (score >= PARAMS.SCORE_THRESHOLD) {
      goodFramesBuffer.push({ inner: innerCandidate, outer: outerCandidate, score });
      if (goodFramesBuffer.length > PARAMS.GOOD_FRAMES_NEEDED) {
        goodFramesBuffer.shift();
      }
    }
  } else {
    lastScore = 0;
  }

  // Обновляем метрики в UI
  updateMetricsUI();

  srcMat.delete();
  smallSrc.delete();
  grayMat.delete();
  blurMat.delete();
  edgesMat.delete();

  if (isRunning && currentState !== STATE.FROZEN) {
    requestAnimationFrame(processFrame);
  }
}

function updateMetricsUI() {
  const countEl = document.getElementById('metricCount');
  if (countEl) countEl.textContent = goodFramesBuffer.length;

  if (goodFramesBuffer.length < 2) {
    document.getElementById('metricShift').textContent = '0.00';
    document.getElementById('metricGap').textContent = '0.00';
    return;
  }

  // Усредняем центры по буферу
  let sumInnerX = 0, sumInnerY = 0;
  let sumOuterX = 0, sumOuterY = 0;

  for (const f of goodFramesBuffer) {
    sumInnerX += f.inner.center.x;
    sumInnerY += f.inner.center.y;
    sumOuterX += f.outer.center.x;
    sumOuterY += f.outer.center.y;
  }

  const avgInnerX = sumInnerX / goodFramesBuffer.length;
  const avgInnerY = sumInnerY / goodFramesBuffer.length;
  const avgOuterX = sumOuterX / goodFramesBuffer.length;
  const avgOuterY = sumOuterY / goodFramesBuffer.length;

  // Смещение в пикселях
  const dxPx = avgInnerX - avgOuterX;
  const dyPx = avgInnerY - avgOuterY;
  const distPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

  // Масштаб (мм/пиксель) считаем по усреднённым радиусам
  const avgInnerR = goodFramesBuffer.reduce((s, f) => s + f.inner.rx, 0) / goodFramesBuffer.length;
  const avgOuterR = goodFramesBuffer.reduce((s, f) => s + f.outer.rx, 0) / goodFramesBuffer.length;

  const dornDiamVal = parseFloat(document.getElementById('dornDiam').value) || PARAMS.dornDiam;
  const matrDiamVal = parseFloat(document.getElementById('matrDiam').value) || PARAMS.matrixDiam;

  const scaleInner = dornDiamVal / (avgInnerR * 2); // мм/пиксель
  const scaleOuter = matrDiamVal / (avgOuterR * 2);
  const scale = (scaleInner + scaleOuter) / 2;

  // Смещение в мм
  const shiftMm = distPx * scale;

  // Зазор (разница диаметров) в мм — это просто введённые пользователем значения
  const gapMm = matrDiamVal - dornDiamVal;

  document.getElementById('metricShift').textContent = shiftMm.toFixed(2);
  document.getElementById('metricGap').textContent = gapMm.toFixed(2);
}

// Обработчики UI
document.addEventListener('DOMContentLoaded', () => {
  initElements();

  document.getElementById('btnReset').addEventListener('click', () => {
    goodFramesBuffer = [];
    lastScore = 0;
    currentState = STATE.SEARCH;
    startCamera(); // перезапуск сбрасывает состояние и запрашивает поток заново
  });
});

window.onOpenCvLoad = () => {
  cvReady = true;
  console.log('OpenCV loaded');
  startCamera();
};
// конец файла