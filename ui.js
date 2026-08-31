// ui.js

if (typeof logLoad === 'function') {
  logLoad('ui.js — подключён', 'ok');
}

export const UI = {
  elements: {},
  STATE: {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen',
  },
  currentState: null,

  init() {
    // Кэшируем все нужные DOM‑элементы один раз
    this.elements = {
      inputScreen: document.getElementById('input-screen'),
      cameraScreen: document.getElementById('camera-screen'),
      statusText: document.getElementById('status-text'),
      statusDot: document.getElementById('status-dot'),
      video: document.getElementById('video'),
      overlay: document.getElementById('overlay'),
      frozenCanvas: document.getElementById('frozen-canvas'),
      freezeBtn: document.getElementById('freeze-btn'),
      resetBtn: document.getElementById('reset-btn'),
      resultPanel: document.getElementById('result-panel'),
      resMatrixDiam: document.getElementById('res-matrix-diam'),
      resDornDiam: document.getElementById('res-dorn-diam'),
      resOffset: document.getElementById('res-offset'),
      resUneven: document.getElementById('res-uneven'),
      resVerdict: document.getElementById('res-verdict'),
      matrixDiameterInput: document.getElementById('matrix-diameter'),
      dornDiameterInput: document.getElementById('dorn-diameter'),
      toleranceOffsetInput: document.getElementById('tolerance-offset'),
      toleranceUnevenInput: document.getElementById('tolerance-uneven'),
    };

    if (Object.values(this.elements).some(el => !el)) {
      console.error('❌ Не все элементы UI найдены в DOM');
      if (typeof logLoad === 'function') {
        logLoad('UI — ошибка: не все элементы найдены', 'err');
      }
      return;
    }

    // Навешиваем обработчики событий
    document.getElementById('start-btn').addEventListener('click', () => this.handleStart());
    this.elements.freezeBtn.addEventListener('click', () => this.handleFreeze());
    this.elements.resetBtn.addEventListener('click', () => this.handleReset());

    // Устанавливаем начальное состояние
    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    if (typeof logLoad === 'function') {
      logLoad('UI — инициализирован', 'ok');
    }
  },

  /**
   * Переключает экраны: скрывает ввод, показывает камеру.
   * Считывает параметры с формы и передаёт их дальше.
   */
  handleStart() {
    const matrixDiam = parseFloat(this.elements.matrixDiameterInput.value);
    const dornDiam = parseFloat(this.elements.dornDiameterInput.value);
    const tolOffset = parseFloat(this.elements.toleranceOffsetInput.value) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
    const tolUneven = parseFloat(this.elements.toleranceUnevenInput.value) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

    if (!matrixDiam || !dornDiam || matrixDiam <= 0 || dornDiam <= 0) {
      alert('⚠️ Укажите корректные диаметры матрицы и дорна (больше 0)');
      return;
    }

    // Сохраняем параметры в dataset видеоэлемента, чтобы CVProcessing мог их прочитать
    this.elements.video.dataset.matrixDiameter = matrixDiam.toString();
    this.elements.video.dataset.dornDiameter = dornDiam.toString();
    this.elements.video.dataset.toleranceOffset = tolOffset.toString();
    this.elements.video.dataset.toleranceUneven = tolUneven.toString();

    // Переключаем экраны
    this.elements.inputScreen.classList.add('hidden');
    this.elements.cameraScreen.classList.remove('hidden');

    // Запускаем камеру
    Camera.init();
    Camera.start().catch(err => {
      alert('❌ Не удалось запустить камеру. Проверьте разрешения.');
      this.handleReset();
    });
  },

  /**
   * Фиксирует текущий кадр: рисует его на frozenCanvas и переключает состояние в FROZEN.
   */
  handleFreeze() {
    if (!Camera.isRunning) return;

    Camera.captureFrame(this.elements.frozenCanvas);

    // Скрываем видео и оверлей, показываем замороженный кадр
    this.elements.video.style.display = 'none';
    this.elements.overlay.style.display = 'none';
    this.elements.frozenCanvas.classList.remove('hidden');
    this.elements.frozenCanvas.style.display = 'block';

    this.currentState = this.STATE.FROZEN;
    this.updateStatusUI();

    // Блокируем кнопку фиксации, включаем сброс
    this.elements.freezeBtn.disabled = true;
  },

  /**
   * Полный сброс: возвращает экраны, останавливает камеру, очищает результаты.
   */
  handleReset() {
    // Останавливаем камеру
    Camera.stop();

    // Возвращаем экраны
    this.elements.inputScreen.classList.remove('hidden');
    this.elements.cameraScreen.classList.add('hidden');

    // Очищаем замороженный кадр
    this.elements.frozenCanvas.width = 0;
    this.elements.frozenCanvas.height = 0;
    this.elements.frozenCanvas.classList.add('hidden');
    this.elements.frozenCanvas.style.display = '';

    // Показываем видео и оверлей
    this.elements.video.style.display = 'block';
    this.elements.overlay.style.display = '';

    // Сбрасываем UI статуса
    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    // Разблокируем кнопки
    this.elements.freezeBtn.disabled = false;
    this.elements.resultPanel.classList.add('hidden');
  },

  /**
   * Обновляет текст статуса и цвет индикатора (точки).
   */
  updateStatusUI() {
    const textMap = {
      [this.STATE.SEARCH]: 'РЕЖИМ: ПОИСК',
      [this.STATE.LOCKED]: 'РЕЖИМ: ЗАХВАТ',
      [this.STATE.FROZEN]: 'РЕЖИМ: СТОП‑КАДР',
    };

    const dotClassMap = {
      [this.STATE.SEARCH]: 'dot-search',
      [this.STATE.LOCKED]: 'dot-locked',
      [this.STATE.FROZEN]: 'dot-frozen',
    };

    this.elements.statusText.textContent = textMap[this.currentState] || 'РЕЖИМ: НЕИЗВЕСТЕН';

    this.elements.statusDot.className = 'dot ' + (dotClassMap[this.currentState] || '');
  },

  /**
   * Выводит результаты замера на экран.
   */
  showResults(result) {
    if (!result) return;

    this.elements.resMatrixDiam.textContent = result.matrixDiam.toFixed(3);
    this.elements.resDornDiam.textContent = result.dornDiam.toFixed(3);
    this.elements.resOffset.textContent = result.offset.toFixed(3);
    this.elements.resUneven.textContent = result.unevenness.toFixed(3);

    // Простой вердикт
    const verdictEl = this.elements.resVerdict;
    verdictEl.className = 'verdict';
    let verdictText = 'В допуске';
    let isGood = true;

    const params = {
      offset: parseFloat(this.elements.video.dataset.toleranceOffset),
      uneven: parseFloat(this.elements.video.dataset.toleranceUneven),
    };

    if (result.offset > params.offset) {
      verdictText = 'Смещение вне допуска';
      isGood = false;
    } else if (result.unevenness > params.uneven) {
      verdictText = 'Неравномерность вне допуска';
      isGood = false;
    }

    verdictEl.textContent = verdictText;
    if (isGood) {
      verdictEl.classList.add('good');
    } else {
      verdictEl.classList.add('bad');
    }

    this.elements.resultPanel.classList.remove('hidden');
  },
};

// Конец файла