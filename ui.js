if (typeof logLoad === 'function') {
  logLoad('ui.js — подключён', 'ok');
}

export const UI = {
  elements: {},
  camera: null, // Храним ссылку на камеру внутри UI
  STATE: {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen',
  },
  currentState: null,

  // ВАЖНО: теперь init принимает камеру как аргумент
  init(cameraModule) {
    this.camera = cameraModule;

    this.elements = {
      inputScreen: document.getElementById('input-screen'),
      cameraScreen: document.getElementById('camera-screen'),
      frozenScreen: document.getElementById('frozen-screen'),
      statusText: document.getElementById('status-text'),
      statusDot: document.getElementById('status-dot'),
      video: document.getElementById('video'),
      overlay: document.getElementById('overlay'),
      frozenCanvas: document.getElementById('frozen-canvas'),
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

    const criticalIds = ['input-screen', 'camera-screen', 'video', 'overlay', 'start-btn'];
    const missing = criticalIds.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
      const msg = `❌ Не найдены критические элементы: \${missing.join(', ')}`;
      console.error(msg);
      if (typeof logLoad === 'function') logLoad(msg, 'err');
      return;
    }

    if (this.elements.freezeBtn) {
      this.elements.freezeBtn.addEventListener('click', () => this.handleFreeze());
    }
    if (this.elements.resetBtn) {
      this.elements.resetBtn.addEventListener('click', () => this.handleReset());
    }
    if (this.elements.resumeBtn) {
      this.elements.resumeBtn.addEventListener('click', () => this.handleResume());
    }
    if (this.elements.resetBtnFrozen) {
      this.elements.resetBtnFrozen.addEventListener('click', () => this.handleReset());
    }

    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    if (typeof logLoad === 'function') logLoad('UI — инициализирован', 'ok');
  },

  handleStart() {
    const matrixDiam = parseFloat(this.elements.matrixDiameterInput.value);
    const dornDiam = parseFloat(this.elements.dornDiameterInput.value);
    const tolOffset = parseFloat(this.elements.toleranceOffsetInput.value) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
    const tolUneven = parseFloat(this.elements.toleranceUnevenInput.value) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

    if (!matrixDiam || !dornDiam || matrixDiam <= 0 || dornDiam <= 0) {
      alert('⚠️ Укажите корректные диаметры матрицы и дорна (больше 0)');
      return;
    }

    this.elements.video.dataset.matrixDiameter = matrixDiam.toString();
    this.elements.video.dataset.dornDiameter = dornDiam.toString();
    this.elements.video.dataset.toleranceOffset = tolOffset.toString();
    this.elements.video.dataset.toleranceUneven = tolUneven.toString();

    this.elements.inputScreen.classList.add('hidden');
    this.elements.cameraScreen.classList.remove('hidden');
    if (this.elements.frozenScreen) this.elements.frozenScreen.classList.add('hidden');

    this.clearResults();

    // Используем this.camera вместо глобальной Camera
    if (this.camera && typeof this.camera.init === 'function') {
      this.camera.init();
      this.camera.start().catch(err => {
        alert('❌ Не удалось запустить камеру. Проверьте разрешения.');
        this.handleReset();
      });
    } else {
      const msg = '❌ Объект Camera не передан в UI или не имеет метода init';
      console.error(msg);
      if (typeof logLoad === 'function') logLoad(msg, 'err');
    }
  },

  handleFreeze() {
    if (!this.camera || !this.camera.isRunning) return;
    this.camera.captureFrame(this.elements.frozenCanvas);

    this.elements.cameraScreen.classList.add('hidden');
    if (this.elements.frozenScreen) this.elements.frozenScreen.classList.remove('hidden');

    this.currentState = this.STATE.FROZEN;
    this.updateStatusUI();

    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = true;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = false;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = false;
  },

  handleResume() {
    if (this.elements.frozenScreen) this.elements.frozenScreen.classList.add('hidden');
    this.elements.cameraScreen.classList.remove('hidden');

    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = false;
    this.clearResults();
  },

  handleReset() {
    if (this.camera && typeof this.camera.stop === 'function') {
      this.camera.stop();
    }

    this.elements.inputScreen.classList.remove('hidden');
    this.elements.cameraScreen.classList.add('hidden');
    if (this.elements.frozenScreen) this.elements.frozenScreen.classList.add('hidden');

    const fc = this.elements.frozenCanvas;
    if (fc) { fc.width = 0; fc.height = 0; }

    this.currentState = this.STATE.SEARCH;
    this.updateStatusUI();

    if (this.elements.freezeBtn) this.elements.freezeBtn.disabled = false;
    if (this.elements.resumeBtn) this.elements.resumeBtn.disabled = true;
    if (this.elements.resetBtnFrozen) this.elements.resetBtnFrozen.disabled = true;

    this.clearResults();
    if (typeof logLoad === 'function') logLoad('UI — полный сброс выполнен', 'ok');
  },

  clearResults() {
    const els = ['resMatrixDiam', 'resDornDiam', 'resOffset', 'resUneven', 'resVerdict'];
    els.forEach(id => {
      const el = this.elements[id];
      if (el) {
        if (id === 'resVerdict') el.textContent = 'Статус: --';
        else el.textContent = '--';
      }
    });
    if (this.elements.resultPanel) this.elements.resultPanel.classList.add('hidden');
  },

  showResults(result) {
    if (!this.elements.resultPanel) return;
    this.elements.resultPanel.classList.remove('hidden');
    if (this.elements.resMatrixDiam) this.elements.resMatrixDiam.textContent = result.matrixDiameter?.toFixed(2) || '--';
    if (this.elements.resDornDiam) this.elements.resDornDiam.textContent = result.dornDiameter?.toFixed(2) || '--';
    if (this.elements.resOffset) this.elements.resOffset.textContent = result.offset?.toFixed(3) || '--';
    if (this.elements.resUneven) this.elements.resUneven.textContent = result.unevenness?.toFixed(3) || '--';
    
    if (this.elements.resVerdict) {
      const tolOffset = parseFloat(this.elements.video.dataset.toleranceOffset) || 0;
      const tolUneven = parseFloat(this.elements.video.dataset.toleranceUneven) || 0;
      const isGood = result.offset <= tolOffset && result.unevenness <= tolUneven;
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
    if (this.elements.statusText) this.elements.statusText.textContent = text;
    if (this.elements.statusDot) this.elements.statusDot.style.backgroundColor = dotColor;
  },
};