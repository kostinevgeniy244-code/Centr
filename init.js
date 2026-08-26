let video, canvas, overlay, frozenImg;
let selectedDeviceId = null;

async function initCamera() {
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  overlay = document.getElementById('overlay');
  frozenImg = document.getElementById('frozenImg');
  const cameraSelect = document.getElementById('cameraSelect');

  if (!video || !canvas || !overlay) {
    console.error('Не найдены элементы video/canvas/overlay');
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    cameraSelect.innerHTML = '';
    if (videoDevices.length === 0) {
      updateStatus('err', 'Нет камер');
      return;
    }

    videoDevices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Камера ${device.deviceId.slice(0, 8)}...`;
      cameraSelect.appendChild(option);
    });

    const backCamera = videoDevices.find(d => (d.label || '').toLowerCase().includes('back'));
    if (backCamera) {
      cameraSelect.value = backCamera.deviceId;
      selectedDeviceId = backCamera.deviceId;
    } else {
      selectedDeviceId = videoDevices[0].deviceId;
    }

    cameraSelect.addEventListener('change', async (e) => {
      selectedDeviceId = e.target.value;
      await restartCamera();
    });

    await startStream();
  } catch (err) {
    console.error(err);
    updateStatus('err', 'Ошибка доступа к устройствам');
  }
}

async function startStream() {
  const constraints = {
    video: { deviceId: { exact: selectedDeviceId } }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    syncSizes();

    window.addEventListener('resize', syncSizes, { once: true });
    video.addEventListener('loadedmetadata', syncSizes, { once: true });

    updateStatus('ok', 'Камера готова');
  } catch (err) {
    console.error('Ошибка getUserMedia:', err);
    updateStatus('err', 'Не удалось запустить камеру');
  }
}

async function restartCamera() {
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  await startStream();
}

function syncSizes() {
  // ВАЖНО: canvas.width/height = реальные пиксели видео (для OpenCV и отрисовки)
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;

  canvas.width = w;
  canvas.height = h;

  // overlay и frozenImg будут занимать всю область контейнера,
  // но рисовать мы будем в координатах w x h
  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';

  if (frozenImg) {
    frozenImg.style.width = w + 'px';
    frozenImg.style.height = h + 'px';
  }
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
