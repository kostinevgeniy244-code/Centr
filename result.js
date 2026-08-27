// result.js

function calculateOnFrozen(canvasEl, w, h, innerCandidate, outerCandidate) {
  // Если inner/outer уже переданы — используем их (чтобы не искать заново)
  let inner = innerCandidate;
  let outer = outerCandidate;

  if (!inner || !outer) {
    // Фолбэк: ищем заново на замороженном кадре (если вдруг не передали)
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
    inner = candidates[0];   // дорн
    outer = candidates[1];   // матрица
  }

  // Получаем заданные диаметры из UI
  const dornDiamVal = parseFloat(document.getElementById('dornDiam').value) || 30;
  const matrDiamVal = parseFloat(document.getElementById('matrDiam').value) || 50;

  // Масштаб: мм на пиксель (по среднему радиусу)
  const scaleInner = dornDiamVal / (inner.rx * 2);
  const scaleOuter = matrDiamVal / (outer.rx * 2);
  // Усредняем масштаб (если кольца не идеально круглые — компромисс)
  const scale = (scaleInner + scaleOuter) / 2;

  // Смещение центров
  const dx = outer.center.x - inner.center.x;
  const dy = outer.center.y - inner.center.y;
  const shiftPx = Math.sqrt(dx * dx + dy * dy);
  const shiftMm = shiftPx * scale;

  // Зазоры по осям (в пикселях, потом в мм)
  // Слева: левый край внешнего минус левый край внутреннего
  const gapLeftPx = (outer.center.x - outer.rx) - (inner.center.x - inner.rx);
  // Справа: правый край внутреннего минус правый край внешнего
  const gapRightPx = (inner.center.x + inner.rx) - (outer.center.x + outer.rx);
  // Сверху
  const gapTopPx = (outer.center.y - outer.ry) - (inner.center.y - inner.ry);
  // Снизу
  const gapBottomPx = (inner.center.y + inner.ry) - (outer.center.y + outer.ry);

  const gapLeft = gapLeftPx * scale;
  const gapRight = gapRightPx * scale;
  const gapTop = gapTopPx * scale;
  const gapBottom = gapBottomPx * scale;

  // Средний зазор (полуразность диаметров)
  const avgGap = ((matrDiamVal - dornDiamVal) / 2);

  // Неравномерность зазора: разброс от среднего
  const gaps = [gapLeft, gapRight, gapTop, gapBottom];
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const nonUniform = maxGap - minGap;

  // Выводим результаты
  setMetric('valGap', avgGap.toFixed(2));
  setMetric('valNonUniform', nonUniform.toFixed(2));
  setMetric('valShift', shiftMm.toFixed(2));
  setMetric('valShiftX', dx * scale.toFixed(2));
  setMetric('valShiftY', dy * scale.toFixed(2));

  setMetric('valGapLeft', gapLeft.toFixed(2));
  setMetric('valGapRight', gapRight.toFixed(2));
  setMetric('valGapTop', gapTop.toFixed(2));
  setMetric('valGapBottom', gapBottom.toFixed(2));

  updateStatus('ok', 'Замер выполнен.');

  // Отрисовка на замороженном оверлее
  drawFrozenOverlay(inner, outer, dx, dy, shiftPx);
}

function drawFrozenOverlay(inner, outer, dx, dy, shiftPx) {
  const overlay = document.getElementById('frozenOverlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  const ctx = overlay.getContext('2d');
  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);

  // Рисуем кольца
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2;
  drawCircle(ctx, inner.center.x, inner.center.y, inner.rx);
  drawCircle(ctx, outer.center.x, outer.center.y, outer.rx);

  // Вектор смещения
  ctx.beginPath();
  ctx.moveTo(inner.center.x, inner.center.y);
  ctx.lineTo(outer.center.x, outer.center.y);
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Точка центра смещения
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
  ctx.fillText(shiftPx.toFixed(1) + ' px', midX, midY - 12);
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (dot && txt) {
    dot.className = 'dot status-' + type;
    txt.textContent = text;
  }
}

function drawCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (dot && txt) {
    dot.className = 'dot status-' + type;
    txt.textContent = text;
  }
}

