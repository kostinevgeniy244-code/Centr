console.log('core.js: загрузка');

let isRunning = false;
let frameCount = 0;

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('startBtn');
  if (!btn) {
    console.error('Кнопка #startBtn не найдена!');
    return;
  }

  btn.addEventListener('click', () => {
    console.log('Клик по кнопке');
    if (isRunning) {
      stopProcessing();
    } else {
      startProcessing();
    }
  });
});

function startProcessing() {
  isRunning = true;
  frameCount = 0;

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

  // 1. Копируем кадр из видео в canvas (буфер для OpenCV)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. Очищаем оверлей перед новой отрисовкой
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  // --- ОТРИСОВКА В ТЕХ ЖЕ КООРДИНАТАХ, ЧТО И ВИДЕО ---
  
  // Рисуем «дорн» (зелёный эллипс) — центр кадра
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

  // Подпись текстом
  oCtx.fillStyle = 'white';
  oCtx.font = '16px Arial';
  oCtx.fillText('Дорн (тест)', 20, 40);
  oCtx.fillStyle = 'rgba(0,0,0,0.6)';
  oCtx.fillRect(15, 25, 130, 22);
