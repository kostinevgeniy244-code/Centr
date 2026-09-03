import { CONFIG } from './config.js';
import { Camera } from './camera.js';
import { CVProcessing } from './cv-processing.js';
import { UI } from './ui.js';

const safeLog = (msg, status = 'info') => {
  const prefix = status === 'ok' ? '✅' : status === 'err' ? '❌' : 'ℹ️';
  const logMsg = `[APP] ${prefix} ${msg}`;
  
  if (typeof window.logLoad === 'function') {
    window.logLoad(logMsg, status);
  } else {
    console.log(logMsg);
  }
};

safeLog('app.js — подключён', 'ok');

let animationFrameId = null;
let isProcessing = false;

// --- ШАГ 1: Инициализация UI (с передачей Camera!) ---
if (typeof UI === 'object' && typeof UI.init === 'function') {
  // Передаем Camera внутрь UI, чтобы UI сам управлял камерой
  UI.init(Camera); 
  safeLog('UI успешно инициализирован с передачей Camera', 'ok');
} else {
  safeLog('Ошибка: UI не найден или не имеет метода init', 'err');
}

// --- ШАГ 2: Загрузка OpenCV ---
if (typeof window.cv === 'undefined') {
  safeLog('OpenCV: не найден, загружаю через CDN...', 'info');
  const cvScript = document.createElement('script');
  cvScript.src = 'https://docs.opencv.org/4.8.0/opencv.js';
  cvScript.async = true;

  cvScript.onload = () => {
    safeLog('OpenCV: скрипт загружен, ожидаю WASM...', 'info');
    
    if (window.cv && typeof window.cv.onRuntimeInitialized === 'undefined') {
      window.cv.onRuntimeInitialized = () => {
        onCvReady(window.cv);
      };
    } else if (window.cv && window.cv.Mat) {
      onCvReady(window.cv);
    } else {
      const checkReady = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(checkReady);
          onCvReady(window.cv);
        }
      }, 200);
    }
  };

  cvScript.onerror = () => {
    safeLog('❌ OpenCV: не удалось загрузить скрипт. Проверьте консоль браузера.', 'err');
  };

  document.head.appendChild(cvScript);
} else if (window.cv && window.cv.Mat) {
  safeLog('OpenCV: уже загружен в DOM', 'ok');
  onCvReady(window.cv);
}

function onCvReady(cvModule) {
  safeLog('OpenCV — полностью готов к работе', 'ok');

  if (typeof CVProcessing === 'object' && typeof CVProcessing.init === 'function') {
    CVProcessing.init(cvModule);
    safeLog('CVProcessing инициализирован', 'ok');
  } else {
    safeLog('Ошибка: CVProcessing не найден', 'err');
  }
}

// --- ШАГ 3: Перехват кнопки "Начать замер" ---
// Теперь это работает, потому что UI уже инициализирован и знает про Camera
if (typeof UI === 'object' && UI.elements && UI.elements.startBtn) {
  const startBtn = UI.elements.startBtn;
  
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      safeLog('Пользователь нажал кнопку "Начать замер"', 'info');
      
      if (typeof UI.handleStart === 'function') {
        UI.handleStart();
        safeLog('UI.handleStart вызван', 'ok');
        
        setTimeout(() => {
          if (!animationFrameId) {
            startProcessingLoop();
          }
        }, 600);
      } else {
        safeLog('Ошибка: UI.handleStart не найден', 'err');
      }
    });
    safeLog('Обработчик клика на кнопке "Начать замер" установлен', 'ok');
  } else {
    safeLog('Ошибка: элемент кнопки старта не найден в DOM', 'err');
  }
} else {
  safeLog('Ошибка: UI.elements или startBtn не готовы', 'err');
}

// --- Основной цикл обработки кадров ---
function processLoop() {
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
        safeLog('Ошибка: video или overlay не найдены в DOM', 'err');
        isProcessing = false;
        animationFrameId = requestAnimationFrame(processLoop);
        return;
      }

      const matrixDiameter = parseFloat(videoEl.dataset.matrixDiameter) || 0;
      const dornDiameter = parseFloat(videoEl.dataset.dornDiameter) || 0;
      const toleranceOffset = parseFloat(videoEl.dataset.toleranceOffset) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
      const toleranceUneven = parseFloat(videoEl.dataset.toleranceUneven) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

      if (!matrixDiameter || !dornDiameter) {
        safeLog('Параметры ещё не заданы (matrixDiameter/dornDiameter)', 'info');
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
      console.error('❌ Критическая ошибка в processLoop:', err);
      safeLog('Ошибка в цикле обработки: ' + err.message, 'err');
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

window.addEventListener('beforeunload', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if (typeof Camera === 'object' && typeof Camera.stop === 'function') {
    Camera.stop();
  }
});

console.log('✅ app.js полностью загружен. Ожидание действий пользователя.');