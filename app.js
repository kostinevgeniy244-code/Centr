import { CONFIG } from './config.js';
import { Camera } from './camera.js';
import { CVProcessing } from './cv-processing.js';
import { UI } from './ui.js';

// --- ЗАЩИТА ОТ ОШИБОК ЛОГИРОВАНИЯ ---
// Безопасная обертка для logLoad. Если функция еще не готова или упала, 
// мы просто пишем в консоль, чтобы не ломать весь скрипт.
const safeLog = (msg, status = 'info') => {
  try {
    if (typeof window.logLoad === 'function') {
      window.logLoad(msg, status);
    } else {
      // Если глобальной функции нет, пишем в обычную консоль (видно в chrome://inspect)
      const prefix = status === 'ok' ? '✅' : status === 'err' ? '❌' : 'ℹ️';
      console.log(`[APP] ${prefix} ${msg}`);
    }
  } catch (e) {
    console.error('[APP] Ошибка при попытке записать лог:', e);
  }
};

safeLog('app.js — подключён и инициализирован', 'ok');

let animationFrameId = null;
let isProcessing = false;

/**
 * Глобальный колбэк, который OpenCV.js вызывает после загрузки модуля.
 * ВАЖНО: Эта функция должна быть объявлена в window ДО загрузки app.js,
 * но мы делаем проверку на случай, если порядок загрузки сбился.
 */
if (typeof window.onOpenCvLoad === 'undefined') {
  window.onOpenCvLoad = function (opencvModule) {
    safeLog('OpenCV — готов к работе', 'ok');
    console.log('OpenCV module:', opencvModule);

    if (typeof CVProcessing === 'object' && typeof CVProcessing.init === 'function') {
      CVProcessing.init(opencvModule);
    } else {
      safeLog('Ошибка: CVProcessing не найден или не имеет метода init', 'err');
      console.error('CVProcessing structure:', CVProcessing);
    }

    if (typeof UI === 'object' && typeof UI.init === 'function') {
      UI.init();
    } else {
      safeLog('Ошибка: UI не найден или не имеет метода init', 'err');
      console.error('UI structure:', UI);
    }
  };
} else {
  // Если функция уже была задана где-то еще, просто логируем
  safeLog('OpenCV callback уже зарегистрирован', 'info');
}

/**
 * Основной цикл обработки кадров.
 */
function processLoop(timestamp) {
  // Проверка состояния UI перед любыми действиями
  if (typeof UI === 'object' && UI.currentState === UI.STATE.FROZEN) {
    requestAnimationFrame(processLoop);
    return;
  }

  if (!isProcessing && Camera && Camera.isRunning) {
    isProcessing = true;
    try {
      const videoEl = Camera.video;
      const overlayCanvas = document.getElementById('overlay');

      // Критическая проверка: существуют ли элементы DOM
      if (!videoEl || !overlayCanvas) {
        safeLog('Ошибка: video или canvas overlay не найдены в DOM', 'err');
        isProcessing = false;
        requestAnimationFrame(processLoop);
        return;
      }

      // Получаем параметры
      const matrixDiameter = parseFloat(videoEl.dataset.matrixDiameter) || 0;
      const dornDiameter = parseFloat(videoEl.dataset.dornDiameter) || 0;
      const toleranceOffset = parseFloat(videoEl.dataset.toleranceOffset) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
      const toleranceUneven = parseFloat(videoEl.dataset.toleranceUneven) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

      const inputParams = {
        matrixDiameter,
        dornDiameter,
        toleranceOffset,
        toleranceUneven,
      };

      // Вызов обработки
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
          if (typeof UI === 'object') {
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

// Перехват кнопки старта
if (typeof UI === 'object' && typeof UI.handleStart === 'function') {
  const originalStartMeasurement = UI.handleStart.bind(UI);
  
  UI.handleStart = function () {
    safeLog('Пользователь нажал "Начать замер"', 'info');
    originalStartMeasurement();
    // Небольшая задержка, чтобы UI успел переключить экран и запустить камеру
    setTimeout(startProcessingLoop, 150);
  };
} else {
  safeLog('Предупреждение: UI.handleStart не найден, перехват не выполнен', 'warn');
}

// Очистка при уходе со страницы
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (typeof Camera === 'object' && typeof Camera.stop === 'function') {
    Camera.stop();
  }
});

console.log('✅ app.js полностью загружен. Ожидание действий пользователя.');