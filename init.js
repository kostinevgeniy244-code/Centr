// init.js

document.addEventListener('DOMContentLoaded', () => {
  // Кнопка запуска камеры
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

  // Кнопка сброса
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

  // Ожидание загрузки OpenCV runtime
  function initOpenCV() {
    if (typeof cv === 'undefined') return;
    if (cv.getBuildInformation) {
      // Runtime уже готов
      if (typeof onOpenCVLoad === 'function') onOpenCVLoad();
    } else {
      // Runtime ещё инициализируется
      cv.onRuntimeInitialized = onOpenCVLoad;
    }
  }

  if (typeof cv !== 'undefined') {
    initOpenCV();
  } else {
    // Скрипт OpenCV ещё не загрузился — ждём события load
    const opencvScript = Array.from(document.scripts).find(
      s => s.src && s.src.includes('opencv.js')
    );
    if (opencvScript) {
      opencvScript.addEventListener('load', initOpenCV);
    }
  }
});