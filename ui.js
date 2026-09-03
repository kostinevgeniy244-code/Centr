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
      frozenScreen: document.getElementById('frozen-screen'),
      statusText: document.getElementById('status-text'),
      statusDot: document.getElementById('status-dot'),
      video: document.getElementById('video'),
      overlay: document.getElementById('overlay'),
      frozenCanvas: document.getElementById('frozen-canvas'),
      
      // ВАЖНО: теперь явно сохраняем кнопку старта
      startBtn: document.getElementById('start-btn'), 
      
      freezeBtn: document.getElementById('freeze-btn'),
      resetBtn: document.getElementById('reset-btn'),
      resumeBtn: document.getElementById('resume-btn'),
      resetBtnFrozen: document.getElementById('reset-btn-frozen'),
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

    // Проверка на наличие всех критических элементов
    const criticalIds = [
      'input-screen', 'camera-screen', 'video', 'overlay', 'start-btn'
    ];
    
    const missing = criticalIds.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
      const msg = `❌ Не найдены критические элементы: \${missing.join(', ')}`;
      console.error(msg);
      if (typeof logLoad === 'function') {
        logLoad(msg, 'err');
      }
      return;
    }

    // Навешиваем обработчики событий
    // Для startBtn мы НЕ вешаем обработчик здесь напрямую, 
    // так как app.js будет перехватывать вызов UI.handleStart.
    // Но мы должны убедиться, что элемент существует для app.js.
    
    if (this.elements.freezeBtn) {
      this.elements.freezeBtn.addEventListener('click', () => this.handleFreeze());
    }
    
    if (this.elements.resetBtn) {
      this.elements.resetBtn.addEventListener('click', () => this.handleReset());
    }

    // Обработчики для экрана стоп‑кадра
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

    // Сохраняем параметры в dataset видеоэлемента
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
    if (typeof Camera === 'object' && typeof Camera.init === 'function') {
      Camera.init();
      Camera.start().catch(err => {
        alert('❌ Не удалось запустить камеру. Проверьте разрешения.');
        this.handleReset();
      });
    } else {
      console.error('❌ Объект Camera не найден');
    }
  },

  /**
   * Фиксирует текущий кадр.
   */
  handleFreeze() {
    if (!Camera || !Camera.isRunning) return;

    Camera.captureFrame(this.elements.frozenCanvas);

    // Скрываем экран камеры, показываем стоп‑кадр
    this.elements.cameraScreen.classList.add('hidden');
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.remove('hidden');
    }

    this.currentState = this.STATE.FROZEN;
    this.updateStatusUI();

    // Блокируем кнопку заморозки, включаем сброс и «продолжить»
    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = true;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = false;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = false;
  },

  /**
   * Возвращает режим поиска (после стоп‑кадра).
   */
  handleResume() {
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.add('hidden');
    }
    this.elements.cameraScreen.classList.remove('hidden');

    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    // Разблокируем кнопку заморозки
    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = false;

    // Очищаем результаты (опционально)
    this.clearResults();
  },

  /**
   * Полный сброс.
   */
  handleReset() {
    // Останавливаем камеру
    if (typeof Camera === 'object' && typeof Camera.stop === 'function') {
      Camera.stop();
    }

    // Возвращаем экраны
    this.elements.inputScreen.classList.remove('hidden');
    this.elements.cameraScreen.classList.add('hidden');
    if (this.elements.frozenScreen) {
      this.elements.frozenScreen.classList.add('hidden');
    }

    // Очищаем замороженный кадр
    const fc = this.elements.frozenCanvas;
    if (fc) {
      fc.width = 0;
      fc.height = 0;
    }

    // Сбрасываем состояние
    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    // Разблокируем кнопки
    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = false;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = true;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = true;

    // Очищаем результаты
    this.clearResults();

    if (typeof logLoad === 'function') {
      logLoad('UI — полный сброс выполнен', 'ok');
    }
  },

  clearResults() {
    const els = [
      'resMatrixDiam', 'resDornDiam', 'resOffset', 'resUneven', 'resVerdict'
    ];
    els.forEach(id => {
      const el = this.elements[id];
      if (el) {
        if (id === 'resVerdict') el.textContent = 'Статус: --';
        else el.textContent = '--';
      }
    });
    
    if (this.elements.resultPanel) {
      this.elements.resultPanel.classList.add('hidden');
    }
  },

  showResults(result) {
    if (!this.elements.resultPanel) return;
    
    this.elements.resultPanel.classList.remove('hidden');
    
    if (this.elements.resMatrixDiam) this.elements.resMatrixDiam.textContent = result.matrixDiameter?.toFixed(2) || '--';
    if (this.elements.resDornDiam) this.elements.resDornDiam.textContent = result.dornDiameter?.toFixed(2) || '--';
    if (this.elements.resOffset) this.elements.resOffset.textContent = result.offset?.toFixed(3) || '--';
    if (this.elements.resUneven) this.elements.resUneven.textContent = result.unevenness?.toFixed(3) || '--';
    
    if (this.elements.resVerdict) {
      const isGood = result.offset <= (parseFloat(this.elements.video.dataset.toleranceOffset) || 0) &&
                     result.unevenness <= (parseFloat(this.elements.video.dataset.toleranceUneven) || 0);
      this.elements.resVerdict.textContent = isGood ? 'Статус: В ДОПУСКЕ' : 'Статус: Брак';
    }
  },

  updateStatusUI() {
    let text = '';
    let dotColor = '#ccc';

    switch (this.currentState) {
      case this.STATE.SEARCH:
        text = 'РЕЖИМ: ОЖИДАНИЕ / ПОИСК';
        dotColor = '#3498db';
        break;
      case this.STATE.LOCKED:
        text = 'РЕЖИМ: ЗАМОРОЖЕН (в разработке)';
        dotColor = '#f39c12';
        break;
      case this.STATE.FROZEN:
        text = 'РЕЖИМ: СТОП‑КАДР';
        dotColor = '#e74c3c';
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