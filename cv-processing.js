// cv-processing.js

import { CONFIG } from './config.js';

const CVProcessing = {
  cv: null, // ссылка на глобальный cv из OpenCV.js
  isReady: false,

  init(opencvModule) {
    this.cv = opencvModule;
    this.isReady = true;
    console.log('✅ OpenCV готов к обработке');
  },

  /**
   * Основной конвейер обработки кадра:
   * 1. Читаем кадр из video в cv.Mat (RGBA)
   * 2. Конвертируем в серый
   * 3. GaussianBlur
   * 4. Canny
   * 5. Морфологическое замыкание
   * 6. findContours
   * 7. Фильтрация по площади и круглости
   * 8. Разделение на матрицу и дорн по размеру
   * 9. Расчёт масштаба, смещения и неравномерности
   */
  processFrame(videoEl, overlayCanvas, inputParams) {
    if (!this.isReady || !videoEl || videoEl.paused || !videoEl.videoWidth) {
      return null;
    }

    const cv = this.cv;
    let srcMat = null, grayMat = null, edgesMat = null, closedMat = null;
    let contours = new cv.PointVectorVector();
    let hierarchy = new cv.Mat();

    try {
      // 1. Чтение кадра из video
      srcMat = cv.imread(videoEl); // RGBA

      // 2. Конвертация в серый
      grayMat = new cv.Mat();
      cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

      // 3. Размытие
      const blurSize = new cv.Size(5, 5);
      cv.GaussianBlur(grayMat, grayMat, blurSize, 0);

      // 4. Canny
      edgesMat = new cv.Mat();
      cv.Canny(grayMat, edgesMat, CONFIG.CANNY_THRESH_1, CONFIG.CANNY_THRESH_2);

      // 5. Морфологическое замыкание (закрытие разрывов контура)
      closedMat = new cv.Mat();
      const kernel = cv.getStructuringElement(
        cv.MORPH_RECT,
        new cv.Size(CONFIG.MORPH_KERNEL_SIZE, CONFIG.MORPH_KERNEL_SIZE)
      );
      cv.morphologyEx(edgesMat, closedMat, cv.MORPH_CLOSE, kernel);

      // 6. Поиск контуров
      cv.findContours(closedMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // 7. Отбор и фильтрация контуров: площадь и круглость
      const candidates = [];
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < CONFIG.MIN_CONTOUR_AREA) continue;

        const perimeter = cv.arcLength(cnt, true);
        if (perimeter === 0) continue;
        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
        if (circularity < CONFIG.CIRCULARITY_THRESHOLD) continue;

        // Вычисление ограничивающего прямоугольника и центра
        const rect = cv.boundingRect(cnt);
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        candidates.push({
          cnt,
          area,
          circularity,
          rect,
          center: new cv.Point(centerX, centerY),
          diameterPx: Math.sqrt(area / Math.PI) * 2, // приблизительный диаметр
        });
      }

      if (candidates.length < 2) {
        return null; // Недостаточно кандидатов
      }

      // Сортируем по площади (самый большой — матрица, следующий — дорн)
      candidates.sort((a, b) => b.area - a.area);
      const matrixObj = candidates[0];
      const dornObj = candidates[1];

      // Расчёт масштаба (мм/пиксель) по матрице
      const scaleMmPerPx = inputParams.matrixDiameter / matrixObj.diameterPx;
      if (scaleMmPerPx < CONFIG.MIN_SCALE_MM_PER_PX || scaleMmPerPx > CONFIG.MAX_SCALE_MM_PER_PX) {
        return null; // Масштаб вне допустимого диапазона
      }

      // Реальные размеры в мм
      const matrixDiamMm = matrixObj.diameterPx * scaleMmPerPx;
      const dornDiamMm = dornObj.diameterPx * scaleMmPerPx;

      // Смещение центров (в мм)
      const dxPx = matrixObj.center.x - dornObj.center.x;
      const dyPx = matrixObj.center.y - dornObj.center.y;
      const offsetMm = Math.sqrt(dxPx * dxPx + dyPx * dyPx) * scaleMmPerPx;

      // Неравномерность зазора: разница между ожидаемым и фактическим зазором
      // Ожидаемый зазор = (матрица - дорн) / 2
      const expectedGapMm = (matrixDiamMm - dornDiamMm) / 2;
      // Фактический зазор в точке минимального расстояния (грубая оценка через смещение)
      const actualGapMm = expectedGapMm - offsetMm; // упрощённая модель
      const unevennessMm = Math.abs(expectedGapMm - actualGapMm);

      // Отрисовка оверлея
      this.drawOverlay(overlayCanvas, matrixObj, dornObj, scaleMmPerPx);

      return {
        matrixDiam: matrixDiamMm,
        dornDiam: dornDiamMm,
        offset: offsetMm,
        unevenness: unevennessMm,
        scale: scaleMmPerPx,
        centers: {
          matrix: { x: matrixObj.center.x, y: matrixObj.center.y },
          dorn: { x: dornObj.center.x, y: dornObj.center.y },
        },
      };
    } catch (err) {
      console.error('❌ Ошибка обработки кадра:', err);
      return null;
    } finally {
      // Освобождение памяти
      if (srcMat) srcMat.delete();
      if (grayMat) grayMat.delete();
      if (edgesMat) edgesMat.delete();
      if (closedMat) closedMat.delete();
      contours.delete();
      hierarchy.delete();
    }
  },

  drawOverlay(canvas, matrixObj, dornObj, scaleMmPerPx) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Очистка оверлея
    ctx.clearRect(0, 0, w, h);

    // Вспомогательная сетка (опционально)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Рисуем контуры
    const drawContour = (cnt, color, label) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < cnt.size(); i++) {
        const p = cnt.get(i);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();

      // Центр
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Подпись
      ctx.fillStyle = '#000';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, p.x, p.y - 10);
    };

    drawContour(matrixObj.cnt, 'rgba(0,170,255,0.8)', 'Матрица');
    drawContour(dornObj.cnt, 'rgba(100,255,100,0.8)', 'Дорн');

    // Линия смещения
    ctx.strokeStyle = 'rgba(255,165,0,0.9)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(matrixObj.center.x, matrixObj.center.y);
    ctx.lineTo(dornObj.center.x, dornObj.center.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Текст с масштабом
    ctx.fillStyle = 'white';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(10, h - 30, 160, 24);
    ctx.fillStyle = 'white';
    ctx.fillText(`Масштаб: ${scaleMmPerPx.toFixed(3)} мм/пкс`, 15, h - 8);
  },
};

export { CVProcessing };
logLoad('cv-processing.js — подключён', 'ok');


// Конец файла