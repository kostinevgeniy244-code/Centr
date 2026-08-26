console.log('core.js: загрузка');

let isRunning = false;
let frameCount = 0;

function initHandlers() {
  const btnStart = document.getElementById('startBtn');
  const btnReset = document.getElementById('resetBtn');

  console.log('🔍 Проверка элементов:', {
    startBtn: btnStart,
    resetBtn: btnReset,
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    overlay: document.getElementById('overlay'),
    frozenImg: document.getElementById('frozenImg')
  });

  if (!btnStart) {
    console.error('❌ Не найдена кнопка #startBtn');
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
    console.error('❌ Не найдена кнопка #resetBtn — сброс не будет работать');
    return;
  } else {
    console.log('✅ Кнопка сброса найдена, вешаем обработчик');
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

  // Гарантированно делаем канвасы видимыми (на случай display:none в CSS)
  if (canvas) canvas.style.display = 'block';
  if (overlay) overlay.style.display = 'block';

  if (video) video.style.display = 'block';
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
  if (!isRunning) return;

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');

  if (!video || !canvas || !overlay) {
    console.error('❌ Элементы не найдены в processFrame');
    stopProcessing();
    return;
  }

  // ВАЖНО: принудительно делаем канвасы видимыми, чтобы clientWidth/Height были корректны
  canvas.style.display = 'block';
  overlay.style.display = 'block';

  const w = video.clientWidth;
  const h = video.clientHeight;

  if (w === 0 || h === 0) {
    console.warn('⚠️ video.clientWidth/Height = 0 — возможно, видео ещё не готово или контейнер имеет 0 высоту');
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

  ctx.drawImage(video, 0, 0, w, h);
  oCtx.clearRect(0, 0, w, h);

  // Отрисовка эллипсов
  oCtx.strokeStyle = '#16a34a';
  oCtx.lineWidth = 3;
  oCtx.beginPath();
  oCtx.ellipse(w / 2, h / 2, 100, 80, 0, 0, Math.PI * 2);
  oCtx.stroke();

  oCtx.strokeStyle = '#2563eb';
  oCtx.lineWidth = 2;
  oCtx.beginPath();
  oCtx.ellipse(w / 2, h / 2, 120, 100, 0, 0, Math.PI * 2);
  oCtx.stroke();

  frameCount++;
  if (frameCount >= 15) {
    freezeUI(w, h);
    calculateMetrics();
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
  const appWrapper = document.querySelector('.app-wrapper');

  if (!frozenImg) {
    console.error('❌ frozenImg не найден');
    return;
  }

  // Принудительно делаем канвасы видимыми для корректного drawImage
  canvas.style.display = 'block';
  overlay.style.display = 'block';

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
