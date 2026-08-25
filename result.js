// result.js
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

    if (candidates.length < 2) {
      setStatus('err', 'Не найдено 2 подходящих контура. Попробуйте изменить освещение.');
      return;
    }

    candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
    const inner = candidates[0];
    const outer = candidates[candidates.length - 1];

    const dornDiamVal = parseFloat(document.getElementById('dornDiam').value);
    const matrDiamVal = parseFloat(document.getElementById('matrDiam').value);

    // Перевод пикселей в мм
    const rDornPx = (inner.rx + inner.ry) / 2;
    const rMatrPx = (outer.rx + outer.ry) / 2;

    const pxPerMm = (2 * rDornPx) / dornDiamVal;
    const gapPx = rMatrPx - rDornPx;
    const gapMm = gapPx / pxPerMm;

    // Неравномерность зазора (по 24 точкам)
    const steps = 24;
    let distances = [];
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const xOut = outer.center.x + outer.rx * Math.cos(angle);
      const yOut = outer.center.y + outer.ry * Math.sin(angle);
      const dist = Math.hypot(xOut - inner.center.x, yOut - inner.center.y);
      distances.push(dist);
    }
    const mean = distances.reduce((a,b)=>a+b,0)/distances.length;
    const stdDev = Math.sqrt(distances.reduce((sum,d)=>sum+(d-mean)**2,0)/distances.length);
    const nonUniformity = stdDev / mean;

    // Смещение
    const dxPx = outer.center.x - inner.center.x;
    const dyPx = outer.center.y - inner.center.y;
    const dxMm = dxPx / pxPerMm;
    const dyMm = dyPx / pxPerMm;
    const shiftMm = Math.hypot(dxMm, dyMm);

    // Вывод метрик
    valGapEl.textContent = gapMm.toFixed(3) + ' мм';
    valNonUniformEl.textContent = (nonUniformity * 100).toFixed(2) + '%';
    valShiftEl.textContent = shiftMm.toFixed(3) + ' мм';
    valXEl.textContent = dxMm.toFixed(3) + ' мм';
    valYEl.textContent = dyMm.toFixed(3) + ' мм';

    setStatus('ok', `Готово: зазор ${gapMm.toFixed(3)} мм`);

    // Отрисовка поверх изображения
    drawOverlay(inner, outer, dxPx, dyPx);

    // Показываем замороженный кадр
    frozenImg.src = canvas.toDataURL();
    frozenImg.style.display = 'block';
  } catch (err) {
    console.error(err);
    setStatus('err', 'Ошибка финального расчёта.');
  }
}

function drawOverlay(inner, outer, dx, dy) {
  oCtx.clearRect(0, 0, overlay.width, overlay.height);
  overlay.width = canvas.width;
  overlay.height = canvas.height;

  // Эллипсы
  oCtx.strokeStyle = '#16a34a';
  oCtx.lineWidth = 3;
  drawEllipse(oCtx, inner.center.x, inner.center.y, inner.rx, inner.ry);
  oCtx.stroke();

  oCtx.strokeStyle = '#dc2626';
  oCtx.lineWidth = 3;
  drawEllipse(oCtx, outer.center.x, outer.center.y, outer.rx, outer.ry);
  oCtx.stroke();

  // Вектор смещения
  oCtx.beginPath();
  oCtx.moveTo(inner.center.x, inner.center.y);
  oCtx.lineTo(outer.center.x, outer.center.y);
  oCtx.strokeStyle = '#f59e0b';
  oCtx.lineWidth = 3;
  oCtx.setLineDash([5, 5]);
  oCtx.stroke();
  oCtx.setLineDash([]);

  // Точки центров
  oCtx.fillStyle = '#ffffff';
  oCtx.strokeStyle = '#000';
  oCtx.lineWidth = 2;
  drawCircle(oCtx, inner.center.x, inner.center.y, 6);
  oCtx.fill(); oCtx.stroke();

  drawCircle(oCtx, outer.center.x, outer.center.y, 6);
  oCtx.fill(); oCtx.stroke();
}

function drawEllipse(ctx, cx, cy, rx, ry) {
  const step = Math.PI / 64;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 2; a += step) {
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    if (a === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
