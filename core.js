let isRunning = false;
const STABLE_THRESHOLD = 15; // Сколько стабильных кадров нужно подряд
let stableCount = 0;
let bestFrameData = null;

// Кнопка Старт
document.getElementById('startBtn').addEventListener('click', () => {
  if (isRunning) {
    stopProcessing();
  } else {
    startProcessing();
  }
});

function startProcessing() {
  isRunning = true;
  stableCount = 0;
  bestFrameData = null;
  
  const btn = document.getElementById('startBtn');
  btn.classList.remove('stopped');
  btn.classList.add('processing');
  btn.textContent = 'Обработка...';
  
  updateStatus('warn', 'Анализ кадра...');
  processFrame();
}

function stopProcessing() {
  isRunning = false;
  const btn = document.getElementById('startBtn');
  btn.classList.remove('processing');
  btn.classList.add('stopped');
  btn.textContent = 'Стоп';
  updateStatus('ok', 'Обработка остановлена');
}

function processFrame() {
  if (!isRunning) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const oCtx = overlay.getContext('2d');

  // 1. Копируем видео в буфер OpenCV
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // --- ИМИТАЦИЯ OPENCV (Замени этот блок на реальный cv.Mat) ---
  // Здесь ты будешь делать cv.cvtColor, cv.threshold, cv.findContours и т.д.
  // Сейчас рисуем тестовые фигуры, чтобы ты видел, что оверлей работает
  oCtx.clearRect(0, 0, overlay.width, overlay.height);
  
  // Рисуем тестовый "дорн" (зеленый)
  oCtx.strokeStyle = '#16a34a';
  oCtx.lineWidth = 3;
  oCtx.beginPath();
  oCtx.ellipse(canvas.width / 2, canvas.height / 2, 100, 80, 0, 0, Math.PI * 2);
  oCtx.stroke();

  // Рисуем тестовую "матрицу" (синяя)
  oCtx.strokeStyle = '#2563eb';
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.ellipse(canvas.
