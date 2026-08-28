function calculateOnFrozen(canvasEl, w, h, innerCandidate, outerCandidate) {
  let inner = innerCandidate;
  let outer = outerCandidate;

  if (!inner || !outer) {
    const src = cv.imread(canvasEl);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const thresh = new cv.Mat();
    // ПОПРАВЛЕНО: чуть снизили порог площади для фолбэка, чтобы не потерять кольца
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      // ПОПРАВЛЕНО: для фолбэка порог 600 вместо 1000
      if (area < 600) continue;
      const perimeter = cv.arcLength(cnt, true);
      if (perimeter === 0) continue;
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      // ПОПРАВЛЕНО: для фолбэка 0.65 вместо 0.7
      if (circularity < 0.65) continue;
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
    inner = candidates;
    outer = candidates;
  }

  const dornDiamVal = parseFloat(document.getElementById('dornDiam').value) || 9.3;
  const matrDiamVal = parseFloat(document.getElementById('matrDiam').value) || 12.4;

  const innerDiamPx = inner.rx + inner.ry;
  const outerDiamPx = outer.rx + outer.ry;
  const scaleInner = dornDiamVal / innerDiamPx;
  const scaleOuter = matrDiamVal / outerDiamPx;
  const scale = (scaleInner + scaleOuter) / 2;

  const dx = outer.center.x - inner.center.x;
  const dy = outer.center.y - inner.center.y;
  const shiftPx = Math.sqrt(dx * dx + dy * dy);
  const shiftMm = shiftPx * scale;

  const gapLeftPx = (outer.center.x - outer.rx) - (inner.center.x - inner.rx);
  const gapRightPx = (outer.center.x + outer.rx) - (inner.center.x + inner.rx);
  const gapTopPx = (outer.center.y - outer.ry) - (inner.center.y - inner.ry);
  const gapBottomPx = (outer.center.y + outer.ry) - (inner.center.y + inner.ry);

  const gapLeft = gapLeftPx * scale;
  const gapRight = gapRightPx * scale;
  const gapTop = gapTopPx * scale;
  const gapBottom = gapBottomPx * scale;

  const avgGap = (gapLeft + gapRight + gapTop + gapBottom) / 4;

  const gaps = [gapLeft, gapRight, gapTop, gapBottom];
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const nonUniform = maxGap - minGap;

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

  drawFrozenOverlay(inner, outer, dx, dy, shiftPx, scale);
}

function drawFrozenOverlay(inner, outer, dx, dy, shiftPx, scale) {
  const overlay = document.getElementById('frozenOverlay');
  if (!overlay) return;

  const ctx = overlay.getContext('2d');
  if (!ctx) return;

  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);

  // Рисуем эллипсы
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(outer.center.x, outer.center.y, outer.rx, outer.ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#ff00ff';
  ctx.beginPath();
  ctx.ellipse(inner.center.x, inner.center.y, inner.rx, inner.ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Рисуем вектор смещения
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(inner.center.x, inner.center.y);
  ctx.lineTo(outer.center.x, outer.center.y);
  ctx.stroke();

  // Точка центра
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.arc(inner.center.x, inner.center.y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Подпись смещения
  ctx.fillStyle = '#ff0000';
  ctx.font = '14px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`Смещение: \${(shiftPx * scale).toFixed(2)} мм`, inner.center.x + 10, inner.center.y - 10);
}

// КОНЕЦ ФАЙЛА
