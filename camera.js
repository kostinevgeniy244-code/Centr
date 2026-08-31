// camera.js

import { CONFIG } from './config.js';

const Camera = {
  video: null,
  stream: null,
  isRunning: false,

  init() {
    this.video = document.getElementById('video');
    if (!this.video) {
      console.error('❌ Элемент <video id="video"> не найден');
      return false;
    }
    return true;
  },

  async start() {
    if (this.isRunning || this.stream) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(
        CONFIG.CAMERA_CONSTRAINTS
      );
      this.video.srcObject = this.stream;
      this.isRunning = true;
      console.log('✅ Камера запущена (тыловая)');
    } catch (err) {
      console.error('❌ Ошибка доступа к камере:', err);
      alert('Не удалось получить доступ к камере. Проверьте разрешения.');
    }
  },

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.video.srcObject = null;
      this.isRunning = false;
      console.log('🛑 Камера остановлена');
    }
  },

  /**
   * Захватывает полный кадр из видеопотока в canvas.
   * Это решает проблему «обрезанного угла»: мы рисуем весь video в canvas,
   * сохраняя пропорции и полное содержимое кадра.
   */
  captureFrame(canvas) {
    if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
      console.warn('⚠️ Видеопоток ещё не готов для захвата');
      return false;
    }

    const ctx = canvas.getContext('2d');
    // Важно: устанавливаем размер canvas по реальному размеру видео, а не по CSS
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;

    ctx.drawImage(
      this.video,
      0,
      0,
      this.video.videoWidth,
      this.video.videoHeight
    );

    return true;
  },

  getSize() {
    return {
      width: this.video?.videoWidth ?? 0,
      height: this.video?.videoHeight ?? 0,
    };
  },
};

export { Camera };

// Конец файла