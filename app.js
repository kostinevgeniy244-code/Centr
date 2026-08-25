// --- Инициализация ---
let isRunning = false;
let bestFrameData = null; // ImageData
let bestScore = -1;
let stableCount = 0;
let frameCounter = 0; // счётчик кадров для отладки

const STABLE_THRESHOLD = 20; // кадров без улучшения — тогда автозаморозка
const MIN_CIRCULARITY = 0.85; // порог для финального расчёта

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const oCtx = overlay.getContext('2d');
const resultEl = document.getElementById('result');
const frozenImg = document.getElementById('frozenImg');
const debugEl = document.getElementById('debug');

// --- Обработчик кнопки Старт ---
document.getElementById('startBtn').onclick = () => {
  isRunning = !isRunning;
  if (isRunning) {
    bestFrameData = null;
    bestScore = -1;
    stableCount = 0;
    frameCounter = 0;
    frozenImg.style.display = 'none';
    resultEl.textContent = 'Поиск оптимального кадра (автозаморозка)...';
    checkAndStartProcessing();
  } else {
    resultEl.textContent = '';
  }
};

// Проверка готовности видео перед стартом обработки
function checkAndStartProcessing() {
  if (!isRunning) return;

  // Ждём, пока видео реально начнёт воспроизводиться и появятся размеры
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(checkAndStartProcessing, 100);
    return;
  }

  processStream();
}


function processStream() {
  if (!isRunning) {
    requestAnimationFrame(processStream);
    return;
  }

  // Повторная проверка размеров на всякий случай
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(() => requestAnimationFrame(processStream), 100);
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  frameCounter++;
  if (frameCounter % 30 === 0) {
    console.log('Кадр №', frameCounter, 'размеры:', w, 'x', h);
  }

  try {
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const thresh = new cv.Mat();
    // Адаптивный порог, инвертированный — удобно для тёмных контуров на светлом фоне
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 1000) continue; // фильтр по минимальной площади

      const perimeter = cv.arcLength(cnt, true);
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      if (circularity < 0.75) continue; // для поиска можно чуть мягче

      if (cnt.total() < 5) continue;
      const ellipse = cv.fitEllipse(cnt);
      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity
      });
    }
    src.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();

    if (candidates.length < 2) {
      requestAnimationFrame(processStream);
      return;
    }

    candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
    const inner = candidates[0];
    const outer = candidates[candidates.length - 1];

    // Метрика качества кадра
    const centerDist = Math.hypot(inner.center.x - outer.center.x, inner.center.y - outer.center.y);
    const avgRadiusOuter = (outer.rx + outer.ry) / 2;
    const offsetNorm = avgRadiusOuter > 0 ? centerDist / avgRadiusOuter : 0;
    const circAvg = (inner.circularity + outer.circularity) / 2;

    // Оценка: чем ближе к 1 — тем лучше
    const score = 0.5 * circAvg + 0.5 * (1 - Math.min(offsetNorm, 1));

    if (score > bestScore) {
      bestScore = score;
      bestFrameData = ctx.getImageData(0, 0, w, h);
      stableCount = 0; // сброс счётчика стабильности
    } else {
      stableCount++;
    }

    // АВТОЗАМОРОЗКА: если N кадров подряд нет улучшения — фиксируем лучший
    if (stableCount >= STABLE_THRESHOLD && bestFrameData) {
      isRunning = false;
      calculateOnFrozen(bestFrameData, w, h);
      return;
    }

    requestAnimationFrame(processStream);
  } catch (err) {
    console.error('Ошибка в processStream:', err);
    resultEl.innerHTML = '<span style="color:red">Ошибка обработки кадра. Проверьте консоль.</span>';
    isRunning = false;
  }
}


function calculateOnFrozen(imageData, w, h) {
  canvas.width = w;
  canvas.height = h;
  ctx.putImageData(imageData, 0, 0);

  try {
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const thresh = new cv.Mat();
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

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
    src.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();

    console.log('calculateOnFrozen вызван, кандидатов:', candidates.length);

    if (candidates.length < 2) {
      resultEl.innerHTML = '<span style="color:red">Не удалось найти два подходящих контура на замороженном кадре</span>';
      return;
    }

    candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
    const inner = candidates[0];
    const outer = candidates[candidates.length - 1];

    const dornDiam = parseFloat(document.getElementById('dornDiam').value);
    const matrDiam = parseFloat(document.getElementById('matrDiam').value);

    const rDornPx = (inner.rx + inner.ry) / 2;
    const rMatrPx = (outer.rx + outer.ry) / 2;

    const pxPerMm = (2 * rDornPx) / dornDiam;
    const gapPx = rMatrPx - rDornPx;
    const gapMm = gapPx / pxPerMm;

    const pxPerMmByMatr = (2 * rMatrPx) / matrDiam;
    const scaleDiff = Math.abs(pxPerMm - pxPerMmByMatr) / pxPerMm;

    // Неравномерность по 24 точкам
    const steps = 24;
    let distances = [];
    let maxDist = 0, minDist = Infinity;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const xOut = outer.center.x + outer.rx * Math.cos(angle);
      const yOut = outer.center.y + outer.ry * Math.sin(angle);
      const dx = xOut - inner.center.x;
      const dy = yOut - inner.center.y;
      const dist = Math.hypot(dx, dy);
      distances.push(dist);
      if (dist > maxDist) maxDist = dist;
      if (dist < minDist) minDist = dist;
    }
    const mean = distances.reduce((a,b)=>a+b,0)/distances.length;
    const stdDev = Math.sqrt(distances.reduce((sum,d)=>sum+(d-mean)**2,0)/distances.length);
    const nonUniformity = stdDev / mean;

    // Смещение по осям (для регулировки 4‑мя болтами)
    const dxPx = outer.center.x - inner.center.x; // положительное — матрица смещена вправо относительно дорна
    const dyPx = outer.center.y - inner.center.y; // положительное — матрица смещена вниз
    const dxMm = dxPx / pxPerMm;
    const dyMm = dyPx / pxPerMm;
    const maxShiftPx = Math.max(Math.abs(dxPx), Math.abs(dyPx));
    const maxShiftMm = maxShiftPx / pxPerMm;

    // Отрисовка поверх замороженного кадра
    overlay.width = w;
    overlay.height = h;
    oCtx.clearRect(0, 0, w, h);
    oCtx.strokeStyle = '#00ff00';
    oCtx.lineWidth = 2;
    drawEllipse(oCtx, inner.center.x, inner.center.y, inner.rx, inner.ry);
    oCtx.stroke();

    oCtx.strokeStyle = '#ff00ff';
    drawEllipse(oCtx, outer.center.x, outer.center.y, outer.rx, outer.ry);
    oCtx.stroke();

    oCtx.strokeStyle = '#ffff00';
    oCtx.beginPath();
    oCtx.moveTo(inner.center.x, inner.center.y);
    oCtx.lineTo(outer.center.x, outer.center.y);
    oCtx.stroke();

    oCtx.strokeStyle = '#ffffff';
    oCtx.setLineDash([5, 5]);
    drawEllipse(oCtx, inner.center.x, inner.center.y, outer.rx, outer.ry); // тот же радиус, но центр дорна
    oCtx.stroke();
    oCtx.setLineDash([]);

    oCtx.fillStyle = '#00ffff';
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const x = outer.center.x + outer.rx * Math.cos(angle);
      const y = outer.center.y + outer.ry * Math.sin(angle);
      oCtx.beginPath();
      oCtx.arc(x, y, 3, 0, Math.PI*2);
      oCtx.fill();
    }

    frozenImg.src = canvas.toDataURL();
    frozenImg.style.display = 'block';

    resultEl.innerHTML = `
      <div><span class="stat">Зазор:</span> ${gapMm.toFixed(2)} мм</div>
      <div><span class="stat">Неравномерность:</span> ${(nonUniformity*100).toFixed(1)}%</div>
      <div><span class="stat">Макс. смещение (радиальное):</span> ${maxShiftMm.toFixed(3)} мм</div>
      <div><span class="stat">Смещение по X (лево‑право):</span> ${dxMm.toFixed(3)} мм (${dxMm >= 0 ? 'матрица вправо' : 'матрица влево'})</div>
      <div><span class="stat">Смещение по Y (верх‑низ):</span> ${dyMm.toFixed(3)} мм (${dyMm >= 0 ? 'матрица вниз' : 'матрица вверх'})</div>
      ${scaleDiff > 0.1 ? `<div style="color:orange">Внимание: масштабы по дорну и матрице не согласованы (разница ${(scaleDiff*100).toFixed(1)}%)</div>` : ''}
    `;
  } catch (err) {
    console.error('Ошибка в calculateOnFrozen:', err);
    resultEl.innerHTML = '<span style="color:red">Ошибка финального расчёта. Проверьте консоль.</span>';
  }
}

// Вспомогательная отрисовка эллипса
function drawEllipse(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
}
