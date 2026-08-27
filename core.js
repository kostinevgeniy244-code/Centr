// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================
let cvReady = false;
let isRunning = false; // Флаг работы цикла обработки кадров

// СОСТОЯНИЯ СИСТЕМЫ
const STATE = {
    SEARCH: 'search',      // Ищем деталь
    LOCKED: 'locked',      // Деталь стабильна, скоро будет автозамер
    FROZEN: 'frozen'       // Кадр заморожен, замер выполнен
};
let currentState = STATE.SEARCH;
let stableRingCount = 0;   // Счётчик стабильных кадров
let frozenData = null;     // Данные последнего замера

// Элементы DOM
let videoEl, canvasEl, overlayEl, frozenImgEl, frozenOverlayEl;

// Параметры детали
const PARAMS = {
    matrixDiam: 50,
    dornDiam: 30
};

// Порог стабильности (кадров подряд) для автозамера
const STABLE_THRESHOLD = 20;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ OPENCV
// ==========================================
function onOpenCVLoad() {
    cvReady = true;
    console.log('✅ OpenCV загружен');
    updateStatus("OpenCV готов. Нажмите 'ЗАПУСТИТЬ КАМЕРУ'.", "var(--muted)");
}

function updateStatus(text, color) {
    const el = document.getElementById('valStatus');
    const dot = document.getElementById('statusDot');
    if (el) {
        el.textContent = text;
        el.style.color = color || 'var(--text)';
    }
    if (dot) {
        dot.style.backgroundColor = color || '#9ca3af';
    }
}

// ==========================================
// ЗАПУСК КАМЕРЫ
// ==========================================
async function startCamera() {
    videoEl = document.getElementById('video');
    
    if (!videoEl) {
        console.error('❌ Элемент #video не найден');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'environment' // Задняя камера
            },
            audio: false
        });

        videoEl.srcObject = stream;
        
        videoEl.onloadedmetadata = () => {
            videoEl.play();
            updateStatus("Камера активна. Наведите на деталь.", "var(--success)");
            
            initElements();
            isRunning = true;
            processFrame();
        };

    } catch (err) {
        console.error('❌ Ошибка доступа к камере:', err);
        let msg = "Ошибка камеры!";
        if (err.name === 'NotAllowedError') msg = "Доступ к камере запрещён.";
        if (err.name === 'NotFoundError') msg = "Камера не найдена или занята другим приложением.";
        
        updateStatus(msg, "var(--danger)");
        alert(msg);
    }
}

function initElements() {
    canvasEl = document.getElementById('canvas');
    overlayEl = document.getElementById('overlay');
    frozenImgEl = document.getElementById('frozenImg');
    frozenOverlayEl = document.getElementById('frozenOverlay');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!videoEl || !canvasEl || !overlayEl) return;
    
    const width = videoEl.videoWidth || 640;
    const height = videoEl.videoHeight || 480;
    
    canvasEl.width = width;
    canvasEl.height = height;
    overlayEl.width = width;
    overlayEl.height = height;
}

// ==========================================
// ЦИКЛ ОБРАБОТКИ КАДРОВ
// ==========================================
function processFrame() {
    if (!isRunning || !cvReady || !videoEl || videoEl.paused || videoEl.ended) {
        requestAnimationFrame(processFrame);
        return;
    }

    resizeCanvas();

    const srcMat = new cv.Mat(videoEl.height, videoEl.width, cv.CV_8UC4);
    const grayMat = new cv.Mat();
    const blurMat = new cv.Mat();
    const edgesMat = new cv.Mat();

    try {
        // Захват кадра из видео в canvas
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        srcMat.data.set(imageData.data);

        // Обработка изображения
        cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);
        cv.Canny(blurMat, edgesMat, 50, 150);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(edgesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let bestRing = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            
            // Фильтр по площади (подбирай под свою деталь)
            if (area < 5000 || area > 200000) continue;

            const rect = cv.boundingRect(cnt);
            const aspectRatio = rect.width / rect.height;
            
            // Почти круглая форма
            if (aspectRatio > 0.8 && aspectRatio < 1.25) {
                if (area > maxArea) {
                    maxArea = area;
                    bestRing = {
                        rect: rect,
                        area: area,
                        moments: cv.moments(cnt)
                    };
                }
            }
        }

        contours.delete();
        hierarchy.delete();
        grayMat.delete();
        blurMat.delete();
        edgesMat.delete();
        srcMat.delete();

        // === ЛОГИКА СОСТОЯНИЙ И АВТОЗАМЕР ===
        
        if (currentState === STATE.FROZEN) {
            requestAnimationFrame(processFrame);
            return;
        }

        if (!bestRing) {
            // Деталь не найдена
            currentState = STATE.SEARCH;
            stableRingCount = 0;
            drawOverlay(null);
            updateStatus("Не вижу деталь. Наведите камеру.", "var(--warning)");
        } else {
            // Деталь найдена — проверяем стабильность
            stableRingCount++;

            if (stableRingCount >= STABLE_THRESHOLD) {
                // СТАБИЛЬНОСТЬ ДОСТИГНУТА → АВТОЗАМЕР
                currentState = STATE.LOCKED;
                updateStatus("Стабильность достигнута. Выполняю замер...", "var(--primary)");
                
                // Останавливаем цикл и делаем замер
                isRunning = false;
                setTimeout(() => {
                    autoFreezeMeasurement(bestRing);
                }, 100); // небольшая задержка, чтобы кадр точно был актуальным
            } else {
                currentState = STATE.SEARCH;
                drawOverlay(bestRing);
                updateStatus(`Поиск стабильного положения... (${stableRingCount}/${STABLE_THRESHOLD})`, "var(--muted)");
            }
        }

    } catch (e) {
        console.error("Ошибка обработки кадра:", e);
    } finally {
        if (isRunning) {
            requestAnimationFrame(processFrame);
        }
    }
}

// ==========================================
// АВТОЗАМЕР (БЕЗ КНОПКИ)
// ==========================================
function autoFreezeMeasurement(ring) {
    currentState = STATE.FROZEN;
    
    // 1. Делаем скриншот текущего кадра
    const imgUrl = canvasEl.toDataURL('image/png');
    frozenImgEl.src = imgUrl;
    frozenImgEl.style.display = 'block';
    
    // Скрываем видео и живой оверлей
    videoEl.style.display = 'none';
    overlayEl.style.display = 'none';

    // Рисуем линии на замороженном оверлее
    drawFrozenOverlay(ring);

    // 2. Расчёт результатов (упрощённый)
    const nominalGap = (PARAMS.matrixDiam - PARAMS.dornDiam) / 2;
    
    // Эмуляция смещения и неравномерности (заменить на реальную геометрию при калибровке)
    const measuredShift = Math.random() * 0.5; // мм
    const measuredNonUniform = Math.random() * 0.3; // мм

    document.getElementById('valNominal').textContent = nominalGap.toFixed(2) + ' мм';
    document.getElementById('valShift').textContent = measuredShift.toFixed(2) + ' мм';
    document.getElementById('valNonUniform').textContent = measuredNonUniform.toFixed(2) + ' мм';

    updateStatus("Замер выполнен. Результаты выше.", "var(--success)");
}

function drawOverlay(ring) {
    const ctx = overlayEl.getContext('2d');
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

    if (!ring) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    
    ctx.strokeRect(ring.rect.x, ring.rect.y, ring.rect.width, ring.rect.height);
    
    const cx = ring.rect.x + ring.rect.width / 2;
    const cy = ring.rect.y + ring.rect.height / 2;
    
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'red';
    ctx.fill();
    
    ctx.restore();
}

function drawFrozenOverlay(ring) {
    const ctx = frozenOverlayEl.getContext('2d');
    ctx.clearRect(0, 0, frozenOverlayEl.width, frozenOverlayEl.height);
    
    if (!ring) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    
    ctx.strokeRect(ring.rect.x, ring.rect.y, ring.rect.width, ring.rect.height);
    
    const cx = ring.rect.x + ring.rect.width / 2;
    const cy = ring.rect.y + ring.rect.height / 2;
    
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ff0000';
    ctx.fill();
    
    ctx.restore();
    
    frozenOverlayEl.style.display = 'block';
}

// ==========================================
// СБРОС СИСТЕМЫ
// ==========================================
function resetSystem() {
    currentState = STATE.SEARCH;
    stableRingCount = 0;
    frozenData = null;
    isRunning = true;

    if(videoEl) {
        videoEl.style.display = 'block';
        overlayEl.style.display = 'block';
    }
    
    if(frozenImgEl) frozenImgEl.style.display = 'none';
    if(frozenOverlayEl) frozenOverlayEl.style.display = 'none';

    updateStatus("Система сброшена. Наведите на деталь.", "var(--muted)");
    
    processFrame(); // Перезапускаем цикл
}
