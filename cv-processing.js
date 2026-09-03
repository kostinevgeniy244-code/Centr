if (typeof logLoad === 'function') {
  logLoad('cv-processing.js — подключён', 'ok');
}

export const CVProcessing = {
  cv: null,
  initialized: false,

  init(opencvModule) {
    this.cv = opencvModule;
    this.initialized = true;
    console.log('✅ CVProcessing инициализирован');
    if (typeof logLoad === 'function') {
      logLoad('CVProcessing — инициализирован', 'ok');
    }
  },

  /**
   * Основной метод обработки кадра.
   * Возвращает объект результата или null, если объекты не найдены.
   */
  processFrame(videoEl, overlayCanvas, params) {
    if (!this.initialized || !this.cv) {
      console.warn('⚠️ OpenCV ещё не инициализирован');
      return null;
    }

    const { matrixDiameter, dornDiameter, toleranceOffset, toleranceUneven } = params;

    // Читаем кадр из видео в cv.Mat
    const src = this.cv.imread(videoEl);
    if (src.empty()) {
      cleanupMats([src]);
      return null;
    }

    try {
      // 1. Уменьшаем кадр до рабочего разрешения для скорости на мобильном
      const PROCESS_WIDTH = CONFIG.PROCESS_WIDTH;
      const PROCESS_HEIGHT = CONFIG.PROCESS_HEIGHT;

      const smallSize = new this.cv.Size(PROCESS_WIDTH, PROCESS_HEIGHT);
      const resized = new this.cv.Mat();
      this.cv.resize(src, resized, smallSize, this.cv.INTER_LINEAR);

      // Сохраняем реальные размеры resized для корректной отрисовки
      const resizedWidth = resized.cols;
      const resizedHeight = resized.rows;

      // 2. Конвертируем в оттенки серого
      const gray = new this.cv.Mat();
      this.cv.cvtColor(resized, gray, this.cv.COLOR_RGBA2GRAY);

      // 3. Canny-детектор границ
      const edges = new this.cv.Mat();
      this.cv.Canny(gray, edges, CONFIG.CANNY_THRESH_1, CONFIG.CANNY_THRESH_2);

      // 4. Морфологическое замыкание, чтобы закрыть разрывы в контурах
      const kernel = this.cv.getStructuringElement(
        this.cv.MORPH_RECT,
        new this.cv.Size(CONFIG.MORPH_KERNEL_SIZE, CONFIG.MORPH_KERNEL_SIZE)
      );
      const closed = new this.cv.Mat();
      this.cv.morphologyEx(edges, closed, this.cv.MORPH_CLOSE, kernel);

      // 5. Поиск контуров
      const contours = new this.cv.MatVector();
      const hierarchy = new this.cv.Mat();
      this.cv.findContours(closed, contours, hierarchy, this.cv.RETR_EXTERNAL, this.cv.CHAIN_APPROX_SIMPLE);

      let matrixObj = null;
      let dornObj = null;

      // 6. Анализ контуров: ищем два круга (матрица и дорн)
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = this.cv.contourArea(cnt);

        if (area < CONFIG.MIN_CONTOUR_AREA) continue;

        // Вычисляем круглость: 4π * площадь / периметр²
        const perimeter = this.cv.arcLength(cnt, true);
        if (perimeter === 0) continue;
        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

        if (circularity < CONFIG.CIRCULARITY_THRESHOLD) continue;

        const candidate = {
          contour: cnt,
          area,
          circularity,
          boundingRect: this.cv.boundingRect(cnt), // {x, y, width, height}
        };

        if (!matrixObj || area > matrixObj.area) {
          if (matrixObj) dornObj = matrixObj; // сдвигаем старый «больший» в «меньший»
          matrixObj = candidate;
        } else if (!dornObj || area > dornObj.area) {
          dornObj = candidate;
        }
      }

      if (!matrixObj || !dornObj) {
        cleanupMats([src, resized, gray, edges, closed, kernel, contours, hierarchy]);
        return null;
      }

      // 7. Вычисляем центры и диаметры в пикселях
      const getCenter = (rect) => {
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      };

      const mCenter = getCenter(matrixObj.boundingRect);
      const dCenter = getCenter(dornObj.boundingRect);

      // Диаметр по bounding box (грубая оценка)
      const matrixDiamPx = Math.max(matrixObj.boundingRect.width, matrixObj.boundingRect.height);
      const dornDiamPx = Math.max(dornObj.boundingRect.width, dornObj.boundingRect.height);

      // Оценка масштаба: мм/пиксель (по известному диаметру от оператора)
      // Используем матрицу как опорный объект для калибровки масштаба
      const scaleMmPerPx = matrixDiameter / matrixDiamPx;

      // Проверка разумности масштаба (защита от ошибок детекции)
      if (scaleMmPerPx < CONFIG.MIN_SCALE_MM_PER_PX || scaleMmPerPx > CONFIG.MAX_SCALE_MM_PER_PX) {
        cleanupMats([src, resized, gray, edges, closed, kernel, contours, hierarchy]);
        return null;
      }

      // Перевод в мм
      const matrixDiamMm = matrixDiamPx * scaleMmPerPx;
      const dornDiamMm = dornDiamPx * scaleMmPerPx;

      // Смещение центров в мм
      const dxPx = mCenter.x - dCenter.x;
      const dyPx = mCenter.y - dCenter.y;
      const offsetMm = Math.sqrt(dxPx * dxPx + dyPx * dyPx) * scaleMmPerPx;

      // Неравномерность зазора — упрощённо как разница диаметров (в мм)
      const unevennessMm = Math.abs(matrixDiamMm - dornDiamMm);

      // 8. Отрисовка на оверлей-канвасе (в масштабе оригинального видео)
      this.drawOverlay(overlayCanvas, videoEl, matrixObj, dornObj, scaleMmPerPx, resizedWidth, resizedHeight);

      cleanupMats([src, resized, gray, edges, closed, kernel, contours, hierarchy]);

      return {
        matrixDiam: matrixDiamMm,
        dornDiam: dornDiamMm,
        offset: offsetMm,
        unevenness: unevennessMm,
      };
    } catch (err) {
      console.error('❌ Ошибка обработки кадра:', err);
      cleanupMats([src]);
      return null;
    }
  },

  /**
   * Отрисовка контуров, центров и размеров на оверлей-канвасе.
   * Канвас overlayCanvas должен иметь те же размеры, что и videoEl.
   */
  drawOverlay(canvasEl, videoEl, matrixObj, dornObj, scaleMmPerPx, resizedW, resizedH) {
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Динамическое масштабирование под реальные размеры уменьшенного кадра
    const scaleX = canvasEl.width / resizedW;
    const scaleY = canvasEl.height / resizedH;

    const drawContour = (obj, color, label) => {
      const rect = obj.boundingRect;
      // Масштабируем координаты под размер канваса
      const x = rect.x * scaleX;
      const y = rect.y * scaleY;
      const w = rect.width * scaleX;
      const h = rect.height * scaleY;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Центр
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx.fill();

      // Подпись рядом с объектом (без стрелок, прямо рядом с местом измерения)
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Чтобы текст не накладывался, немного сдвигаем его вверх
      ctx.fillText(label, cx, cy - 16);
    };

    drawContour(matrixObj, '#2ecc71', `М: ${matrixObj.boundingRect.width.toFixed(1)}px`);
    drawContour(dornObj, '#e74c3c', `Д: ${dornObj.boundingRect.width.toFixed(1)}px`);

    // Линия смещения
    const mRect = matrixObj.boundingRect;
    const dRect = dornObj.boundingRect;
    const mx = (mRect.x + mRect.width / 2) * scaleX;
    const my = (mRect.y + mRect.height / 2) * scaleY;
    const dx = (dRect.x + dRect.width / 2) * scaleX;
    const dy = (dRect.y + dRect.height / 2) * scaleY;

    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(dx, dy);
    ctx.stroke();
    ctx.setLineDash([]);
  },
};

// Вспомогательная функция для очистки cv.Mat (чтобы не было утечек памяти в браузере)
function cleanupMats(mats) {
  if (!Array.isArray(mats)) return;
  mats.forEach(mat => {
    if (mat && typeof mat.empty === 'function' && !mat.empty()) {
      try {
        mat.delete();
      } catch (e) {
        console.warn('⚠️ Не удалось удалить cv.Mat:', e);
      }
    }
  });
}