// camera.js

if (typeof logLoad === 'function') {
  logLoad('camera.js — подключён', 'ok');
}

export const Camera = {
  video: null,
  stream: null,
  isRunning: false,

  init() {
    this.video = document.getElementById('video');
    if (!this.video) {
      console.error('❌ Camera: элемент #video не найден');
      if (typeof logLoad === 'function') logLoad('Camera: элемент #video не найден', 'err');
      return;
    }
    if (typeof logLoad === 'function') logLoad('Camera: инициализирован', 'ok');
  },

  async start() {
    if (this.isRunning) return;

    try {
      const constraints = {
        video: {
          facingMode: 'environment', // тыловая камера на мобильном
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      // Ждём, пока видео реально начнёт воспроизводиться
      await new Promise((resolve, reject) => {
        this.video.addEventListener('loadedmetadata', resolve, { once: true });
        this.video.addEventListener('error', reject, { once: true });
      });

      this.isRunning = true;
      if (typeof logLoad === 'function') logLoad('Camera: поток запущен, тыловая камера активна', 'ok');
    } catch (err) {
      console.error('❌ Camera: ошибка доступа к камере:', err);
      if (typeof logLoad === 'function') logLoad('Camera: ошибка доступа к камере', 'err');
      throw err;
    }
  },

  stop() {
    if (!this.isRunning || !this.stream) return;

    this.isRunning = false;
    if (this.video && this.video.srcObject) {
      this.video.srcObject = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (typeof logLoad === 'function') logLoad('Camera: остановлен', 'ok');
  },

  /**
   * Захватывает текущий кадр видео и рисует его на целевом canvas.
   * Учитывает пропорции, чтобы не сплющивать изображение.
   */
  captureFrame(canvasEl) {
    if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
      console.warn('⚠️ Camera: видео не готово для захвата кадра');
      if (typeof logLoad === 'function') logLoad('Camera: видео не готово для captureFrame', 'warn');
      return;
    }

    const aspect = this.video.videoWidth / this.video.videoHeight;
    const canvasWidth = canvasEl.clientWidth;
    const canvasHeight = canvasEl.clientHeight;

    // Масштабируем, сохраняя пропорции
    let drawW, drawH;
    if (canvasWidth / canvasHeight > aspect) {
      drawH = canvasHeight;
      drawW = canvasHeight * aspect;
    } else {
      drawW = canvasWidth;
      drawH = canvasWidth / aspect;
    }

    canvasEl.width = canvasWidth;
    canvasEl.height = canvasHeight;

    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(
      this.video,
      0, 0, this.video.videoWidth, this.video.videoHeight,
      (canvasWidth - drawW) / 2,
      (canvasHeight - drawH) / 2,
      drawW,
      drawH
    );

    if (typeof logLoad === 'function') logLoad('Camera: кадр захвачен и отрисован на frozenCanvas', 'ok');
  },
};
