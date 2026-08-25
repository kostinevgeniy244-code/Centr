// core.js
function processStream() {
  if (!isRunning) {
    requestAnimationFrame(processStream);
    return;
  }

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
  if (frameCounter % 30 === 0) console.log('Кадр №', frameCounter);

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
      if (area < 1000) continue; // фильтр по площади

      const perimeter = cv.arcLength(cnt, true);
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      if (circularity < 0.75) continue;
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

    // Сортируем: меньший — внутренний (дорн), больший — внешний (матрица)
    candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
    const inner = candidates[0];
    const outer = candidates[candidates.length - 1];

    const centerDist = Math.hypot(inner.center.x - outer.center.x, inner.center.y - outer.center.y);
    const avgRadiusOuter = (outer.rx + outer.ry) / 2;
    const offsetNorm = avgRadiusOuter > 0 ? centerDist / avgRadiusOuter : 0;
    const circAvg = (inner.circularity + outer.circularity) / 2;

    // Оценка кадра: чем ближе к 1 — тем лучше
    const score = 0.5 * circAvg + 0.5 * (1 - Math.min(offsetNorm, 1));

    if (score > bestScore) {
      bestScore = score;
      bestFrameData = ctx.getImageData(0, 0, w, h);
      stableCount = 0; // сброс стабильности
    } else {
      stableCount++;
    }

    // АВТОЗАМОРОЗКА: если N кадров подряд нет улучшения — фиксируем лучший
    if (stableCount >= STABLE_THRESHOLD && bestFrameData) {
      isRunning = false;
      startBtn.textContent = 'Старт (автозаморозка)';
      startBtn.classList.remove('processing');
      startBtn.classList.add('stopped');
      calculateOnFrozen(bestFrameData, w, h); // вызов из result.js
      return;
    }

    requestAnimationFrame(processStream);
  } catch (err) {
    console.error(err);
    setStatus('err', 'Ошибка обработки кадра. См. консоль.');
    isRunning = false;
  }
}
