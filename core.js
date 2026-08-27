// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================
let cvReady = false;
let isRunning = false;

const STATE = {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;
let stableRingCount = 0;
let frozenData = null;

let videoEl, canvasEl, overlayEl, frozenImgEl, frozenOverlayEl;

const PARAMS = {
    matrixDiam: 50,
    dornDiam: 30
};
const STABLE_THRESHOLD = 20; // кадров стабильности для автозамера

// ==========================================
// OPENCV & СТАТУС
// ==========================================
function onOpenCVLoad() {
    cvReady = true;
    console.log('✅ OpenCV загружен');
    updateStatus("OpenCV готов. Нажмите 'ЗАПУСТИТЬ КАМЕРУ'.", "var(--muted)");
}

function updateStatus(text, color) {
    const el = document.getElementById('valStatus');
    const dot = document.getElementById('statusDot');
    if (el) { el.textContent = text; el.style.color = color || 'var(--text)'; }
    if (dot) { dot.style.backgroundColor = color || '#9ca3af'; }
}

// ==========================================
// КАМЕРА
// ==========================================
async function startCamera() {
    videoEl = document.getElementById('video');
    if (!videoEl) { console.error('❌ Элемент #video не найден'); return; }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
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
        console.error('❌ Ошибка камеры:', err);
        let msg = "Ошибка камеры!";
        if (err.name === 'NotAllowedError') msg = "Доступ к камере запрещён.";
        if (err.name === 'NotFoundError') msg = "Камера не найдена.";
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
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 480;
    canvasEl.width = w; canvasEl.height = h;
    overlayEl.width = w; overlayEl.height = h;
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
        // Захват кадра
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        srcMat.data.set(imageData.data);

        // Обработка
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
            if (area < 5000 || area > 200000) continue;

            const rect = cv.boundingRect(cnt);
            const aspectRatio = rect.width / rect.height;
            if (aspectRatio > 0.8 && aspectRatio < 1.25) {
                if (area > maxArea) {
                    maxArea = area;
                    bestRing = {
                        rect: rect,
                        area: area,
                        moments: cv.moments(cnt),
                        cnt: cnt // сохраняем контур для более точной отрисовки окружности
                    };
                }
            }
        }

        contours.delete(); hierarchy.delete();
        grayMat.delete(); blurMat.delete(); edgesMat.delete(); srcMat.delete();

        // === ЛОГИКА СОСТОЯНИЙ ===
        if (currentState === STATE.FROZEN) {
            requestAnimationFrame(processFrame);
            return;
        }

        if (!bestRing) {
            currentState = STATE.SEARCH;
            stableRingCount = 0;
            drawOverlay(null);
            updateStatus("Не вижу деталь. Наведите камеру.", "var(--warning)");
        } else {
            stableRingCount++;

            // Рисуем в любом случае (поиск и стабильность)
            drawOverlay(bestRing);

            if (stableRingCount >= STABLE_THRESHOLD) {
                currentState = STATE.LOCKED;
                updateStatus("Стабильность достигнута. Выполняю замер...", "var(--primary)");
                isRunning = false;
                setTimeout(() => autoFreezeMeasurement(bestRing), 100);
            } else {
                currentState = STATE.SEARCH;
                const pct = Math.round((stableRingCount / STABLE_THRESHOLD) * 100);
                updateStatus(`Стабильность: ${pct}% (${stableRingCount}/${STABLE_THRESHOLD})`, "var(--muted)");
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
// ОТРИСОВКА (С ОКРУЖНОСТЬЮ)
// ==========================================
function drawOverlay(ring) {
    const ctx = overlayEl.getContext('2d');
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

    if (!ring) return;

    // 1. Пунктирная рамка (ROI)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.strokeRect(ring.rect.x, ring.rect.y, ring.rect.width, ring.rect.height);

    // 2. Центр (красная точка)
    const cx = ring.rect.x + ring.rect.width / 2;
    const cy = ring.rect.y + ring.rect.height / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3b3b';
    ctx.fill();

    // 3. Окружность (синяя) — то, как система «видит» кольцо
    // Радиус берём из площади: S = πr² → r = sqrt(S/π)
    const r = Math.sqrt(ring.area / Math.PI);
    
    ctx.strokeStyle = '#007bff'; // синий
    ctx.lineWidth = 3;
    ctx.setLineDash([]); // сплошная линия
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Подпись радиуса (для контроля)
    ctx.font = '14px Arial';
    ctx.fillStyle = '#007bff';
    ctx.textAlign = 'left';
    ctx.fillText(`r ≈ ${r.toFixed(1)} px`, cx + 12, cy - 12);

    ctx.restore();
}

// ==========================================
// АВТОЗАМЕР И ЗАМОРОЗКА
// ==========================================
function autoFreezeMeasurement(ring) {
    currentState = STATE.FROZEN;

    const imgUrl = canvasEl.toDataURL('image/png');
    frozenImgEl.src = imgUrl;
    frozenImgEl.style.display = 'block';

    videoEl.style.display = 'none';
    overlayEl.style.display = 'none';

    drawFrozenOverlay(ring);

    // Пример расчёта (заменить на реальную геометрию при калибровке)
    const nominalGap = (PARAMS.matrixDiam - PARAMS.dornDiam) / 2;
    const measuredShift = Math.random() * 0.5;
    const measuredNonUniform = Math.random() * 0.3;

    document.getElementById('valNominal').textContent = nominalGap.toFixed(2) + ' мм';
    document.getElementById('valShift').textContent = measuredShift.toFixed(2) + ' мм';
    document.getElementById('valNonUniform').textContent = measuredNonUniform.toFixed(2) + ' мм';

    updateStatus("Замер выполнен. Результаты выше.", "var(--success)");
}

function drawFrozenOverlay(ring) {
    const ctx = frozenOverlayEl.getContext('2d');
    ctx.clearRect(0, 0, frozenOverlayEl.width, frozenOverlayEl.height);
    if (!ring) return;

    ctx.save();
    ctx.strokeStyle = '#d9534f'; // красный для замороженного кадра
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    
    const cx = ring.rect.x + ring.rect.width / 2;
    const cy = ring.rect.y + ring.rect.height / 2;
    const r = Math.sqrt(ring.area / Math.PI);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    frozenOverlayEl.style.display = 'block';
}

// ==========================================
// СБРОС
// ==========================================
function resetSystem() {
    currentState = STATE.SEARCH;
    stableRingCount = 0;
    isRunning = true;

    if(videoEl) { videoEl.style.display = 'block'; overlayEl.style.display = 'block'; }
    if(frozenImgEl) frozenImgEl.style.display = 'none';
    if(frozenOverlayEl) frozenOverlayEl.style.display = 'none';

    updateStatus("Система сброшена. Наведите на деталь.", "var(--muted)");
    processFrame();
}
