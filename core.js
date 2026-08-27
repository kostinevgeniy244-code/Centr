let cvReady = false;
let isRunning = true;

// СОСТОЯНИЯ
const STATE = {
    SEARCH: 'search',
    LOCKED: 'locked',
    FROZEN: 'frozen'
};
let currentState = STATE.SEARCH;
let stableRingCount = 0;
let frozenData = null;

function onOpenCVLoad() { cvReady = true; }

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

    // 1. Размеры и синхронизация
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
    ctx.drawImage(video, 0, 0, w, h);

    // --- OPENCV ---
    let srcMat = new cv.Mat(h, w, cv.CV_8UC4);
    let grayMat = new cv.Mat();
    let blurMat = new cv.Mat();
    let threshMat = new cv.Mat();
    let edgesMat = new cv.Mat();
    let contours = new cv.MatVector();
    
    // МАСКА ДЛЯ ЗОНЫ ПОИСКА (ROI)
    let maskMat = new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(0)); // Черный фон
    
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
        // Можно менять: 0.25 (уже), 0.35 (шире)
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
        // Теперь мы ищем кольцо ТОЛЬКО внутри белого круга
        let maskedBlur = new cv.Mat();
        cv.bitwise_and(blurMat, blurMat, maskedBlur, maskMat);

        // Поиск тёмного кольца на замаскированном изображении
        cv.threshold(maskedBlur, threshMat, 80, 255, cv.THRESH_BINARY_INV);
        cv.findContours(threshMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let detectedRing = null;
        let minDistFromCenter = Infinity;

        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            if (cnt.total() < 30) continue;

            let area = cv.contourArea(cnt);
            // Фильтр площади: кольцо должно быть заметным, но не гигантским
            if (area < 200 || area > 5000) continue; 

            let perimeter = cv.arcLength(cnt, true);
            if (perimeter === 0) continue;
            
            // Проверка на округлость
            let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
            if (circularity > 0.7 && circularity < 0.95) {
                let ellipse = cv.fitEllipse(cnt);
                
                // ГЛАВНОЕ ИЗМЕНЕНИЕ: выбираем кольцо, ближайшее к центру кадра
                let dist = Math.hypot(ellipse.center.x - centerX, ellipse.center.y - centerY);
                
                if (dist < minDistFromCenter) {
                    minDistFromCenter = dist;
                    detectedRing = ellipse;
                }
            }
        }

        // ==========================================
        // ЛОГИКА СОСТОЯНИЙ
        // ==========================================
        
        // Отрисовка зоны поиска (для отладки - пунктирный круг)
        oCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        oCtx.lineWidth = 2;
        oCtx.setLineDash([10, 10]);
        oCtx.beginPath();
        oCtx.arc(centerX, centerY, searchRadius, 0, Math.PI * 2);
        oCtx.stroke();
        oCtx.setLineDash([]); // Сброс пунктира

        if (currentState === STATE.FROZEN && frozenData) {
            drawResult(oCtx, frozenData);
            statusEl.textContent = "ЗАМЕР ВЫПОЛНЕН (FROZEN)";
            statusEl.style.color = "green";
            requestAnimationFrame(processFrame);
            return;
        }

        if (detectedRing) {
            // Рисуем кольцо
            let color = (currentState === STATE.LOCKED) ? '#16a34a' : '#ef4444';
            drawEllipse(oCtx, detectedRing, color, 3);

            if (currentState === STATE.SEARCH) {
                stableRingCount++;
                if (stableRingCount > 5) {
                    currentState = STATE.LOCKED;
                    statusEl.textContent = "КОЛЬЦО СТАБИЛИЗИРОВАНО. ГОТОВО К ЗАМЕРУ.";
                    statusEl.style.color = "#f59e0b";
                }
            }
        } else {
            if (currentState !== STATE.SEARCH) {
                currentState = STATE.SEARCH;
                stableRingCount = 0;
                statusEl.textContent = "ИЩЕМ ТЁМНОЕ КОЛЬЦО В ЦЕНТРЕ КАДРА...";
                statusEl.style.color = "gray";
            }
        }

        // ==========================================
        // ЭТАП 2: ГЛУБОКИЙ АНАЛИЗ (ТОЛЬКО ЕСЛИ LOCKED)
        // ==========================================
        if (currentState === STATE.LOCKED) {
            // Для поиска деталей (матрицы/дорна) можно использовать всё изображение 
            // или тоже ограничить маской, если детали всегда в центре.
            // Здесь используем всё изображение, чтобы найти крупные контуры.
            cv.Canny(blurMat, edgesMat, 50, 150);
            cv.findContours(edgesMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let bestMatrix = null;
            let bestDorn = null;

            // Поиск Матрицы (самая большая)
            for (let i = 0; i < contours.size(); i++) {
                let cnt = contours.get(i);
                if (cnt.total() < 50) continue;
                try {
                    let ellipse = cv.fitEllipse(cnt);
                    // Дополнительная проверка: центр детали тоже должен быть близко к центру кадра
                    if (Math.hypot(ellipse.center.x - centerX, ellipse.center.y - centerY) < searchRadius * 1.2) {
                         if (!bestMatrix || ellipse.size.width > bestMatrix.size.width) {
                            bestMatrix = ellipse;
                         }
                    }
                } catch(e) {}
            }

            // Поиск Дорна
            if (bestMatrix) {
                for (let i = 0; i < contours.size(); i++) {
                    let cnt = contours.get(i);
                    if (cnt.total() < 30) continue;
                    try {
                        let ellipse = cv.fitEllipse(cnt);
                        let rMat = bestMatrix.size.width / 2;
                        let rDorn = ellipse.size.width / 2;
                        let dist = Math.hypot(ellipse.center.x - bestMatrix.center.x, ellipse.center.y - bestMatrix.center.y);

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
                    const scaleMat = bestMatrix.size.width / matrRealMm;
                    const scaleDorn = bestDorn.size.width / dornRealMm;
                    const diffPercent = Math.abs(scaleMat - scaleDorn) / ((scaleMat + scaleDorn) / 2) * 100;

                    if (diffPercent <= 3) {
                        const pixelsPerMm = (scaleMat + scaleDorn) / 2;
                        
                        const shiftX = bestMatrix.center.x - bestDorn.center.x;
                        const shiftY = bestMatrix.center.y - bestDorn.center.y;
                        const shiftTotalMm = Math.hypot(shiftX, shiftY) / pixelsPerMm;

                        const radiusDiffPx = Math.abs((bestMatrix.size.width/2) - (bestDorn.size.width/2));
                        const nonUniformMm = radiusDiffPx / pixelsPerMm;

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

                        document.getElementById('valShift').textContent = shiftTotalMm.toFixed(2) + ' мм';
                        document.getElementById('valNonUniform').textContent = nonUniformMm.toFixed(3) + ' мм';
                        statusEl.textContent = "СТАБИЛЬНО. НАЖМИТЕ 'ЗАМЕР'.";
                        statusEl.style.color = "#f59e0b";
                    } else {
                        statusEl.textContent = `Калибровка нестабильна (>3%). Diff: \${diffPercent.toFixed(1)}%`;
                        statusEl.style.color = "red";
                    }
                } else {
                    statusEl.textContent = "Введите размеры деталей!";
                    statusEl.style.color = "red";
                }
            } else {
                statusEl.textContent = "Детали не найдены.";
                statusEl.style.color = "orange";
            }
        }

    } catch (err) {
        console.error('❌ Ошибка:', err);
        statusEl.textContent = 'Ошибка системы';
        statusEl.style.color = 'red';
    } finally {
        srcMat.delete(); grayMat.delete(); blurMat.delete(); threshMat.delete(); 
        edgesMat.delete(); contours.delete(); maskMat.delete();
        if ('maskedBlur' in locals()) maskedBlur.delete();
    }

    requestAnimationFrame(processFrame);
}

function drawResult(ctx, data) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (data.ring) drawEllipse(ctx, data.ring, '#ef4444', 4);
    if (data.matrix) drawEllipse(ctx, data.matrix, '#2563eb', 3);
    if (data.dorn) drawEllipse(ctx, data.dorn, '#10b981', 3);
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

function freezeMeasurement() {
    if (currentState === STATE.LOCKED && frozenData) {
        currentState = STATE.FROZEN;
        console.log('Данные замера:', frozenData);
    } else {
        alert('Сначала дождитесь статуса "СТАБИЛЬНО"');
    }
}
