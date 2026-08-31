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
      console.error('❌ Элемент #video не найден');
      return;
    }
    // Сброс состояния
    this.stream = null;
    this.isRunning = false;
  },

  async start() {
    if (this.isRunning) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // тыловая камера по умолчанию
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      this.stream = stream;
      this.video.srcObject = stream;

      // Ждём, пока видео реально начнёт проигрываться (важно для imread в OpenCV)
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(() => {
            // Небольшая задержка, чтобы кадр успел отрисоваться
            setTimeout(resolve, 200);
          }).catch(err => reject(err));
        };
        this.video.onerror = err => reject(err);
      });

      this.isRunning = true;
      console.log('✅ Камера запущена');
      if (typeof logLoad === 'function') {
        logLoad('Камера — запущена', 'ok');
      }
    } catch (err) {
      console.error('❌ Ошибка доступа к камере:', err);
      if (typeof logLoad === 'function') {
        logLoad('Камера — ошибка доступа', 'err');
      }
      throw err;
    }
  },

  stop() {
    if (!this.stream) return;
    this.isRunning = false;
    this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video.load();
    }
    console.log('🛑 Камера остановлена');
  },

  /**
   * Захватывает текущий кадр в canvas (полный размер видеоэлемента).
   * Используется для заморозки кадра.
   */
  captureFrame(canvasEl) {
    if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
      console.warn('⚠️ Нет валидного видео для захвата кадра');
      return;
    }

    canvasEl.width = this.video.videoWidth;
    canvasEl.height = this.video.videoHeight;

    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(this.video, 0, 0, canvasEl.width, canvasEl.height);

    console.log('📸 Кадр захвачен в canvas');
  },
};

// Конец файла