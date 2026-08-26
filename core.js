console.log('core.js: загрузка');

let isRunning = false;
let frameCount = 0;

document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('startBtn');
  const btnReset = document.getElementById('resetBtn');

  if (!btnStart) {
    console.error('Кнопка #startBtn не найдена!');
    return;
  }

  // Обработчик СТАРТ
  btnStart.addEventListener('click', () => {
    console.log('Клик по кнопке Старт');
    if (isRunning) {
      stopProcessing();
    } else {
      startProcessing();
    }
  });

  // Обработчик СБРОС
  if (btnReset) {
    btnReset.addEventListener('click', resetView);
  }
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
  // Статус можно оставить как есть или вернуть в «Остановлено»
}

function resetView() {
  console.log('Сброс: возврат к видеопотоку');
  isRunning = false;
  frameCount = 0;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const frozenImg = document.getElementById('frozenImg');
  const appWrapper = document.querySelector('.app-wrapper');

  // Показываем видео и слои отрисовки
  if (video) video.style.display = 'block';
  if (canvas) canvas.style.display = 'block';
  if (overlay) overlay.style.display = 'block';

  // Скрываем замороженный кадр
  if (frozenImg) frozenImg.style.display = 'none';

  // Убираем класс frozen-mode, чтобы кнопка сброса могла исчезнуть (если используешь скрытие)
  if (appWrapper) appWrapper.classList.remove('frozen-mode');

  // Возвращаем кнопку в исходное состояние
  updateButtonState('default', 'Старт (автозаморозка)');

  // Обновляем статус
  updateStatus('ok', 'Камера готова');
}

function updateButtonState(mode, text) {
  const btn = document.getElementById('startBtn');
  if (!btn) return;

  btn.classList.remove('processing');
  btn.classList.remove('stopped');

  if (mode === 'processing') {
    btn.classList.add('processing');
  } else if (mode === 'stopped') {
    btn.classList.add('stopped');
  }
  // Для 'default' классы не добавляем — будет базовый синий цвет

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

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  // Тестовая отрисовка (эллипсы)
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

  // Автозаморозка через 15 кадров
  frameCount++;
  if (frameCount >= 15) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    freezeUI(imageData);
    calculateMetrics();
    stopProcessing();
    frameCount = 0;
    return;
  }

  requestAnimationFrame(processFrame);
}

function freezeUI(imageData) {
  const frozenImg = document.getElementById('frozenImg');
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  const appWrapper = document.querySelector('.app-wrapper');

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

  // Переключаем видимость
  if (video) video.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  frozenImg.style.display = 'block';

  // Добавляем класс, чтобы кнопка сброса была видна (если используешь скрытие по классу)
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
