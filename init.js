// init.js

document.addEventListener('DOMContentLoaded', () => {
  // Инициализация кнопки запуска камеры
  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (typeof startCamera === 'function') {
        startCamera();
      } else {
        console.error('❌ Функция startCamera не найдена. Проверьте подключение core.js.');
      }
    });
  }

  // Инициализация кнопки сброса
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (typeof resetApp === 'function') {
        resetApp();
      } else {
        console.error('❌ Функция resetApp не найдена. Проверьте подключение core.js.');
      }
    });
  }

  // Обработка загрузки OpenCV
  if (typeof cv !== 'undefined' && typeof onOpenCVLoad === 'function') {
    onOpenCVLoad();
  } else {
    // Если OpenCV ещё не загрузился — ждём события load у скрипта opencv.js
    const opencvScript = Array.from(document.scripts).find(s => s.src && s.src.includes('opencv.js'));
    if (opencvScript) {
      opencvScript.addEventListener('load', () => {
        if (typeof onOpenCVLoad === 'function') {
          onOpenCVLoad();
        }
      });
    }
  }
});
