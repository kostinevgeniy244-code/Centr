// app.js
logLoad('app.js — подключён', 'ok');

import { CONFIG } from './config.js';
import { Camera } from './camera.js';
import { CVProcessing } from './cv-processing.js';
import { UI, UI as UIModule } from './ui.js';

let animationFrameId = null;
let isProcessing = false;

/**
 * Глобальный колбэк, который OpenCV.js вызывает после загрузки модуля.
 */
window.onOpenCvLoad = function (opencvModule) {
  console.log('✅ OpenCV загружен');
  CVProcessing.init(opencvModule);
  UI.init();
 window.onOpenCvLoad = function (opencvModule) {
  console.log('✅ OpenCV загружен');
  logLoad('OpenCV — готов', 'ok');
  CVProcessing.init(opencvModule);
  UI.init();
};

 // Камера и интерфейс уже инициализируются по действиям пользователя,
  // здесь только подготовка ядра обработки.
};

/**
 * Основной цикл обработки кадров.
 * Работает через requestAnimationFrame: пока состояние не FROZEN,
 * непрерывно обрабатывает кадры.
 */
function processLoop(timestamp) {
  if (UIModule.currentState === UIModule.STATE.FROZEN) {
    // В режиме заморозки ничего не делаем — кадр уже сохранён
    return;
  }

  if (!isProcessing && Camera.isRunning) {
    isProcessing = true;
    try {
      const videoEl = Camera.video;
      const overlayCanvas = document.getElementById('overlay');

      // Получаем параметры из data-атрибутов video
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

      const result = CVProcessing.processFrame(videoEl, overlayCanvas, inputParams);

      if (result) {
        // Если нашли объекты — проверяем допуски и переключаем статус
        const isGood = result.offset <= toleranceOffset && result.unevenness <= toleranceUneven;
        if (isGood) {
          UIModule.setState(UIModule.STATE.LOCKED);
          UIModule.updateResults(result);
        } else {
          // Даже если нашли, но брак — остаёмся в поиске, но обновляем результаты
          UIModule.updateResults(result);
          // Можно оставить в SEARCH или сделать отдельный статус — пока остаёмся в SEARCH
          if (UIModule.currentState !== UIModule.STATE.SEARCH) {
            UIModule.setState(UIModule.STATE.SEARCH);
          }
        }
      } else {
        // Не нашли подходящих объектов — сбрасываем панель результатов
        const el = UIModule.elements;
        el.resultPanel.classList.add('hidden');
        if (UIModule.currentState !== UIModule.STATE.SEARCH) {
          UIModule.setState(UIModule.STATE.SEARCH);
        }
      }
    } catch (err) {
      console.error('❌ Ошибка в цикле обработки:', err);
    } finally {
      isProcessing = false;
    }
  }

  animationFrameId = requestAnimationFrame(processLoop);
};

/**
 * Запуск цикла обработки. Вызывается после старта камеры и перехода на экран камеры.
 */
function startProcessingLoop() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = requestAnimationFrame(processLoop);
}

// Перехватываем момент, когда UI переключает экраны и запускает камеру,
// чтобы стартовать цикл обработки. Для этого немного «подружим» app.js с UI.
const originalStartMeasurement = UIModule.startMeasurement.bind(UIModule);
UIModule.startMeasurement = function (params) {
  originalStartMeasurement(params);
  // После переключения на экран камеры и старта потока запускаем цикл
  setTimeout(startProcessingLoop, 100);
};

// Обработка завершения работы страницы (для очистки)
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  Camera.stop();
});

console.log('✅ app.js загружен. Ожидание загрузки OpenCV и действий пользователя.');

// Конец файла