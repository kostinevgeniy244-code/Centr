console.log('core.js: загрузка началась');

let isRunning = false;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM готов, ищем кнопку...');
  const btn = document.getElementById('startBtn');

  if (!btn) {
    console.error('ОШИБКА: кнопка #startBtn не найдена в HTML!');
    return;
  }

  console.log('Кнопка найдена:', btn);

  btn.addEventListener('click', () => {
    console.log('Клик по кнопке получен!');

    if (isRunning) {
      // СТОП
      isRunning = false;
      btn.classList.remove('processing');
      btn.classList.add('stopped');
      btn.textContent = 'Стоп (нажмите для старта)';
      document.getElementById('statusText').textContent = 'Остановлено';
      document.getElementById('statusDot').className = 'dot status-ok';
    } else {
      // СТАРТ
      isRunning = true;
      btn.classList.remove('stopped');
      btn.classList.add('processing');
      btn.textContent = 'Обработка...';
      document.getElementById('statusText').textContent = 'Анализ кадра...';
      document.getElementById('statusDot').className = 'dot status-warn';

      // Сразу запускаем цикл отрисовки (даже без OpenCV)
      processFrame();
    }
  });
});

function processFrame() {
  if (!isRunning) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');

  // Проверка, что элементы существуют
  if (!video || !canvas || !overlay) {
    console.error('Не найдены video/canvas/overlay');
    stopProcessing();
    return;
  }

  const ctx = canvas.getContext('2d');
  const oCtx = overlay.getContext('2d');

  // Копируем кадр
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Очищаем оверлей
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  // Рисуем тестовые фигуры (чтобы ты видел реакцию)
  oCtx.strokeStyle = '#16a34a';
  oCtx.lineWidth = 3;
  oCtx.beginPath();
  oCtx.ellipse(canvas.width / 2, canvas.height / 2, 100, 80, 0, 0, Math.PI * 2);
  oCtx.stroke();

  oCtx.strokeStyle = '#2563eb';
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.ellipse(canvas.width / 2, canvas.height / 2, 120, 100, 0, 0, Math.PI * 2);
  oCtx.stroke();

  // Через 15 кадров делаем «заморозку» (для теста)
  if (window.frameCount === undefined) window.frameCount = 0;
  window.frameCount++;

  if (window.frameCount >= 15) {
    freezeUI(ctx.getImageData(0, 0, canvas.width, canvas.height));
    stopProcessing();
    window.frameCount = 0;
    return;
  }

  requestAnimationFrame(processFrame);
}

function stopProcessing() {
  isRunning = false;
}

function freezeUI(imageData) {
  const frozenImg = document.getElementById('frozenImg');
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

  document.getElementById('video').style.display = 'none';
  document.getElementById('canvas').style.display = 'none';
  document.getElementById('overlay').style.display = 'none';
  frozenImg.style.display = 'block';
}
