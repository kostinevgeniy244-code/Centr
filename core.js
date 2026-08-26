// core.js

// Глобальные переменные (если они не объявлены в init.js)
let isRunning = false;
let bestFrameData = null;
let bestScore = -1;
let stableCount = 0;
let frameCounter = 0;

const STABLE_THRESHOLD = 20;
const MIN_CIRCULARITY = 0.75; // Порог фильтрации контуров

// Элементы DOM (предполагается, что они уже получены в init.js, но дублируем для автономности файла)
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const oCtx = overlay.getContext('2d'); // Важно: overlay должен быть <canvas>

const startBtn = document.getElementById('startBtn');

/**
 * Функция отрисовки результатов детекции на оверлее
 * @param {Array} candidates - Все найденные кандидаты
 * @param {Object|null} inner - Выбранный внутренний объект (дорн)
 * @param {Object|null} outer - Выбранный внешний объект (матрица)
 */
function drawDetectionOverlay(candidates, inner, outer) {
  const w = canvas.width;
  const h = canvas.height;

  // Очищаем слой отрисовки
  oCtx.clearRect(0, 0, w, h);

  if (!candidates || candidates.length === 0) return;

  // 1. Рисуем ВСЕ кандидаты полупрозрачными оранжевыми эллипсами
  candidates.forEach(c => {
    oCtx.beginPath();
    oCtx.ellipse(c.center.x, c.center.y, c.rx, c.ry, 0, 0, Math.PI * 2);
    oCtx.strokeStyle = 'rgba(255, 128, 0, 0.6)'; // Оранжевый, 60% прозрачности
    oCtx.lineWidth = 1;
    oCtx.setLineDash([]);
    oCtx.stroke();
  });

  // 2. Если пара найдена (внутренний и внешний), рисуем их жирными линиями
  if (inner && outer) {
    // Внутренний (дорн) — сплошной зелёный
    oCtx.beginPath();
    oCtx.ellipse(inner.center.x, inner.center.y, inner.rx, inner.ry, 0, 0, Math.PI * 2);
    oCtx.strokeStyle = '#16a34a'; // Success Green
    oCtx.lineWidth = 3;
    oCtx.setLineDash([]);
    oCtx.stroke();

    // Внешний (матрица) — пунктирный синий
    oCtx.beginPath();
    oCtx.ellipse(outer.center.x, outer.center.y, outer.rx, outer.ry, 0, 0, Math.PI * 2);
    oCtx.strokeStyle = '#2563eb'; // Primary Blue
    oCtx.lineWidth = 3;
    oCtx.setLineDash([8, 8]); // Пунктир
    oCtx.stroke();

    // 3. Линия смещения центров (эксцентриситет) — красная
    oCtx.beginPath();
    oCtx.moveTo(inner.center.x, inner.center.y);
    oCtx.lineTo(outer.center.x, outer.center.y);
    oCtx.strokeStyle = 'rgba(220, 38, 38, 0.8)'; // Danger Red
    oCtx.lineWidth = 2;
    oCtx.setLineDash([]);
    oCtx.stroke();
    
    // Опционально: точка в центре внешнего для наглядности
    oCtx.fillStyle = '#2563eb';
    oCtx.beginPath();
    oCtx.arc(outer.center.x, outer.center.y, 4, 0, Math.PI*2);
    oCtx.fill();
  }
}

/**
 * Основная функция обработки потока
 */
function processStream() {
  if (!isRunning) {
    requestAnimationFrame(processStream);
    return;
  }

  // Проверка готовности видео
  if (video.readyState < 4 || video.videoWidth === 0 || video.videoHeight === 0) {
    setTimeout(() => requestAnimationFrame(processStream), 100);
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;

  // Синхронизация размеров буфера canvas с реальным размером видео
  canvas.width = w;
  canvas.height = h;
  
  // Копируем кадр из видео на canvas для обработки OpenCV
  ctx.drawImage(video, 0, 0, w, h);

  frameCounter++;
  if (frameCounter % 30 === 0) {
    console.log(`Кадр №${frameCounter} | Размер: ${w}x${h}`);
  }

  try {
    // --- OPENCV ОБРАБОТКА ---
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const thresh = new cv.Mat();
    // Адаптивный порог: инвертированный, чтобы объекты были белыми на черном фоне
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      
      // Фильтр 1: Минимальная площадь (защита от шума)
      if (area < 1000) continue; 

      const perimeter = cv.arcLength(cnt, true);
      // Защита от деления на ноль, хотя perimeter > 0 при area > 0
      if (perimeter === 0) continue;

      // Формула округлости: (4 * PI * Area) / Perimeter^2
      // Для идеального круга = 1.0
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      
      // Фильтр 2: Округлость
      if (circularity < MIN_CIRCULARITY) continue;
      
      // Фильтр 3: Минимальное количество точек в контуре
      if (cnt.total() < 5) continue;

      // Подгонка эллипса под контур
      const ellipse = cv.fitEllipse(cnt);
      candidates.push({
        center: { x: ellipse.center.x, y: ellipse.center.y },
        rx: ellipse.size.width / 2,
        ry: ellipse.size.height / 2,
        circularity: circularity
      });
    }

    // Освобождаем память OpenCV
    src.delete(); 
    gray.delete(); 
    thresh.delete(); 
    contours.delete(); 
    hierarchy.delete();

    // Даже если кандидатов мало, рисуем то, что есть (для отладки)
    let inner = null;
    let outer = null;

    if (candidates.length >= 2) {
      // Сортировка: по среднему радиусу (rx+ry)/2
      candidates.sort((a, b) => ((a.rx + a.ry) / 2) - ((b.rx + b.ry) / 2));
      inner = candidates[0];          // Самый маленький (дорн)
      outer = candidates[candidates.length - 1]; // Самый большой (матрица)
    } else if (candidates.length === 1) {
      // Если найден только один объект, считаем его и внутренним, и внешним для визуализации
      inner = outer = candidates[0];
    }

    // ОТРИСОВКА НА OVERLAY
    drawDetectionOverlay(candidates, inner, outer);

    // Логика оценки качества кадра и автозаморозки
    if (inner && outer) {
      const centerDist = Math.hypot(inner.center.x - outer.center.x, inner.center.y - outer.center.y);
      const avgRadiusOuter = (outer.rx + outer.ry) / 2;
      const offsetNorm = avgRadiusOuter > 0 ? centerDist / avgRadiusOuter : 0;
      const circAvg = (inner.circularity + outer.circularity) / 2;

      // Оценка кадра: 50% округлость + 50% центрирование (чем меньше смещение, тем лучше)
      const score = 0.5 * circAvg + 0.5 * (1 - Math.min(offsetNorm, 1));

      if (score > bestScore) {
        bestScore = score;
        // Сохраняем текущий кадр как "лучший"
        bestFrameData = ctx.getImageData(0, 0, w, h);
        stableCount = 0; // Сброс счетчика стабильности при улучшении
      } else {
        stableCount++;
      }

      // АВТОЗАМОРОЗКА: Если N кадров подряд нет улучшения, фиксируем лучший
      if (stableCount >= STABLE_THRESHOLD && bestFrameData) {
        console.log('Автозаморозка: найдено стабильное изображение');
        isRunning = false; // Останавливаем цикл обработки
        
        // Обновляем UI кнопки
        if(startBtn) {
          startBtn.textContent = 'Старт (автозаморозка)';
          startBtn.classList.remove('processing');
          startBtn.classList.add('stopped');
        }

        // Вызов функции расчета метрик (должна быть определена в result.js или здесь)
        if (typeof calculateOnFrozen === 'function') {
          calculateOnFrozen(bestFrameData, w, h);
        } else {
          console.warn('Функция calculateOnFrozen не найдена. Проверьте подключение result.js');
        }
        return; // Прерываем дальнейшую обработку
      }
    }

    // Рекурсивный вызов следующего кадра
    requestAnimationFrame(processStream);

  } catch (err) {
    console.error('Ошибка в processStream:', err);
    if (startBtn) {
      startBtn.classList.remove('processing');
      startBtn.classList.add('stopped');
    }
    isRunning = false;
  }
}
