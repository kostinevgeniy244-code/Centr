console.log('core.js: загрузка');

let isRunning = false;
let frameCount = 0;

function initHandlers() {
  const btnStart = document.getElementById('startBtn');
  const btnReset = document.getElementById('resetBtn');

  console.log('🔍 Элементы:', {
    startBtn: btnStart,
    resetBtn: btnReset,
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    overlay: document.getElementById('overlay'),
    frozenImg: document.getElementById('frozenImg')
  });

  if (!btnStart) {
    console.error('❌ #startBtn не найден');
    return;
  }

  btnStart.addEventListener('click', () => {
    console.log('🖱️ Клик Старт');
    if (isRunning) {
      stopProcessing();
    } else {
      startProcessing();
    }
  });

  if (!btnReset) {
    console.error('❌ #resetBtn не найден — сброс не будет работать');
    return;
  } else {
    console.log('✅ #resetBtn найден, вешаем обработчик');
    btnReset.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('🔄 Клик Сброс');
      resetView();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM загружен, инициализируем...');
  initHandlers();
});

function startProcessing() {
  isRunning = true;
  frameCount = 0;
  updateButtonState('processing', 'Обработка...');
  updateStatus('warn', 'Анализ кадра...');
  processFrame();
}

function stopProcessing() {
  isRunning = false;
  updateButtonState('stopped', 'Стоп (нажмите для старта)');
}

function resetView() {
  console.log('🚀 resetView(): начало сброса');
  isRunning = false;
  frameCount = 0;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const frozenImg = document.getElementById('frozenImg');
  const appWrapper = document.querySelector('.app-wrapper');

  // Гарантированно показываем нужные слои
  if (video) video.style.display = 'block';
  if (canvas) canvas.style.display = 'block';
  if (overlay) overlay.style.display = 'block';
  if (frozenImg) frozenImg.style.display = 'none';
  if (appWrapper) appWrapper.classList.remove('frozen-mode');

  updateButtonState('default', 'Старт (автозаморозка)');
  updateStatus('ok', 'Камера готова');
  console.log('✅ resetView(): состояние сброшено');
}

function updateButtonState(mode, text) {
  const btn = document.getElementById('startBtn');
  if (!btn) return;
  btn.classList.remove('processing');
  btn.classList.remove('stopped');
  if (mode === 'processing') btn.classList.add('processing');
  else if (mode === 'stopped') btn.classList.add('stopped');
  btn.textContent = text;
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (!dot || !txt) return;
  dot.className = 'dot ' + (type === 'warn' ? 'status-warn' : (type === 'err' ? 'status-err' : 'status-ok'));
  txt.textContent = text;
}

function processFrame() {
// Глобальная переменная для хранения состояния OpenCV
let cvReady = false;

// Инициализация OpenCV (вызывается автоматически при загрузке opencv.js)
if (typeof cv !== 'undefined') {
  cvReady = true;
  console.log('✅ OpenCV загружен и готов к работе');
} else {
  console.warn('⚠️ OpenCV еще не загружен. Ждем...');
}

function processFrame() {
  if (!isRunning || !cvReady) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  
  if (!video || !canvas || !overlay) {
    stopProcessing();
    return;
  }

  // 1. Получаем размеры области видео (НЕ видео тега, а контейнера)
  const container = video.closest('.video-area');
  const w = container ? container.clientWidth : video.clientWidth;
  const h = container ? container.clientHeight : video.clientHeight;

  if (w === 0 || h === 0) {
    requestAnimationFrame(processFrame);
    return;
  }

  // 2. Синхронизируем размеры канвасов (важно для OpenCV и отрисовки)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    overlay.width = w;
    overlay.height = h;
  }

  const ctx = canvas.getContext('2d');
  const oCtx = overlay.getContext('2d');

  // Рисуем кадр из видео на canvas (это вход для OpenCV)
  ctx.drawImage(video, 0, 0, w, h);

  // --- НАЧАЛО РЕАЛЬНОЙ ОБРАБОТКИ OPENCV ---
  
  // Создаем матрицы OpenCV
  let srcMat = new cv.Mat(h, w, cv.CV_8UC4);
  let grayMat = new cv.Mat();
  let circles = new cv.Mat();

  try {
    // Копируем данные из canvas в матрицу OpenCV
    const imageData = ctx.getImageData(0, 0, w, h);
    srcMat.data.set(imageData.data);

    // Конвертируем в оттенки серого (для поиска кругов)
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

    // НАСТРОЙКИ ПОИСКА КРУГОВ (Самое важное место!)
    // param1 и param2 нужно подбирать под качество камеры и освещение
    // Чем меньше param2, тем больше кругов найдет (но больше ложных)
    let dp = 1.0; 
    let minDist = 50; // Минимальное расстояние между центрами кругов
    let param1 = 50;  // Верхний порог для детектора краев Canny
    let param2 = 30;  // Аккумулирующий порог (чем меньше, тем чувствительнее)
    let minRadius = 20; // Минимальный радиус круга в пикселях
    let maxRadius = 200; // Максимальный радиус

    // Ищем круги: HoughCircles(image, circles, method, dp, minDist, param1, param2, minRadius, maxRadius)
    cv.HoughCircles(grayMat, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minRadius, maxRadius);

    // Очищаем оверлей перед новой отрисовкой
    oCtx.clearRect(0, 0, w, h);

    // Если круги найдены
    if (circles.rows > 0) {
      // circles.data содержит [x, y, radius] для каждого найденного круга
      // Данные идут подряд: x1, y1, r1, x2, y2, r2...
      const data = circles.data;
      
      // Сортируем найденные круги по радиусу (от большего к меньшему)
      // Это нужно, чтобы первым взять самый большой круг (скорее всего, это матрица)
      let foundCircles = [];
      for (let i = 0; i < circles.rows; i++) {
        let idx = i * 3;
        foundCircles.push({
          x: data[idx],
          y: data[idx + 1],
          r: data[idx + 2]
        });
      }
      
      foundCircles.sort((a, b) => b.r - a.r);

      // Берем самый большой круг как "Матрицу"
      let matr = foundCircles;
      // Берем второй по величине как "Дорн" (если он есть)
      let dorn = foundCircles.length > 1 ? foundCircles : null;

      // --- ОТРИСОВКА РЕЗУЛЬТАТОВ ---
      
      // 1. Рисуем контур Матрицы (Синий)
      oCtx.beginPath();
      oCtx.arc(matr.x, matr.y, matr.r, 0, Math.PI * 2);
      oCtx.strokeStyle = '#2563eb'; // Синий
      oCtx.lineWidth = 3;
      oCtx.stroke();
      
      // Центр матрицы
      oCtx.fillStyle = '#2563eb';
      oCtx.fillRect(matr.x - 4, matr.y - 4, 8, 8);

      // 2. Рисуем контур Дорна (Зеленый), если найден
      if (dorn) {
        oCtx.beginPath();
        oCtx.arc(dorn.x, dorn.y, dorn.r, 0, Math.PI * 2);
        oCtx.strokeStyle = '#16a34a'; // Зеленый
        oCtx.lineWidth = 3;
        oCtx.stroke();

        // Центр дорна
        oCtx.fillStyle = '#16a34a';
        oCtx.fillRect(dorn.x - 4, dorn.y - 4, 8, 8);

        // --- РАСЧЕТ МЕТРИК НА ОСНОВЕ НАЙДЕННЫХ КРУГОВ ---
        
        // 1. Зазор (Gap)
        // В реальности нужно знать масштаб: сколько пикселей в 1 мм.
        // Пока сделаем упрощенно: считаем, что пользователь ввел правильные диаметры,
        // а мы проверяем только геометрию смещения.
        // Но если нужно считать зазор по пикселям, нужна калибровочная мишень.
        // Здесь мы просто берем значения из инпутов, но показываем их рядом с объектом.
        
        const dornVal = parseFloat(document.getElementById('dornDiam').value) || 6.7;
        const matrVal = parseFloat(document.getElementById('matrDiam').value) || 10.4;
        
        // Реальный зазор в мкм
        const gapMkm = ((matrVal - dornVal) * 10).toFixed(2);
        
        // Неравномерность (разница радиусов в мм, переведенная в условные единицы)
        // Это примерная логика, так как без калибровки в мм нельзя.
        const radiusDiffPx = matr.r - dorn.r; 
        // Допустим, 10 пикселей = 1 мм (это нужно калибровать!)
        const nonUniformMm = (radiusDiffPx / 10.0).toFixed(3); 

        // Смещение центров (Shift)
        const shiftX = (matr.x - dorn.x).toFixed(2);
        const shiftY = (matr.y - dorn.y).toFixed(2);
        const shiftTotal = Math.sqrt(shiftX*shiftX + shiftY*shiftY).toFixed(2);

        // Выводим в интерфейс
        document.getElementById('valGap').textContent = gapMkm + ' мкм';
        document.getElementById('valNonUniform').textContent = nonUniformMm + ' мм';
        document.getElementById('valShift').textContent = shiftTotal + ' мм';
        document.getElementById('valX').textContent = shiftX + ' px'; // Или перевести в мм
        document.getElementById('valY').textContent = shiftY + ' px';

      } else {
        // Если дорн не найден, пишем предупреждение
        document.getElementById('valGap').textContent = '—';
        document.getElementById('valNonUniform').textContent = 'Не найден дорн';
        document.getElementById('valShift').textContent = '—';
      }

    } else {
      // Круги не найдены
      document.getElementById('valGap').textContent = '—';
      document.getElementById('valNonUniform').textContent = 'Нет объектов';
      document.getElementById('valShift').textContent = '—';
    }

  } catch (err) {
    console.error('❌ Ошибка OpenCV:', err);
  } finally {
    // Освобождаем память (обязательно для OpenCV в браузере)
    srcMat.delete();
    grayMat.delete();
    circles.delete();
  }

  // --- КОНЕЦ OPENCV ---

  frameCount++;
  
  // Автостоп через N кадров (чтобы не грузить CPU бесконечно)
  if (frameCount >= 15) {
    freezeUI(w, h);
    stopProcessing();
    frameCount = 0;
    return;
  }

  requestAnimationFrame(processFrame);
}


  

function freezeUI(w, h) {
  const frozenImg = document.getElementById('frozenImg');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');

  if (!frozenImg) {
    console.error('❌ frozenImg не найден');
    return;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');

  tempCtx.drawImage(video, 0, 0, w, h);
  tempCtx.drawImage(canvas, 0, 0, w, h);
  tempCtx.drawImage(overlay, 0, 0, w, h);

  tempCanvas.toBlob(blob => {
    if (!blob) {
      console.error('❌ toBlob вернул null');
      return;
    }
    const url = URL.createObjectURL(blob);
    frozenImg.src = url;
    frozenImg.onload = () => URL.revokeObjectURL(url);
  }, 'image/png');

  if (video) video.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  frozenImg.style.display = 'block';

  const appWrapper = document.querySelector('.app-wrapper');
  if (appWrapper) appWrapper.classList.add('frozen-mode');
}

function calculateMetrics() {
  const dornVal = parseFloat(document.getElementById('dornDiam').value) || 40;
  const matrVal = parseFloat(document.getElementById('matrDiam').value) || 50;

  const gap = ((matrVal - dornVal) * 10).toFixed(2);
  const nonUniform = (Math.random() * 0.5).toFixed(3);
  const shift = (Math.random() * 2).toFixed(2);

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setVal('valGap', gap + ' мкм');
  setVal('valNonUniform', nonUniform + ' мм');
  setVal('valShift', shift + ' мм');
  setVal('valX', (Math.random() * 4 - 2).toFixed(2) + ' мм');
  setVal('valY', (Math.random() * 4 - 2).toFixed(2) + ' мм');
}
