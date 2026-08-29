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
  const btnFreeze = document.getElementById('btnFreeze');
  const btnUnfreeze = document.getElementById('btnUnfreeze');

  // Сохраняем текущий кадр из видео
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  frozenImg.src = canvas.toDataURL('image/jpeg', 0.9);
  frozenImg.style.display = 'block';
  frozenImg.width = canvas.width;
  frozenImg.height = canvas.height;

  // Клонируем overlay (линии/эллипсы) на отдельный канвас
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

  // Скрываем живой поток и рабочий оверлей
  video.style.display = 'none';
  overlay.style.display = 'none';

  updateStatus('success', 'Результат зафиксирован');

  // Переключаем кнопки
  if (btnFreeze) btnFreeze.style.display = 'none';
  if (btnUnfreeze) btnUnfreeze.style.display = 'block';
}

function unfreezeResult() {
  currentState = STATE.SEARCH;

  const video = document.getElementById('video');
  const frozenImg = document.getElementById('frozenImg');
  const frozenOverlay = document.getElementById('frozenOverlay');
  const overlay = document.getElementById('overlay');
  const btnFreeze = document.getElementById('btnFreeze');
  const btnUnfreeze = document.getElementById('btnUnfreeze');

  // Возвращаем живой поток и очищаем замороженный вид
  video.style.display = 'block';
  overlay.style.display = 'block';
  frozenImg.style.display = 'none';
  frozenOverlay.style.display = 'none';

  updateStatus('ok', 'Камера активна. Наведите на деталь.');

  // Сбрасываем буфер кадров, чтобы не тянуть старые данные
  goodFramesBuffer = [];
  lastScore = 0;

  // Переключаем кнопки обратно
  if (btnFreeze) btnFreeze.style.display = 'block';
  if (btnUnfreeze) btnUnfreeze.style.display = 'none';

  // Продолжаем обработку кадров
  processFrame();
}

// Привязываем кнопки к функциям при загрузке DOM
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