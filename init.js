let video, canvas, overlay, frozenImg;

async function initCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  overlay = document.getElementById('overlay');
  frozenImg = document.getElementById('frozenImg');

  if (!video || !canvas || !overlay) {
    console.error('Не найдены элементы video/canvas/overlay');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 960 }
      }
    });
    video.srcObject = stream;

    // Синхронизация размеров
    syncSizes();
    
    // Пересчет при ресайзе окна или загрузке метаданных видео
    window.addEventListener('resize', syncSizes);
    video.addEventListener('loadedmetadata', syncSizes);

    updateStatus('ok', 'Камера готова');
  } catch (err) {
    console.error('Ошибка доступа к камере:', err);
    updateStatus('err', 'Не удалось получить доступ к камере');
  }
}

function syncSizes() {
  // ВАЖНО: Для canvas (буфера OpenCV) используем атрибуты width/height
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;

  canvas.width = w;
  canvas.height = h;

  // Для overlay и frozenImg используем CSS (style), чтобы они растянулись на всю область
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';

  frozenImg.style.width = w + 'px';
  frozenImg.style.height = h + 'px';
}

function updateStatus(type, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (dot && txt) {
    dot.className = 'dot ' + type;
    txt.textContent = text;
  }
}

document.addEventListener('DOMContentLoaded', initCamera);
