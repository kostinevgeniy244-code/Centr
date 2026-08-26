let isRunning = false;
const STABLE_THRESHOLD = 15;
let stableCount = 0;
let bestFrameData = null;

// Гарантированно ждём DOM, прежде чем вешать обработчики
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('startBtn');
  if (!btn) {
    console.error('Кнопка startBtn не найдена');
    return;
  }

  btn.addEventListener('click', () => {
    if (isRunning) {
      stopProcessing();
    } else {
      startProcessing();
    }
  });
});

function startProcessing() {
  isRunning = true;
  stableCount = 0;
  bestFrameData = null;

  const btn = document.getElementById('startBtn');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');

  if (btn) {
    btn.classList.remove('stopped');
    btn.classList.add('processing');
    btn.textContent = 'Обработка...';
  }
  if (statusText) statusText.textContent = 'Анализ кадра...';
  if (statusDot) statusDot.className = 'dot status-warn';

  // Запускаем цикл обработки
  processFrame();
}

function stopProcessing() {
  isRunning = false;
  const btn = document.getElementById('startBtn');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');

  if (btn) {
    btn.classList.remove('processing');
    btn.classList.add('stopped');
    btn.textContent = 'Стоп (нажмите для старта)';
  }
  if (statusText) statusText.textContent = 'Остановлено';
  if (statusDot) statusDot.className = 'dot status-ok';
}

function processFrame() {
  if (!isRunning) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');

  if (!video || !canvas || !overlay) {
    console.error('Не найдены video/canvas/overlay');
    stopProcessing();
    return;
  }

  const ctx = canvas.getContext('2d');
  const oCtx = overlay.getContext('2d');

  // 1. Копируем кадр из видео в canvas (буфер OpenCV)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // --- ЗАГЛУШКА ПОД OPENCV ---
  // Здесь будет реальная логика: cv.cvtColor, cv.threshold, cv.findContours и т.д.
  // Пока рисуем тестовые фигуры, чтобы видеть, что цикл работает
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  // Рисуем «дорн» (зелёный эллипс)
  oCtx.strokeStyle = '#16a34a';
  oCtx.lineWidth = 3;
  oCtx.beginPath();
  oCtx.ellipse(canvas.width / 2, canvas.height / 2, 100, 80, 0, 0, Math.PI * 2);
  oCtx.stroke();

  // Рисуем «матрицу» (синий эллипс побольше)
  oCtx.strokeStyle = '#2563eb';
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.ellipse(canvas.width / 2, canvas.height / 2, 120, 100, 0, 0, Math.PI * 2);
  oCtx.stroke();

  // Имитация «автозаморозки» по стабильности
  // В реальном коде сюда подставишь логику сравнения кадров
  stableCount++;
  if (stableCount >= STABLE_THRESHOLD) {
    // Сохраняем текущий кадр как «лучший»
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bestFrameData = imageData;

    // Вызываем заморозку UI
    freezeUI(imageData);

    // Считаем метрики (заглушка)
    calculateMetrics(imageData, canvas.width, canvas.height);

    stopProcessing(); // останавливаем обработку
    return;
  }

  // Следующий кадр через requestAnimationFrame (плавно и без перегрузки CPU)
  requestAnimationFrame(processFrame);
}

// Функция заморозки UI (показывает frozenImg, скрывает видео и оверлей)
function freezeUI(imageData) {
  const frozenImg = document.getElementById('frozenImg');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');

  if (!frozenImg) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  tempCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    frozenImg.src = url;
    frozenImg.onload = () => URL.revokeObjectURL(url);
  }, 'image/png');

  // Переключаем видимость слоёв
  if (video) video.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  frozenImg.style.display = 'block';

  if (statusText) statusText.textContent = 'Кадр заморожен';
  if (statusDot) statusDot.className = 'dot status-ok';
}

// Заглушка расчёта метрик (чтобы видеть реакцию)
function calculateMetrics(imageData, width, height) {
  // Сюда подставишь реальную логику расчёта зазора, неравномерности и смещения
  const gap = ((50 - 40) * 10).toFixed(2); // пример: (матр − дорн) * масштаб
  const nonUniform = (Math.random() * 0.5).toFixed(3);
  const shift = (Math.random() * 2).toFixed(2);

  document.getElementById('valGap').textContent = gap + ' мкм';
  document.getElementById('valNonUniform').textContent = nonUniform + ' мм';
  document.getElementById('valShift').textContent = shift + ' мм';
  document.getElementById('valX').textContent = (Math.random() * 4 - 2).toFixed(2) + ' мм';
  document.getElementById('valY').textContent = (Math.random() * 4 - 2).toFixed(2) + ' мм';
}
