import { CONFIG } from './config.js';
import { Camera } from './camera.js';
import { CVProcessing } from './cv-processing.js';
import { UI } from './ui.js';

const safeLog = (msg, status = 'info') => {
  try {
    if (typeof window.logLoad === 'function') {
      window.logLoad(msg, status);
    } else {
      const prefix = status === 'ok' ? '✅' : status === 'err' ? '❌' : 'ℹ️';
      console.log(`[APP] ${prefix} ${msg}`);
    }
  } catch (e) {
    console.error('[APP] Ошибка при попытке записать лог:', e);
  }
};

safeLog('app.js — подключён', 'ok');

let animationFrameId = null;
let isProcessing = false;

// --- Загрузка OpenCV.js ---
// Если OpenCV ещё не подключён, подключаем через CDN
if (typeof window.cv === 'undefined') {
  safeLog('OpenCV: загружаю через CDN...', 'info');
  const cvScript = document.createElement('script');
  cvScript.src = 'https://docs.opencv.org/4.8.0/opencv.js';
  cvScript.async = true;

  cvScript.onload = () => {
    safeLog('OpenCV: скрипт загружен, ожидаю инициализацию WASM...', 'info');
    // OpenCV.js выставляет cv.Module — ждём onRuntimeInitialized
    if (window.cv && typeof window.cv.onRuntimeInitialized === 'undefined') {
      window.cv.onRuntimeInitialized = () => {
        onCvReady(window.cv);
      };
    } else if (window.cv && window.cv.Mat) {
      // Уже готов
      onCvReady(window.cv);
    } else {
      // Fallback: polling
      const checkReady = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(checkReady);
          onCvReady(window.cv);
        }
      }, 200);
    }
  };

  cvScript.onerror = () => {
    safeLog('OpenCV: не удалось загрузить скрипт', 'err');
  };

  document.head.appendChild(cvScript);
} else if (window.cv && window.cv.Mat) {
  // Уже загружен ранее
  onCvReady(window.cv);
}

function onCvReady(cvModule) {
  safeLog('OpenCV — готов к работе', 'ok');

  if (typeof CVProcessing === 'object' && typeof CVProcessing.init === 'function') {
    CVProcessing.init(cvModule);
  } else {
    safeLog('Ошибка: CVProcessing не найден или не имеет метода init', 'err');
  }

  if (typeof UI === 'object' && typeof UI.init === 'function') {
    UI.init();
  } else {
    safeLog('Ошибка: UI не найден или не имеет метода init', 'err');
  }
}

// --- Основной цикл обработки кадров ---
function processLoop() {
  // Если UI в режиме FROZEN — пропускаем, просто ждём
  if (typeof UI === 'object' && UI.currentState === UI.STATE.FROZEN) {
    animationFrameId = requestAnimationFrame(processLoop);
    return;
  }

  if (!isProcessing && Camera && Camera.isRunning) {
    isProcessing = true;
    try {
      const videoEl = Camera.video;
      const overlayCanvas = document.getElementById('overlay');

      if (!videoEl || !overlayCanvas) {
        safeLog('Ошибка: video или overlay не найдены', 'err');
        isProcessing = false;
        animationFrameId = requestAnimationFrame(processLoop);
        return;
      }

      // Читаем параметры: сначала из dataset, потом fallback на инпуты
      const matrixDiameter = parseFloat(videoEl.dataset.matrixDiameter) || 0;
      const dornDiameter = parseFloat(videoEl.dataset.dornDiameter) || 0;
      const toleranceOffset = parseFloat(videoEl.dataset.toleranceOffset) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
      const toleranceUneven = parseFloat(videoEl.dataset.toleranceUneven) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

      if (!matrixDiameter || !dornDiameter) {
        // Параметры ещё не заданы — пропускаем
        isProcessing = false;
        animationFrameId = requestAnimationFrame(processLoop);
        return;
      }

      const inputParams = {
        matrixDiameter,
        dornDiameter,
        toleranceOffset,
        toleranceUneven,
      };

      if (typeof CVProcessing === 'object' && typeof CVProcessing.processFrame === 'function') {
        const result = CVProcessing.processFrame(videoEl, overlayCanvas, inputParams);

        if (result) {
          const isGood = result.offset <= toleranceOffset && result.unevenness <= toleranceUneven;

          if (isGood) {
            if (typeof UI === 'object') {
              UI.currentState = UI.STATE.LOCKED;
              UI.updateStatusUI();
              UI.showResults(result);
            }
          } else {
            if (typeof UI === 'object') {
              UI.showResults(result);
              if (UI.currentState !== UI.STATE.SEARCH) {
                UI.currentState = UI.STATE.SEARCH;
                UI.updateStatusUI();
              }
            }
          }
        } else {
          // Объекты не найдены
          if (typeof UI === 'object' && UI.elements && UI.elements.resultPanel) {
            UI.elements.resultPanel.classList.add('hidden');
            if (UI.currentState !== UI.STATE.SEARCH) {
              UI.currentState = UI.STATE.SEARCH;
              UI.updateStatusUI();
            }
          }
        }
      } else {
        safeLog('Ошибка: CVProcessing.processFrame не найден', 'err');
      }
    } catch (err) {
      console.error('❌ Критическая ошибка в цикле обработки:', err);
      safeLog('Ошибка в processLoop: ' + err.message, 'err');
    } finally {
      isProcessing = false;
    }
  }

  animationFrameId = requestAnimationFrame(processLoop);
}

function startProcessingLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(processLoop);
  safeLog('Цикл обработки кадров запущен', 'ok');
}

// --- Перехват кнопки старта ---
// Ждём, пока UI инициализируется, потом перехватываем handleStart
const waitForUI = setInterval(() => {
  if (typeof UI === 'object' && typeof UI.handleStart === 'function' && UI.elements && UI.elements.video) {
    clearInterval(waitForUI);

    const originalStart = UI.handleStart.bind(UI);

    UI.handleStart = function () {
      safeLog('Пользователь нажал "Начать замер"', 'info');
      originalStart();
      // Даём камере время на запуск
      setTimeout(startProcessingLoop, 500);
    };

    safeLog('Перехват UI.handleStart выполнен', 'ok');
  }
}, 200);

// --- Очистка при уходе со страницы ---
window.addEventListener('beforeunload', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if (typeof Camera === 'object' && typeof Camera.stop === 'function') {
    Camera.stop();
  }
});

console.log('✅ app.js полностью загружен. Ожидание OpenCV и действий пользователя.');