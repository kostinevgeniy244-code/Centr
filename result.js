// result.js

function calculateOnFrozen(canvasEl, w, h, innerCandidate, outerCandidate) {
  let inner = innerCandidate;
  let outer = outerCandidate;

  if (!inner || !outer) {
    // Фолбэк: ищем заново на замороженном кадре
    const src = cv.imread(canvasEl);
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
      if (perimeter === 0) continue;
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      if (circularity < 0.7) continue;
      if (cnt.total() < 5) continue;
      const ellipse = cv.fitEllipse(cnt);
      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2
      });
    }
    src.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();

    if (candidates.length < 2) {
      setStatus('err', 'Не найдено 2 кольца на замороженном кадре.');
      return;
    }
    candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
    inner = candidates[0];
    outer = candidates[1];
  }

  // Диаметры из UI
  const dornDiamVal = parseFloat(document.getElementById('dornDiam').value) || 9.3;
  const matrDiamVal = parseFloat(document.getElementById('matrDiam').value) || 12.4;

  // Масштаб: мм на пиксель (по среднему диаметру эллипса)
  const innerDiamPx = inner.rx + inner.ry;
  const outerDiamPx = outer.rx + outer.ry;
  const scaleInner = dornDiamVal / innerDiamPx;
  const scaleOuter = matrDiamVal / outerDiamPx;
  const scale = (scaleInner + scaleOuter) / 2;

  // Смещение центров
  const dx = outer.center.x - inner.center.x;
  const dy = outer.center.y - inner.center.y;
  const shiftPx = Math.sqrt(dx * dx + dy * dy);
  const shiftMm = shiftPx * scale;

  // Зазоры по осям (в пикселях, потом в мм)
  // Левый край: левая граница внешнего минус левая граница внутреннего
  const gapLeftPx = (outer.center.x - outer.rx) - (inner.center.x - inner.rx);
  // Правый край: правая граница внешнего минус правая граница внутреннего
  const gapRightPx = (outer.center.x + outer.rx) - (inner.center.x + inner.rx);
  // Верхний край
  const gapTopPx = (outer.center.y - outer.ry) - (inner.center.y - inner.ry);
  // Нижний край
  const gapBottomPx = (outer.center.y + outer.ry) - (inner.center.y + inner.ry);

  const gapLeft = gapLeftPx * scale;
  const gapRight = gapRightPx * scale;
  const gapTop = gapTopPx * scale;
  const gapBottom = gapBottomPx * scale;

  // Средний зазор из измеренных значений
  const avgGap = (gapLeft + gapRight + gapTop + gapBottom) / 4;

  // Неравномерность зазора
  const gaps = [gapLeft, gapRight, gapTop, gapBottom];
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const nonUniform = maxGap - minGap;

  // Вывод результатов
  setMetric('valGap', avgGap.toFixed(3));
  setMetric('valNonUniform', nonUniform.toFixed(3));
  setMetric('valShift', shiftMm.toFixed(3));
  setMetric('valShiftX', (dx * scale).toFixed(3));
  setMetric('valShiftY', (dy * scale).toFixed(3));

  setMetric('valGapLeft', gapLeft.toFixed(3));
  setMetric('valGapRight', gapRight.toFixed(3));
  setMetric('valGapTop', gapTop.toFixed(3));
  setMetric('valGapBottom', gapBottom.toFixed(3));

  updateStatus('ok', 'Замер выполнен.');

  // Отрисовка на замороженном оверлее
  drawFrozenOverlay(inner, outer, dx, dy, shiftPx, scale);
}

function drawFrozenOverlay(inner, outer, dx, dy, shiftPx, scale) {
  const overlay = document.getElementById('frozenOverlay');
  if (!overlay) return;

  const ctx = overlay.getContext('2d');
  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);

  // Рисуем эллипсы
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2;
  drawEllipse(ctx, inner.center.x, inner.center.y, inner.rx, inner.ry);
  drawEllipse(ctx, outer.center.x, outer.center.y, outer.rx, outer.ry);

  // Вектор смещения
  ctx.beginPath();
  ctx.moveTo(inner.center.x, inner.center.y);
  ctx.lineTo(outer.center.x, outer.center.y);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Точка центра внешнего кольца
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(outer.center.x, outer.center.y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Подпись смещения
  const midX = inner.center.x + dx / 2;
  const midY = inner.center.y + dy / 2;
  ctx.fillStyle = '#dc2626';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText((shiftPx * scale).toFixed(2) + ' мм', midX, midY - 12);
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const txtPanel = document.getElementById('statusTextPanel');
  if (dot) dot.className = 'dot status-' + type;
  if (txt) txt.textContent = text;
  if (txtPanel) txtPanel.textContent = text;
}

function drawEllipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}