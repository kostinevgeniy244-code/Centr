let cvReady = false;
let isRunning = false;

const STATE = {
  SEARCH: 'search',
  LOCKED: 'locked',
  FROZEN: 'frozen'
};

let currentState = STATE.SEARCH;

let videoEl, canvasEl, overlayEl;
let frozenContainerEl, frozenImgEl, frozenOverlayEl;

const PROCESS_WIDTH = 320;

function onOpenCvLoad() {
  cvReady = true;
  console.log('OpenCV loaded');
}

async function startCamera() {
  if (!cvReady) {
    alert('OpenCV ещё не загружен');
    return;
  }

  if (isRunning || currentState === STATE.FROZEN) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      facingMode: 'environment'
    });

    videoEl = document.getElementById('videoEl');
    videoEl.srcObject = stream;

    await new Promise(resolve => videoEl.onloadedmetadata = resolve);

    canvasEl = document.createElement('canvas');
    overlayEl = document.getElementById('overlayEl');

    const ratio = videoEl.videoHeight / videoEl.videoWidth;
    const processHeight = Math.round(PROCESS_WIDTH * ratio);

    canvasEl.width = PROCESS_WIDTH;
    canvasEl.height = processHeight;

    overlayEl.width = videoEl.videoWidth;
    overlayEl.height = videoEl.videoHeight;

    isRunning = true;
    currentState = STATE.SEARCH;

    document.getElementById('startBtn').disabled = true;
    document.getElementById('freezeBtn').disabled = false;

    processVideo();
  } catch (err) {
    console.error('Ошибка доступа к камере:', err);
    alert('Не удалось запустить камеру');
  }
}

function stopCamera() {
  if (videoEl && videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(track => track.stop());
    videoEl.srcObject = null;
  }
  isRunning = false;
  currentState = STATE.SEARCH;
}

async function processVideo() {
  if (!isRunning || currentState === STATE.FROZEN || !videoEl || videoEl.readyState < 2) {
    if (isRunning) requestAnimationFrame(processVideo);
    return;
  }

  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, PROCESS_WIDTH, canvasEl.height);

  const srcMat = cv.matFromImageData(canvasEl);
  const grayMat = new cv.Mat();
  cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

  // Здесь логика детекции окружностей и отрисовки
  // (упрощённо — заглушка под твой расчёт дорна/матрицы)
  drawDebug(overlayEl, videoEl.videoWidth, videoEl.videoHeight);

  srcMat.delete();
  grayMat.delete();

  requestAnimationFrame(processVideo);
}

function drawDebug(canvas, w, h) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.rect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'red';
  ctx.font = '16px Arial';
  ctx.fillText('Режим поиска', 10, 25);
}

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const freezeBtn = document.getElementById('freezeBtn');
  const unfreezeBtn = document.getElementById('unfreezeBtn');

  startBtn.addEventListener('click', () => {
    if (typeof startCamera === 'function') startCamera();
    else console.error('Функция startCamera не найдена');
  });

  freezeBtn.addEventListener('click', freezeResult);

  unfreezeBtn.addEventListener('click', unfreezeResult);
});

function freezeResult() {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    console.warn('Размеры видео ещё не определены');
    return;
  }

  isRunning = false;
  currentState = STATE.FROZEN;

  document.getElementById('freezeBtn').disabled = true;
  document.getElementById('unfreezeBtn').style.display = 'inline-block';

  frozenContainerEl = document.querySelector('.frozen-container');
  frozenImgEl = document.getElementById('frozenImgEl');
  frozenOverlayEl = document.getElementById('frozenOverlayEl');

  frozenContainerEl.style.display = 'block';

  const imgData = videoEl.toDataURL();
  frozenImgEl.src = imgData;

  frozenOverlayEl.width = videoEl.videoWidth;
  frozenOverlayEl.height = videoEl.videoHeight;

  drawDebug(frozenOverlayEl, videoEl.videoWidth, videoEl.videoHeight);
}

function unfreezeResult() {
  isRunning = true;
  currentState = STATE.SEARCH;

  document.getElementById('freezeBtn').disabled = false;
  document.getElementById('unfreezeBtn').style.display = 'none';

  frozenContainerEl.style.display = 'none';

  processVideo();
}
<!-- конец файла -->