// result.js — логика заморозки и отрисовки (уже учтена в core.js выше, но это отдельный файл, если ты делишь по функционалу)
// Если ты используешь core.js как единый JS — этот файл не нужен. Если раздельно — вот он.

function freezeResult() {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    console.warn('Размеры видео ещё не определены');
    return;
  }

  isRunning = false;
  currentState = STATE.FROZEN;

  const freezeBtn = document.getElementById('freezeBtn');
  const unfreezeBtn = document.getElementById('unfreezeBtn');

  freezeBtn.disabled = true;
  unfreezeBtn.style.display = 'inline-block';

  frozenContainerEl = document.querySelector('.frozen-container');
  frozenImgEl = document.getElementById('frozenImgEl');
  frozenOverlayEl = document.getElementById('frozenOverlayEl');

  frozenContainerEl.style.display = 'block';

  // Берём кадр строго из видеоэлемента — это тот кадр, что был на экране
  const imgData = videoEl.toDataURL();
  frozenImgEl.src = imgData;

  // Синхронизируем размер канваса с реальным размером кадра
  frozenOverlayEl.width = videoEl.videoWidth;
  frozenOverlayEl.height = videoEl.videoHeight;

  drawDebug(frozenOverlayEl, videoEl.videoWidth, videoEl.videoHeight);
}

function unfreezeResult() {
  isRunning = true;
  currentState = STATE.SEARCH;

  const freezeBtn = document.getElementById('freezeBtn');
  const unfreezeBtn = document.getElementById('unfreezeBtn');

  freezeBtn.disabled = false;
  unfreezeBtn.style.display = 'none';

  frozenContainerEl.style.display = 'none';

  processVideo();
}

// Отрисовка поверх кадра (для поиска и для замороженного)
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
  if (currentState === STATE.FROZEN) {
    ctx.fillText('Кадр заморожен', 10, 25);
  } else {
    ctx.fillText('Режим поиска', 10, 25);
  }
}
<!-- конец файла -->