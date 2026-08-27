let cvReady = false;
let isRunning = true;

// СОСТОЯНИЯ СИСТЕМЫ
const STATE = {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;
let stableRingCount = 0;
let frozenData = null; // Хранилище данных для замороженного кадра

// --- ИНИЦИАЛИЗАЦИЯ OPENCV ---
function onOpenCVLoad() {
    cvReady = true;
    console.log('✅ OpenCV загружен');
    updateStatus("Камера активна. Наведите на деталь.", "gray");
}

// --- ГЛАВНЫЙ ЦИКЛ ОБРАБОТКИ КАДРА ---
function processFrame() {
    if (!isRunning || !cvReady) return;

    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const overlay = document.getElementById('overlay');
    const statusEl = document.getElementById('valStatus');
    
    if (!video || !canvas || !overlay || !statusEl) {
        stopProcessing();
        return;
    }

    // 1. Синхронизация размеров
    const container = video.closest('.video-area');
    const w = container ? container.clientWidth : video.clientWidth;
    const h = container ? container.clientHeight : video.clientHeight;

    if (w === 0 || h === 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        overlay.width = w; overlay.height = h;
    }

    const ctx = canvas.getContext('2d');
    const oCtx = overlay.getContext('2d');
    
    // Рисуем кадр из видео на буферный канвас
    ctx.drawImage(video, 0, 0, w, h);

    // --- OPENCV ИНИЦИАЛИЗАЦИЯ МАТРИЦ ---
    let srcMat = new cv.Mat(h, w, cv.CV_8UC4);
    let grayMat = new cv.Mat();
    let blurMat = new cv.Mat();
    let threshMat = new cv.Mat();
    let edgesMat = new cv.Mat();
    let contours = new cv.MatVector();
    
    // МАСКА ДЛЯ ЗОНЫ ПОИСКА (ROI) - ТОЛЬКО ЦЕНТР
    let maskMat = new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(0)); 
    
    try {
        const imageData = ctx.getImageData(0, 0, w, h);
        srcMat.data.set(imageData.data);

        cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);

        // ==========================================
        // ЭТАП 1: СОЗДАНИЕ МАСКИ (ЦЕНТР КАДРА)
        // ==========================================
        const centerX = w / 2;
        const centerY = h / 2;
        // Радиус зоны поиска: 30% от ширины кадра. 
        const searchRadius = Math.min(w, h) * 0.3; 

        // Рисуем белый круг на маске (разрешаем поиск только здесь)
        const roiCanvas = document.createElement('canvas');
        roiCanvas.width = w; roiCanvas.height = h;
        const roiCtx = roiCanvas.getContext('2d');
        
        roiCtx.fillStyle = 'white';
        roiCtx.beginPath();
        roiCtx.arc(centerX, centerY, searchRadius, 0, Math.PI * 2);
        roiCtx.fill();
        
        // Конвертируем канвас маски в Mat
        const maskData = roiCtx.getImageData(0, 0, w, h);
        maskMat.data.set(maskData.data);

        // Применяем маску к изображению для поиска кольца
        let maskedBlur = new cv.Mat();
        cv.bitwise_and(blurMat, blurMat, maskedBlur, maskMat);

        // Поиск тёмного кольца на замаскированном изображении
        // THRESH_BINARY_INV: тёмное становится белым (для findContours)
        cv.threshold(maskedBlur, threshMat, 80, 255, cv.THRESH_BINARY_INV);
        cv.findContours(threshMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let detectedRing = null;
        let minDistFromCenter = Infinity;

        // Перебор контуров для поиска лучшего кольца
        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            if (cnt.total() < 30) continue;

            let area = cv.contourArea(cnt);
            // Фильтр площади: отсекаем пыль и слишком большие объекты
            if (area < 200 || area > 5000) continue; 

            let perimeter = cv.arcLength(cnt, true);
            if (perimeter === 0) continue;
            
            // Проверка на округлость (Circularity)
            let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
            
            // Кольцо должно быть круглым, но не идеальным (из-за перспективы)
            if (circularity > 0.7 && circularity < 0.95) {
                let ellipse = cv.fitEllipse(cnt);
                
                // ГЛАВНОЕ: выбираем кольцо, ближайшее к центру кадра
                let dist = Math.hypot(ellipse.center.x - centerX, ellipse.center.y - centerY);
                
                if (dist < minDistFromCenter) {
                    minDistFromCenter = dist;
                    detectedRing = ellipse;
                }
            }
        }

        // ==========================================
        // ЛОГИКА СОСТОЯНИЙ (STATE MACHINE)
        // ==========================================
        
        // Отрисовка зоны поиска (пунктирный круг для отладки)
        oCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        oCtx.lineWidth = 2;
        oCtx.setLineDash([10, 10]);
        oCtx.beginPath();
        oCtx.arc(centerX, centerY, searchRadius, 0, Math.PI * 2);
        oCtx.stroke();
        oCtx.setLineDash([]); 

        // Если мы в режиме FROZEN, нам не нужно анализировать видео дальше
        if (currentState === STATE.FROZEN && frozenData) {
            renderFrozenView();
            return; 
        }

        if (detectedRing) {
            // Рисуем кольцо (Красный = поиск, Зеленый = стабильно)
            let color = (currentState === STATE.LOCKED) ? '#16a34a' : '#ef4444';
            drawEllipse(oCtx, detectedRing, color, 3);

            if (currentState === STATE.SEARCH) {
                stableRingCount++;
                if (stableRingCount > 5) { // 5 кадров подряд
                    currentState = STATE.LOCKED;
                    updateStatus("КОЛЬЦО СТАБИЛИЗИРОВАНО. ГОТОВО К ЗАМЕРУ.", "#f59e0b");
                    enableFreezeButton(true);
                }
            }
        } else {
            // Кольцо не найдено
            if (currentState !== STATE.SEARCH) {
                currentState = STATE.SEARCH;
                stableRingCount = 0;
                updateStatus("ИЩЕМ ТЁМНОЕ КОЛЬЦО В ЦЕНТРЕ КАДРА...", "gray");
                enableFreezeButton(false);
            }
        }

        // ==========================================
        // ЭТАП 2: ГЛУБОКИЙ АНАЛИЗ (ТОЛЬКО ЕСЛИ LOCKED)
        // ==========================================
        if (currentState === STATE.LOCKED) {
            // Для поиска деталей (матрицы/дорна) используем всё изображение
            cv.Canny(blurMat, edgesMat, 50, 150);
            cv.findContours(edgesMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let bestMatrix = null;
            let bestDorn = null;

            // Поиск Матрицы (самая большая окружность)
            for (let i = 0; i < contours.size(); i++) {
                let cnt = contours.get(i);
                if (cnt.total() < 50) continue;
                try {
                    let ellipse = cv.fitEllipse(cnt);
                    // Проверка: центр детали тоже должен быть близко к центру кадра
                    if (Math.hypot(ellipse.center.x - centerX, ellipse.center.y - centerY) < searchRadius * 1.2) {
                         if (!bestMatrix || ellipse.size.width > bestMatrix.size.width) {
                            bestMatrix = ellipse;
                         }
                    }
                } catch(e) {}
            }

            // Поиск Дорна (внутри матрицы)
            if (bestMatrix) {
                for (let i = 0; i < contours.size(); i++) {
                    let cnt = contours.get(i);
                    if (cnt.total() < 30) continue;
                    try {
                        let ellipse = cv.fitEllipse(cnt);
                        let rMat = bestMatrix.size.width / 2;
                        let rDorn = ellipse.size.width / 2;
                        let dist = Math.hypot(ellipse.center.x - bestMatrix.center.x, ellipse.center.y - bestMatrix.center.y);

                        // Дорн должен быть меньше матрицы и находиться внутри неё
                        if (ellipse.size.width < bestMatrix.size.width * 0.7 && (dist + rDorn) < rMat) {
                            if (!bestDorn || ellipse.size.width > bestDorn.size.width) {
                                bestDorn = ellipse;
                            }
                        }
                    } catch(e) {}
                }
            }

            if (bestMatrix && bestDorn) {
                drawEllipse(oCtx, bestMatrix, '#2563eb', 3);
                drawEllipse(oCtx, bestDorn, '#10b981', 3);

                const dornRealMm = parseFloat(document.getElementById('dornDiam').value);
                const matrRealMm = parseFloat(document.getElementById('matrDiam').value);

                if (dornRealMm && matrRealMm) {
                    // Расчет масштаба
                    const scaleMat = bestMatrix.size.width / matrRealMm;
                    const scaleDorn = bestDorn.size.width / dornRealMm;
                    const diffPercent = Math.abs(scaleMat - scaleDorn) / ((scaleMat + scaleDorn) / 2) * 100;

                    if (diffPercent <= 3) {
                        const pixelsPerMm = (scaleMat + scaleDorn) / 2;
                        
                        // Смещение
                        const shiftX = bestMatrix.center.x - bestDorn.center.x;
                        const shiftY = bestMatrix.center.y - bestDorn.center.y;
                        const shiftTotalMm = Math.hypot(shiftX, shiftY) / pixelsPerMm;

                        // Неравномерность зазора
                        const radiusDiffPx = Math.abs((bestMatrix.size.width/2) - (bestDorn.size.width/2));
                        const nonUniformMm = radiusDiffPx / pixelsPerMm;

                        // Сохраняем данные
                        frozenData = {
                            shiftTotal: shiftTotalMm,
                            shiftX: shiftX / pixelsPerMm,
                            shiftY: shiftY / pixelsPerMm,
                            nonUniform: nonUniformMm,
                            nominalGap: (matrRealMm - dornRealMm) / 2,
                            scale: pixelsPerMm,
                            matrix: bestMatrix,
                            dorn: bestDorn,
                            ring: detectedRing
                        };

                        // Вывод в UI
                        document.getElementById('valShift').textContent = shiftTotalMm.toFixed(2) + ' мм';
                        document.getElementById('valNonUniform').textContent = nonUniformMm.toFixed(3) + ' мм';
                        document.getElementById('valNominal').textContent = ((matrRealMm - dornRealMm)/2).toFixed(2) + ' мм';
                        
                        updateStatus("СТАБИЛЬНО. НАЖМИТЕ 'ЗАМЕР'.", "#f59e0b");
                    } else {
                        updateStatus(`Калибровка нестабильна (>3%). Diff: \${diffPercent.toFixed(1)}%`, "red");
                        enableFreezeButton(false);
                    }
                } else {
                    updateStatus("Введите размеры деталей!", "red");
                    enableFreezeButton(false);
                }
            } else {
                updateStatus("Детали не найдены.", "orange");
                enableFreezeButton(false);
            }
        }

    } catch (err) {
        console.error('❌ Ошибка обработки:', err);
        updateStatus('Ошибка системы', 'red');
    } finally {
        srcMat.delete(); grayMat.delete(); blurMat.delete(); threshMat.delete(); 
        edgesMat.delete(); contours.delete(); maskMat.delete();
        if ('maskedBlur' in locals()) maskedBlur.delete();
    }

    requestAnimationFrame(processFrame);
}

// --- ФУНКЦИИ УПРАВЛЕНИЯ ---

function freezeMeasurement() {
    if (currentState !== STATE.LOCKED || !frozenData) {
        alert('Сначала дождитесь статуса "СТАБИЛЬНО"');
        return;
    }

    currentState = STATE.FROZEN;
    
    const video = document.getElementById('video');
    const frozenImg = document.getElementById('frozenImg');
    const overlay = document.getElementById('overlay');
    const canvas = document.getElementById('canvas');
    const frozenOverlay = document.getElementById('frozenOverlay');
    
    if (!video || !frozenImg || !overlay || !canvas || !frozenOverlay) return;

    const w = video.clientWidth;
    const h = video.clientHeight;
    
    // 1. Создаем временный канвас для "скриншота"
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');

    // 2. Рисуем кадр из видео
    tempCtx.drawImage(video, 0, 0, w, h);

    // 3. Копируем на этот же канвас все линии из оверлея (overlay)
    tempCtx.drawImage(overlay, 0, 0, w, h);

    // 4. Сохраняем результат в IMG
    frozenImg.src = tempCanvas.toDataURL('image/png');
    
    // 5. Переключаем видимость слоев
    video.style.display = 'none';
    overlay.style.display = 'none';
    canvas.style.display = 'none';
    
    frozenImg.style.display = 'block';
    frozenOverlay.style.display = 'block';

    // 6. Обновляем статус и кнопку
    updateStatus("✅ ЗАМЕР ВЫПОЛНЕН. ДАННЫЕ СОХРАНЕНЫ.", "green");
    enableFreezeButton(false);

    console.log('Кадр заморожен. Данные:', frozenData);
}

function renderFrozenView() {
    const frozenImg = document.getElementById('frozenImg');
    const frozenOverlay = document.getElementById('frozenOverlay');
    
    if (!frozenImg || !frozenOverlay || !frozenData) return;

    const w = frozenImg.clientWidth;
    const h = frozenImg.clientHeight;

    if (frozenOverlay.width !== w || frozenOverlay.height !== h) {
        frozenOverlay.width = w;
        frozenOverlay.height = h;
    }

    const ctx = frozenOverlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Рисуем сохраненные контуры
    if (frozenData.ring) drawEllipse(ctx, frozenData.ring, '#ef4444', 4);
    if (frozenData.matrix) drawEllipse(ctx, frozenData.matrix, '#2563eb', 3);
    if (frozenData.dorn) drawEllipse(ctx, frozenData.dorn, '#10b981', 3);
    
    // Крестик в центре
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
    ctx.stroke();
}

function stopProcessing() {
    isRunning = false;
}

function updateStatus(text, color) {
    const el = document.getElementById('valStatus');
    if (el) {
        el.textContent = text;
        el.style.color = color;
    }
}

function enableFreezeButton(enabled) {
    const btn = document.getElementById('btnFreeze');
    if (btn) {
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.5';
    }
}

function drawEllipse(ctx, ellipse, color, width) {
    ctx.beginPath();
    ctx.save();
    ctx.translate(ellipse.center.x, ellipse.center.y);
    ctx.rotate(ellipse.angle * Math.PI / 180);
    ctx.ellipse(0, 0, ellipse.size.width / 2, ellipse.size.height / 2, 0, 0, Math.PI * 2);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(ellipse.center.x - 4, ellipse.center.y - 4, 8, 8);
}

// Запуск цикла
window.addEventListener('load', () => {
    if (cvReady) processFrame();
});
