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
      frozenScreen: document.getElementById('frozen-screen'), // новый экран стоп‑кадра
      statusText: document.getElementById('status-text'),
      statusDot: document.getElementById('status-dot'),
      video: document.getElementById('video'),
      overlay: document.getElementById('overlay'),
      frozenCanvas: document.getElementById('frozen-canvas'),
      freezeBtn: document.getElementById('freeze-btn'),
      resetBtn: document.getElementById('reset-btn'),          // сброс из режима камеры
      resumeBtn: document.getElementById('resume-btn'),       // продолжить замер из стоп‑кадра
      resetBtnFrozen: document.getElementById('reset-btn-frozen'), // сброс из стоп‑кадра
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
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.handleStart());
    }
    this.elements.freezeBtn.addEventListener('click', () => this.handleFreeze());
    this.elements.resetBtn.addEventListener('click', () => this.handleReset());

    // Обработчики для экрана стоп‑кадра (если элементы существуют)
    if (this.elements.resumeBtn) {
      this.elements.resumeBtn.addEventListener('click', () => this.handleResume());
    }
    if (this.elements.resetBtnFrozen) {
      this.elements.resetBtnFrozen.addEventListener('click', () => this.handleReset());
    }

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
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.add('hidden');
    }

    // Сбрасываем результаты
    this.clearResults();

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

    // Скрываем экран камеры, показываем стоп‑кадр
    this.elements.cameraScreen.classList.add('hidden');
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.remove('hidden');
    }

    this.currentState = this.STATE.FROZEN;
    this.updateStatusUI();

    // Блокируем кнопку фиксации, включаем сброс и «продолжить»
    this.elements.freezeBtn.disabled = true;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = false;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = false;
  },

  /**
   * Возвращает режим поиска (после стоп‑кадра): показывает камеру, скрывает стоп‑кадр.
   */
  handleResume() {
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.add('hidden');
    }
    this.elements.cameraScreen.classList.remove('hidden');

    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    // Разблокируем кнопку заморозки
    this.elements.freezeBtn.disabled = false;

    // Очищаем результаты (опционально — можно оставить последние)
    this.clearResults();
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
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.add('hidden');
    }

    // Очищаем замороженный кадр
    const fc = this.elements.frozenCanvas;
    fc.width = 0;
    fc.height = 0;

    // Сбрасываем состояние
    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    // Разблокируем кнопки
    this.elements.freezeBtn.disabled = false;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = true;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = true;

    // Очищаем результаты
    this.clearResults();

    if (typeof logLoad === 'function') {
      logLoad('UI — полный сброс выполнен', 'ok');
    }
  },

  clearResults() {
    this.elements.resMatrixDiam.textContent = '--';
    this.elements.resDornDiam.textContent = '--';
    this.elements.resOffset.textContent = '--';
    this.elements.resUneven.textContent = '--';
    this.elements.resVerdict.textContent = 'Статус: --';
  },

  updateStatusUI() {
    let text = '';
    let dotColor = '#ccc';

    switch (this.currentState) {
      case this.STATE.SEARCH:
        text = 'РЕЖИМ: ОЖИДАНИЕ / ПОИСК';
        dotColor = '#3498db'; // синий
        break;
      case this.STATE.LOCKED:
        text = 'РЕЖИМ: ЗАМОРОЖЕН (в разработке)';
        dotColor = '#f39c12'; // оранжевый
        break;
      case this.STATE.FROZEN:
        text = 'РЕЖИМ: СТОП‑КАДР';
        dotColor = '#e74c3c'; // красный
        break;
      default:
        text = 'РЕЖИМ: НЕИЗВЕСТЕН';
        dotColor = '#95a5a6';
    }

    if (this.elements.statusText) {
      this.elements.statusText.textContent = text;
    }
    if (this.elements.statusDot) {
      this.elements.statusDot.style.backgroundColor = dotColor;
    }
  },
};