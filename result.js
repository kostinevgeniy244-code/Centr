/**
 * result.js — финальные расчёты и логика «заморозки» кадра
 * Подключается после core.js в index.html
 */

function freezeResult() {
  if (!isRunning) return;
  currentState = STATE.FROZEN;

  const video = document.getElementById('video');
  const frozenImg = document.getElementById('frozenImg');
  const frozenOverlay = document.getElementById('frozenOverlay');
  const overlay = document.getElementById('overlay');

  // Сохраняем текущий кадр
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  frozenImg.src = canvas.toDataURL('image/jpeg', 0.9);
  frozenImg.style.display = 'block';
  frozenImg.width = canvas.width;
  frozenImg.height = canvas.height;

  // Клонируем overlay (линии/эллипсы)
  const clone = overlay.cloneNode(false);
  clone.width = overlay.width;
  clone.height = overlay.height;
  const cloneCtx = clone.getContext('2d');
  cloneCtx.drawImage(overlay, 0, 0);

  frozenOverlay.width = clone.width;
  frozenOverlay.height = clone.height;
  const frozenCtx = frozenOverlay.getContext('2d');
  frozenCtx.drawImage(clone, 0, 0);
  frozenOverlay.style.display = 'block';

  video.style.display = 'none';
  overlay.style.display = 'none';

  updateStatus('success', 'Результат зафиксирован');
}

function unfreezeResult() {
  currentState = STATE.SEARCH;

  const video = document.getElementById('video');
  const frozenImg = document.getElementById('frozenImg');
  const frozenOverlay = document.getElementById('frozenOverlay');
  const overlay = document.getElementById('overlay');

  video.style.display = 'block';
  overlay.style.display = 'block';
  frozenImg.style.display = 'none';
  frozenOverlay.style.display = 'none';

  updateStatus('ok', 'Камера активна. Наведите на деталь.');
  processFrame();
}

// Привязываем кнопки к функциям (если они будут в HTML)
document.addEventListener('DOMContentLoaded', () => {
  const btnFreeze = document.getElementById('btnFreeze');
  const btnUnfreeze = document.getElementById('btnUnfreeze');

  if (btnFreeze) {
    btnFreeze.addEventListener('click', freezeResult);
  }

  if (btnUnfreeze) {
    btnUnfreeze.addEventListener('click', unfreezeResult);
  }
});

// Экспортируем функции, если понадобится вызывать их из других модулей
window.freezeResult = freezeResult;
window.unfreezeResult = unfreezeResult;
// конец файла