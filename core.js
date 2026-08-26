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
  
  function processFrame() {
  if (!isRunning || !cvReady) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  
  if (!video || !canvas || !overlay) {
    stopProcessing();
    return;
  }

  const container = video.closest('.video-area');
  const w = container ? container.clientWidth : video.clientWidth;
  const h = container ? container.clientHeight : video.clientHeight;

  if (w === 0 || h === 0) {
    requestAnimationFrame(processFrame);
    return;
  }

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    overlay.width = w;
    overlay.height = h;
  }

  const ctx = canvas.getContext('2d');
  const oCtx = overlay.getContext('2d');

  // 1. Рисуем кадр из видео на canvas (источник данных)
  ctx.drawImage(video, 0, 0, w, h);

  // --- НАЧАЛО OPENCV ОБРАБОТКИ ---
  
  let srcMat = new cv.Mat(h, w, cv.CV_8UC4);
  let grayMat = new cv.Mat();
  let blurMat = new cv.Mat();
  let edgesMat = new cv.Mat();
  let contours = new cv.MatVector();
  
  try {
    // Копируем данные из canvas в матрицу
    const imageData = ctx.getImageData(0, 0, w, h);
    srcMat.data.set(imageData.data);

    // Предобработка: Серый -> Размытие (убираем шум) -> Канни (края)
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);
    
    // ВАЖНО: пороги для Canny нужно подбирать под освещение.
    // Для металла с бликами лучше брать высокий нижний порог.
    cv.Canny(blurMat, edgesMat, 50, 150); 

    // Ищем контуры (все линии на изображении)
    cv.findContours(edgesMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    oCtx.clearRect(0, 0, w, h);

    let bestMatrix = null;
    let bestDorn = null;

    // 2. Перебираем все найденные контуры и ищем эллипсы
    for (let i = 0; i < contours.size(); i++) {
      let cnt = contours.get(i);
      
      // Отсекаем слишком мелкие шумы (меньше 50 пикселей)
      if (cnt.total() < 50) continue;

      // Пытаемся аппроксимировать контур эллипсом
      // fitEllipse возвращает [center, axes, angle]
      try {
        let ellipse = cv.fitEllipse(cnt);
        
        // ellipse.center - {x, y}, ellipse.size - {width, height}
        // axes - это полуоси. Радиус = width/2
        
        // Логика выбора: 
        // 1. Матрица - самый большой эллипс (или в центре кадра)
        // 2. Дорн - эллипс поменьше, который находится ВНУТРИ матрицы
        
        let radius = Math.max(ellipse.size.width, ellipse.size.height) / 2;
        
        // Фильтр по размеру (подстрой под свою камеру, если детали другие)
        if (radius < 30 || radius > 300) continue; 

        if (!bestMatrix || radius > bestMatrix.radius) {
          bestMatrix = { ...ellipse, radius: radius };
        }
      } catch (e) {
        // Если fitEllipse не смог построить эллипс (кривой контур), пропускаем
        continue;
      }
    }

    // Если нашли Матрицу, ищем Дорн внутри неё
    if (bestMatrix) {
      // Рисуем Матрицу (Синий)
      drawEllipse(oCtx, bestMatrix, '#2563eb', 3);
      
      // Теперь ищем Дорн: ищем контуры, которые лежат внутри bestMatrix
      for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        if (cnt.total() < 30) continue;
        
        try {
          let ellipse = cv.fitEllipse(cnt);
          let radius = Math.max(ellipse.size.width, ellipse.size.height) / 2;
          
          // Дорн должен быть меньше матрицы и находиться внутри неё
          // Проверка: расстояние между центрами + радиус дорна < радиус матрицы
          let dist = Math.sqrt(
            Math.pow(ellipse.center.x - bestMatrix.center.x, 2) + 
            Math.pow(ellipse.center.y - bestMatrix.center.y, 2)
          );

          if (radius < bestMatrix.radius * 0.6 && (dist + radius) < bestMatrix.radius) {
            // Это кандидат на Дорн. Берем самый большой из подходящих
            if (!bestDorn || radius > bestDorn.radius) {
              bestDorn = { ...ellipse, radius: radius };
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Рисуем Дорн (Зеленый)
      if (bestDorn) {
        drawEllipse(oCtx, bestDorn, '#16a34a', 3);
        
        // --- РАСЧЕТ МЕТРИК ---
        
        const dornVal = parseFloat(document.getElementById('dornDiam').value) || 6.7;
        const matrVal = parseFloat(document.getElementById('matrDiam').value) || 10.4;
        
        // 1. Зазор (Gap) - считаем по введенным данным, так как масштаб пикселей неизвестен без калибровочной мишени
        const gapMkm = ((matrVal - dornVal) * 10).toFixed(2);
        
        // 2. Неравномерность (Non-uniformity)
        // Считаем как разницу радиусов в пикселях, переведенную в мм.
        // ВАЖНО: Тебе нужно один раз замерить: сколько пикселей соответствует 1 мм на твоей камере.
        // Допустим, 1 мм = 25 пикселей (подстрой это число!).
        const PIXELS_PER_MM = 25; 
        const radiusDiffPx = bestMatrix.radius - bestDorn.radius;
        const nonUniformMm = (radiusDiffPx / PIXELS_PER_MM).toFixed(3);

        // 3. Смещение (Shift)
        const shiftX = bestMatrix.center.x - bestDorn.center.x;
        const shiftY = bestMatrix.center.y - bestDorn.center.y;
        const shiftTotal = Math.sqrt(shiftX*shiftX + shiftY*shiftY);
        
        // Переводим смещение из пикселей в мм
        const shiftTotalMm = (shiftTotal / PIXELS_PER_MM).toFixed(2);
        const shiftXmm = (shiftX / PIXELS_PER_MM).toFixed(2);
        const shiftYmm = (shiftY / PIXELS_PER_MM).toFixed(2);

        // Вывод в UI
        document.getElementById('valGap').textContent = gapMkm + ' мкм';
        document.getElementById('valNonUniform').textContent = nonUniformMm + ' мм';
        document.getElementById('valShift').textContent = shiftTotalMm + ' мм';
        document.getElementById('valX').textContent = shiftXmm + ' мм';
        document.getElementById('valY').textContent = shiftYmm + ' мм';

      } else {
        document.getElementById('valGap').textContent = '—';
        document.getElementById('valNonUniform').textContent = 'Дорн не найден';
        document.getElementById('valShift').textContent = '—';
      }

    } else {
      document.getElementById('valGap').textContent = '—';
      document.getElementById('valNonUniform').textContent = 'Нет объектов';
      document.getElementById('valShift').textContent = '—';
    }

  } catch (err) {
    console.error('❌ Ошибка обработки:', err);
  } finally {
    srcMat.delete();
    grayMat.delete();
    blurMat.delete();
    edgesMat.delete();
    contours.delete();
  }

  // Вспомогательная функция для отрисовки эллипса из данных fitEllipse
  function drawEllipse(ctx, ellipse, color, width) {
    ctx.beginPath();
    ctx.save();
    ctx.translate(ellipse.center.x, ellipse.center.y);
    ctx.rotate(ellipse.angle * Math.PI / 180); // угол в радианы
    ctx.scale(1, 1); // масштаб осей уже учтен в size
    
    // Рисуем эллипс
    ctx.ellipse(0, 0, ellipse.size.width / 2, ellipse.size.height / 2, 0, 0, Math.PI * 2);
    
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    
    // Рисуем центр
    ctx.fillStyle = color;
    ctx.fillRect(ellipse.center.x - 4, ellipse.center.y - 4, 8, 8);
  }

  frameCount++;
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
