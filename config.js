// config.js

// Константы и настройки проекта
const CONFIG = {
  // Рабочее разрешение для обработки OpenCV (меньше = быстрее на мобильном)
  PROCESS_WIDTH: 320,

  // Пороговые значения для детекции контуров
  CANNY_THRESH_1: 50,
  CANNY_THRESH_2: 150,

  // Морфологическое ядро для замыкания разрывов контура
  MORPH_KERNEL_SIZE: 3,

  // Минимальная площадь контура (в пикселях на рабочем разрешении)
  MIN_CONTOUR_AREA: 200,

  // Порог круглости (0–1): насколько контур должен быть близок к кругу
  CIRCULARITY_THRESHOLD: 0.85,

  // Допуски по умолчанию (мм)
  DEFAULT_TOLERANCE_OFFSET: 0.01,
  DEFAULT_TOLERANCE_UNEVEN: 0.01,

  // Минимально допустимый масштаб (мм/пиксель) — защита от абсурдных значений
  MIN_SCALE_MM_PER_PX: 0.05,
  MAX_SCALE_MM_PER_PX: 1.0,

  // Настройки камеры
  CAMERA_CONSTRAINTS: {
    facingMode: { ideal: 'environment' }, // тыловая камера
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },

  // Цвета отрисовки (BGR для OpenCV, но тут для UI)
  COLORS: {
    MATRIX: [0, 170, 255],      // синий
    DORN: [100, 255, 100],      // зелёный
    OFFSET_LINE: [0, 165, 255], // оранжево-жёлтый
    TEXT: [255, 255, 255],
  },
};

// Экспортируем конфигурацию, чтобы другие модули могли её использовать
export { CONFIG };
function logLoad(msg, type = 'ok') {
  const list = document.getElementById('load-messages');
  if (!list) return;
  const li = document.createElement('li');
  li.textContent = msg;
  li.className = type;
  list.appendChild(li);
}

// Конец файла
