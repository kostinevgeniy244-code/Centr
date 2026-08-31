// ui.js

import { Camera } from './camera.js';
import { CONFIG } from './config.js';

function logLoad(msg, type = 'ok') {
  const list = document.getElementById('load-messages');
  if (!list) return;
  const li = document.createElement('li');
  li.textContent = msg;
  li.className = type;
  list.appendChild(li);
}

// UI ещё не создан, но функция logLoad уже доступна
logLoad('ui.js — подключён', 'ok');

const UI = {
  elements: {
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
  },

  STATE: {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen',
  },

  currentState: null,

  init() {
    const el = this.elements;
    if (!el.inputScreen || !el.cameraScreen) {
      console.error('❌ Не найдены ключевые DOM-элементы');
      return false;
  logLoad('UI — инициализирован', 'ok');
 
 }

    // Кнопка «Начать замер»
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const matrixDiam = parseFloat(el.matrixDiameterInput.value);
        const dornDiam = parseFloat(el.dornDiameterInput.value);
        const tolOffset = parseFloat(el.toleranceOffsetInput.value) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
        const tolUneven = parseFloat(el.toleranceUnevenInput.value) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

        if (!matrixDiam || !dornDiam) {
          alert('Введите диаметры матрицы и дорна');
          return;
        }

        const params = {
          matrixDiameter: matrixDiam,
          dornDiameter: dornDiam,
          toleranceOffset: tolOffset,
          toleranceUneven: tolUneven,
        };

        this.startMeasurement(params);
      });
    }

    // Кнопка «Зафиксировать результат»
    if (el.freezeBtn) {
      el.freezeBtn.addEventListener('click', () => this.freezeResult());
    }

    // Кнопка «Сброс»
    if (el.resetBtn) {
      el.resetBtn.addEventListener('click', () => this.reset());
    }

    return true;
  },

  startMeasurement(params) {
    // Сохраняем параметры в data-атрибут для доступа из app.js/cv-processing.js
    this.elements.video.dataset.matrixDiameter = params.matrixDiameter;
    this.elements.video.dataset.dornDiameter = params.dornDiameter;
    this.elements.video.dataset.toleranceOffset = params.toleranceOffset;
    this.elements.video.dataset.toleranceUneven = params.toleranceUneven;

    // Переключаем экраны
    this.elements.inputScreen.classList.add('hidden');
    this.elements.cameraScreen.classList.remove('hidden');

    // Запускаем камеру
    Camera.init();
    Camera.start().then(() => {
      this.setState(this.STATE.SEARCH);
    });
  },

  setState(state) {
    this.currentState = state;

    const dot = this.elements.statusDot;
    const text = this.elements.statusText;

    dot.className = 'dot';
    text.textContent = '';

    switch (state) {
      case this.STATE.SEARCH:
        dot.classList.add('dot-search');
        text.textContent = 'РЕЖИМ: ПОИСК';
        this.elements.freezeBtn.disabled = true;
        break;
      case this.STATE.LOCKED:
        dot.classList.add('dot-locked');
        text.textContent = 'РЕЖИМ: ГОТОВО К ЗАМЕРУ';
        this.elements.freezeBtn.disabled = false;
        break;
      case this.STATE.FROZEN:
        dot.classList.add('dot-frozen');
        text.textContent = 'РЕЖИМ: ЗАФИКСИРОВАНО';
        this.elements.freezeBtn.disabled = true;
        break;
    }
  },

  updateResults(result) {
    if (!result) return;

    const el = this.elements;
    el.resMatrixDiam.textContent = result.matrixDiam.toFixed(3);
    el.resDornDiam.textContent = result.dornDiam.toFixed(3);
    el.resOffset.textContent = result.offset.toFixed(3);
    el.resUneven.textContent = result.unevenness.toFixed(3);

    let verdict = 'ГОДЕН';
    let className = 'good';

    // Простая логика вердикта по допускам
    const tolOffset = parseFloat(this.elements.video.dataset.toleranceOffset) || CONFIG.DEFAULT_TOLERANCE_OFFSET;
    const tolUneven = parseFloat(this.elements.video.dataset.toleranceUneven) || CONFIG.DEFAULT_TOLERANCE_UNEVEN;

    if (result.offset > tolOffset || result.unevenness > tolUneven) {
      verdict = 'БРАК';
      className = 'bad';
    }

    el.resVerdict.textContent = verdict;
    el.resVerdict.className = 'verdict ' + className;

    // Показываем панель результатов
    el.resultPanel.classList.remove('hidden');
  },

  freezeResult() {
    if (this.currentState !== this.STATE.LOCKED) return;

    // Скрываем видео, показываем frozen-canvas
    this.elements.video.style.display = 'none';
    this.elements.frozenCanvas.style.display = 'block';

    // Делаем стоп‑кадр полного размера
    Camera.captureFrame(this.elements.frozenCanvas);

    this.setState(this.STATE.FROZEN);
  },

  reset() {
    // Очищаем результаты
    const el = this.elements;
    el.resMatrixDiam.textContent = '—';
    el.resDornDiam.textContent = '—';
    el.resOffset.textContent = '—';
    el.resUneven.textContent = '—';
    el.resVerdict.textContent = '';
    el.resVerdict.className = 'verdict';
    el.resultPanel.classList.add('hidden');

    // Возвращаем видео, убираем frozen-canvas
    el.video.style.display = 'block';
    el.frozenCanvas.style.display = 'none';

    Camera.stop();
    Camera.init(); // повторно инициализируем video-элемент
    Camera.start().then(() => {
      this.setState(this.STATE.SEARCH);
    });
  },
};

export { UI };

// Конец файла