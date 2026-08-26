let cvReady = false;
let frameCount = 0;

// Инициализация флага готовности OpenCV (вызывается после загрузки opencv.js)
function onOpenCVLoad() {
    cvReady = true;
    console.log('✅ OpenCV загружен и готов к работе');
}

function processFrame() {
    if (!isRunning || !cvReady) return;

    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const overlay = document.getElementById('overlay');
    
    if (!video || !canvas || !overlay) {
        stopProcessing();
        return;
    }

    // 1. Получаем реальные размеры области видео
    const container = video.closest('.video-area');
    const w = container ? container.clientWidth : video.clientWidth;
    const h = container ? container.clientHeight : video.clientHeight;

    if (w === 0 || h === 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    // Синхронизируем размеры канвасов
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        overlay.width = w;
        overlay.height = h;
    }

    const ctx = canvas.getContext('2d');
    const oCtx = overlay.getContext('2d');

    // Рисуем кадр из видео на canvas
    ctx.drawImage(video, 0, 0, w, h);

    // --- НАЧАЛО OPENCV ОБРАБОТКИ ---
    
    let srcMat = new cv.Mat(h, w, cv.CV_8UC4);
    let grayMat = new cv.Mat();
    let blurMat = new cv.Mat();
    let edgesMat = new cv.Mat();
    let contours = new cv.MatVector();
    
    try {
        // Копируем данные из canvas в матрицу OpenCV
        const imageData = ctx.getImageData(0, 0, w, h);
        srcMat.data.set(imageData.data);

        // Предобработка: Серый -> Размытие (убираем шум) -> Канни (края)
        cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(grayMat, blurMat, new cv.Size(5, 5), 0);
        
        // Пороги Canny: подстрой под освещение. 
        // 50/150 - стандарт для металла с умеренными бликами.
        cv.Canny(blurMat, edgesMat, 50, 150); 

        // Ищем контуры
        cv.findContours(edgesMat, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        oCtx.clearRect(0, 0, w, h);

        let bestMatrix = null;
        let bestDorn = null;

        // 2. Перебираем контуры и ищем эллипсы
        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            
            // Отсекаем мелкий шум
            if (cnt.total() < 40) continue;

            try {
                let ellipse = cv.fitEllipse(cnt);
                // ellipse.size.width - это диаметр эллипса в пикселях
                let diameterPx = ellipse.size.width; 
                
                // Логика выбора:
                // Матрица - самая крупная деталь (или в центре)
                // Дорн - поменьше, внутри матрицы
                
                if (!bestMatrix || diameterPx > bestMatrix.diameterPx) {
                    bestMatrix = { ...ellipse, diameterPx: diameterPx };
                }
            } catch (e) {
                continue;
            }
        }

        // Если матрицу нашли, ищем дорн ВНУТРИ неё
        if (bestMatrix) {
            // Рисуем Матрицу (Синий)
            drawEllipse(oCtx, bestMatrix, '#2563eb', 3);

            for (let i = 0; i < contours.size(); i++) {
                let cnt = contours.get(i);
                if (cnt.total() < 30) continue;
                
                try {
                    let ellipse = cv.fitEllipse(cnt);
                    let diameterPx = ellipse.size.width;
                    
                    // Проверка: дорн должен быть меньше матрицы и находиться внутри неё
                    // Расстояние между центрами + радиус дорна < радиус матрицы
                    let rMat = bestMatrix.diameterPx / 2;
                    let rDorn = diameterPx / 2;
                    
                    let dist = Math.sqrt(
                        Math.pow(ellipse.center.x - bestMatrix.center.x, 2) + 
                        Math.pow(ellipse.center.y - bestMatrix.center.y, 2)
                    );

                    if (diameterPx < bestMatrix.diameterPx * 0.7 && (dist + rDorn) < rMat) {
                        if (!bestDorn || diameterPx > bestDorn.diameterPx) {
                            bestDorn = { ...ellipse, diameterPx: diameterPx };
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            // --- РАСЧЕТ МЕТРИК ---
            
            const dornRealMm = parseFloat(document.getElementById('dornDiam').value);
            const matrRealMm = parseFloat(document.getElementById('matrDiam').value);

            const statusEl = document.getElementById('valStatus');
            
            if (!dornRealMm || !matrRealMm) {
                statusEl.textContent = "Ошибка: Введите размеры дорна и матрицы!";
                statusEl.style.color = "red";
                return;
            }

            if (!bestDorn) {
                statusEl.textContent = "Ошибка: Не найден дорн. Проверьте кадр.";
                statusEl.style.color = "orange";
                return;
            }

            // 1. Двойная калибровка (по двум деталям)
            const scaleMat = bestMatrix.diameterPx / matrRealMm;      // px/mm по матрице
            const scaleDorn = bestDorn.diameterPx / dornRealMm;      // px/mm по дорну
            
            // Расчет разницы в процентах
            const diffPercent = Math.abs(scaleMat - scaleDorn) / ((scaleMat + scaleDorn) / 2) * 100;

            // ПРОВЕРКА НА 3%
            if (diffPercent > 3) {
                statusEl.textContent = `Ошибка калибровки: Расхождение > 3% (${diffPercent.toFixed(1)}%). Проверьте блики или перекрытие деталей.`;
                statusEl.style.color = "red";
                // Можно раскомментировать, чтобы рисовать красным, если хочешь видеть проблемные кадры
                // drawEllipse(oCtx, bestDorn, 'red', 3); 
                return; 
            }

            // Усредненный масштаб
            const pixelsPerMm = (scaleMat + scaleDorn) / 2;

            // Защита от абсурдных масштабов (камера слишком далеко/близко)
            if (pixelsPerMm < 5 || pixelsPerMm > 200) {
                statusEl.textContent = "Деталь слишком далеко или близко. Наведите камеру.";
                statusEl.style.color = "orange";
                return;
            }

            // 2. Смещение оси (Shift) - в мм
            const shiftX = bestMatrix.center.x - bestDorn.center.x;
            const shiftY = bestMatrix.center.y - bestDorn.center.y;
            const shiftTotalPx = Math.sqrt(shiftX*shiftX + shiftY*shiftY);
            const shiftTotalMm = shiftTotalPx / pixelsPerMm;

            // 3. Отклонение от расчётного зазора (Non-uniformity) - в мм
            // Это реальная разница радиусов на фото, переведенная в мм.
            const radiusDiffPx = Math.abs((bestMatrix.diameterPx/2) - (bestDorn.diameterPx/2));
            const nonUniformMm = radiusDiffPx / pixelsPerMm;

            // 4. Номинальный зазор (справочный) - в мм
            const nominalGapMm = (matrRealMm - dornRealMm) / 2;

            // Вывод результатов (ВСЕ В ММ)
            document.getElementById('valShift').textContent = shiftTotalMm.toFixed(2) + ' мм';
            document.getElementById('valX').textContent = (shiftX / pixelsPerMm).toFixed(2) + ' мм';
            document.getElementById('valY').textContent = (shiftY / pixelsPerMm).toFixed(2) + ' мм';

            document.getElementById('valNonUniform').textContent = nonUniformMm.toFixed(3) + ' мм';
            document.getElementById('valNominalGap').textContent = nominalGapMm.toFixed(3) + ' мм';

            statusEl.textContent = `OK (Масштаб: ${pixelsPerMm.toFixed(1)} px/mm)`;
            statusEl.style.color = "green";

            // Рисуем Дорн (Зеленый)
            drawEllipse(oCtx, bestDorn, '#16a34a', 3);

        } else {
            statusEl.textContent = "Не найдена матрица. Наведите камеру на деталь.";
            statusEl.style.color = "orange";
        }

    } catch (err) {
        console.error('❌ Ошибка обработки:', err);
        document.getElementById('valStatus').textContent = 'Ошибка системы';
        document.getElementById('valStatus').style.color = 'red';
    } finally {
        srcMat.delete();
        grayMat.delete();
        blurMat.delete();
        edgesMat.delete();
        contours.delete();
    }

    frameCount++;
    // Защита от бесконечного цикла при зависании, можно убрать если не нужно
    if (frameCount > 1000) frameCount = 0; 

    requestAnimationFrame(processFrame);
}

// Вспомогательная функция для отрисовки эллипса
function drawEllipse(ctx, ellipse, color, width) {
    ctx.beginPath();
    ctx.save();
    ctx.translate(ellipse.center.x, ellipse.center.y);
    ctx.rotate(ellipse.angle * Math.PI / 180);
    
    // Рисуем эллипс
    ctx.ellipse(0, 0, ellipse.size.width / 2, ellipse.size.height / 2, 0, 0, Math.PI * 2);
    
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    
    // Рисуем центр (квадратик)
    ctx.fillStyle = color;
    ctx.fillRect(ellipse.center.x - 4, ellipse.center.y - 4, 8, 8);
}
