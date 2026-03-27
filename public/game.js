const { Engine, Render, Runner, Bodies, Composite, Vector, Body, Events } = Matter;

const socket = io(); // 保留連線能力

const WIDTH = 600;
const HEIGHT = 600;

// 初始化音效
const potSound = new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_13334d7003.mp3');

// 1. 初始化物理引擎
const engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 10
});
engine.world.gravity.y = 0;

// 2. 初始化渲染器
const render = Render.create({
    element: document.body,
    engine: engine,
    options: {
        width: WIDTH,
        height: HEIGHT,
        wireframes: false,
        background: '#e0c097',
        showAngleIndicator: false,
        hasBounds: true
    }
});

// 移除內建的 Runner，因為我們等一下要在最底部手寫「完美加速迴圈」

// 3. 建立棋盤邊界 (牆壁) 與 球洞 (Pockets)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6, friction: 0 };

const walls = [
    Bodies.rectangle(WIDTH/2, -30, WIDTH + 200, 100, wallOptions),
    Bodies.rectangle(WIDTH/2, HEIGHT + 30, WIDTH + 200, 100, wallOptions),
    Bodies.rectangle(-30, HEIGHT/2, 100, HEIGHT + 200, wallOptions),
    Bodies.rectangle(WIDTH + 30, HEIGHT/2, 100, HEIGHT + 200, wallOptions)
];

const pocketRadius = 30;
const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket', render: { fillStyle: '#1a1a1a' } };
const pockets = [
    Bodies.circle(30, 30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, 30, pocketRadius, pocketOptions),
    Bodies.circle(30, HEIGHT-30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, HEIGHT-30, pocketRadius, pocketOptions)
];

// 4. 建立棋子
const colorQueen = '#d35400';
const colorWhite = '#ecf0f1';
const colorBlack = '#2c3e50';
const colorStriker = '#c0392b';

const striker = Bodies.circle(WIDTH/2, HEIGHT * 0.8, 20, { 
    label: 'striker',
    restitution: 0.6, 
    frictionAir: 0.008, 
    friction: 0.01,     
    mass: 15, 
    isBullet: true, 
    render: { 
        visible: false, 
        fillStyle: colorStriker, 
        strokeStyle: '#f39c12', 
        lineWidth: 3
    } 
});

const pucks = [];
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const puckRadius = 12;
const gap = 24.5; 
let puckId = 100;

const puckOptions = {
    label: 'puck',
    restitution: 0.8, 
    frictionAir: 0.004, 
    friction: 0.01,     
    mass: 5,
    isBullet: true 
};

// 中心皇后
pucks.push(Bodies.circle(cx, cy, puckRadius, { 
    ...puckOptions, 
    id: puckId++, 
    render: { visible: false, fillStyle: colorQueen, strokeStyle: '#e67e22', lineWidth: 1 }
}));

// 內圈
for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x = cx + Math.cos(angle) * gap;
    const y = cy + Math.sin(angle) * gap;
    const color = (i % 2 === 0) ? colorWhite : colorBlack;
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { visible: false, fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 }
    }));
}

// 外圈
for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    let dist, color;
    
    if (i % 2 === 0) {
        dist = gap * 2;
        color = colorWhite;
    } else {
        dist = gap * Math.sqrt(3);
        color = colorBlack;
    }
    
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { visible: false, fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 }
    }));
}

Composite.add(engine.world, [...walls, ...pockets, striker, ...pucks]);

let blackCount = 9;
let whiteCount = 9;
let potEffects = []; 
let currentPlayer = 1;

let pottedOwnPieceThisTurn = false;
let pottedStrikerThisTurn = false;
let pottedQueenThisTurn = false;
let hitAnyPuckThisTurn = false; 
let piecesPottedThisTurn = []; 

// 狀態追蹤與掛機系統
let lastAIState = null;
let lastAIAction = null;
let lastAIExpertAction = null;
let isSelfPlayTraining = false; 
let totalTurnsThisGame = 0; 
let consecutiveMisses = 0; 
let currentTrainingSpeed = 10; 
let isBackgroundTraining = false;
let bgTrainingTarget = 0;
let bgTrainingCurrent = 0;

// 全局碰撞監聽器
Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;
        if ((bodyA.label === 'striker' && bodyB.label === 'puck') || 
            (bodyB.label === 'striker' && bodyA.label === 'puck')) {
            hitAnyPuckThisTurn = true; 
        }
    });
});

// 5. 處理嚴格進洞邏輯
Events.on(engine, 'afterUpdate', () => {
    pucks.forEach(piece => {
        if (piece.position.x === -100) return;

        pockets.forEach(pocket => {
            const dist = Vector.magnitude(Vector.sub(piece.position, pocket.position));
            
            if (dist < 25) {
                piecesPottedThisTurn.push(piece);

                potEffects.push({
                    x: pocket.position.x,
                    y: pocket.position.y,
                    r: 10,        
                    color: '#f1c40f', 
                    life: 30,     
                    type: 'piece', 
                    piecePos: { x: piece.position.x, y: piece.position.y },
                    pieceRad: piece.circleRadius,
                    pieceColor: piece.render.fillStyle
                });

                if (piece.render.fillStyle === colorBlack) {
                    blackCount--;
                    if(!isBackgroundTraining) document.getElementById('black-count').innerText = `x ${blackCount}`;
                    if (currentPlayer === 1) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorWhite) {
                    whiteCount--;
                    if(!isBackgroundTraining) document.getElementById('white-count').innerText = `x ${whiteCount}`;
                    if (currentPlayer === 2) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorQueen) {
                    pottedQueenThisTurn = true; 
                }

                if(!isSelfPlayTraining && !isBackgroundTraining) potSound.play(); 
                Body.setPosition(piece, { x: -100, y: -100 });
                Body.setVelocity(piece, { x: 0, y: 0 });
            }
        });
    });

    pockets.forEach(pocket => {
        const distS = Vector.magnitude(Vector.sub(striker.position, pocket.position));
        
        if (distS < 25 && !isPlacing) { 
             potEffects.push({
                x: pocket.position.x,
                y: pocket.position.y,
                r: 10,        
                color: '#c0392b', 
                life: 30,     
                type: 'striker', 
                piecePos: { x: striker.position.x, y: striker.position.y },
                pieceRad: striker.circleRadius,
                pieceColor: striker.render.fillStyle
            });

            if(!isSelfPlayTraining && !isBackgroundTraining) potSound.play();
            pottedStrikerThisTurn = true; 

            const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
            Body.setPosition(striker, { x: WIDTH/2, y: resetY });
            Body.setVelocity(striker, { x: 0, y: 0 });
        }
    });
});

// 6. 互動邏輯
let isDragging = false;
let startPoint = null;
let mousePos = { x: 0, y: 0 };
let isMoving = false; 
let turnActive = false; 
let isPlacing = false; 

window.addEventListener('pointermove', (e) => {
    if (isSelfPlayTraining || isBackgroundTraining || currentPlayer === 2) return; 
    const rect = render.canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;

    if (isPlacing) {
        let newX = mousePos.x;
        const minX = 100 + striker.circleRadius;
        const maxX = WIDTH - 100 - striker.circleRadius;
        
        if (newX < minX) newX = minX;
        if (newX > maxX) newX = maxX;

        const lockY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: newX, y: lockY });
        Body.setVelocity(striker, { x: 0, y: 0 });
    }
});

window.addEventListener('pointerdown', (e) => {
    if (isSelfPlayTraining || isBackgroundTraining || currentPlayer === 2) return; 
    if (isMoving) return; 

    const rect = render.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const dist = Vector.magnitude(Vector.sub({ x: clickX, y: clickY }, striker.position));
    if (dist < 30) {
        isDragging = true;
        startPoint = { x: striker.position.x, y: striker.position.y };
    } else {
        isPlacing = true;
        striker.isSensor = true;
    }
});

window.addEventListener('pointerup', (e) => {
    if (isSelfPlayTraining || isBackgroundTraining || currentPlayer === 2) return; 
    if (isPlacing) {
        isPlacing = false;
        striker.isSensor = false; 
        return;
    }

    if (!isDragging) return;
    isDragging = false;

    const rect = render.canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const forceMultiplier = 0.005; 
    let forceX = (startPoint.x - endX) * forceMultiplier;
    let forceY = (startPoint.y - endY) * forceMultiplier;

    const maxForce = 0.8;
    const currentForce = Math.sqrt(forceX * forceX + forceY * forceY);
    if (currentForce > maxForce) {
        forceX = (forceX / currentForce) * maxForce;
        forceY = (forceY / currentForce) * maxForce;
    }

    const forceVector = { x: forceX, y: forceY };
    
    hitAnyPuckThisTurn = false;
    Body.applyForce(striker, striker.position, forceVector);

    setTimeout(() => {
        turnActive = true;
    }, 50);
});

// 瞬間重置盤面
function resetGame() {
    blackCount = 9;
    whiteCount = 9;
    currentPlayer = 1;
    totalTurnsThisGame = 0;
    consecutiveMisses = 0; 
    turnActive = false;
    isMoving = false;
    hitAnyPuckThisTurn = false;
    pottedOwnPieceThisTurn = false;
    pottedStrikerThisTurn = false;
    pottedQueenThisTurn = false;
    piecesPottedThisTurn = [];
    potEffects = [];

    if (!isBackgroundTraining) {
        document.getElementById('black-count').innerText = `x ${blackCount}`;
        document.getElementById('white-count').innerText = `x ${whiteCount}`;
    }

    const queen = pucks.find(p => p.id === 100);
    Body.setPosition(queen, { x: cx, y: cy });
    Body.setVelocity(queen, { x: 0, y: 0 });

    for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const p = pucks.find(p => p.id === 101 + i);
        Body.setPosition(p, { x: cx + Math.cos(angle) * gap, y: cy + Math.sin(angle) * gap });
        Body.setVelocity(p, { x: 0, y: 0 });
    }

    for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        let dist = (i % 2 === 0) ? gap * 2 : gap * Math.sqrt(3);
        const p = pucks.find(p => p.id === 107 + i);
        Body.setPosition(p, { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist });
        Body.setVelocity(p, { x: 0, y: 0 });
    }

    Body.setPosition(striker, { x: WIDTH / 2, y: HEIGHT * 0.8 });
    Body.setVelocity(striker, { x: 0, y: 0 });
}

// 結算回合
async function checkTurnEndAsync() {
    let anyMoving = false;
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;

    if (!isMoving && turnActive) {
        turnActive = false; 
        totalTurnsThisGame++; 
        
        let isFoulQueen = false;
        let isGameWon = false;
        
        const ownRemaining = currentPlayer === 1 ? blackCount : whiteCount;
        
        if (pottedQueenThisTurn) {
            if (ownRemaining > 0) {
                isFoulQueen = true; 
            } else {
                isGameWon = true;   
            }
        }

        let isFoulMiss = !hitAnyPuckThisTurn;
        let isFoul = isFoulQueen || pottedStrikerThisTurn || isFoulMiss;

        if (isFoulMiss) {
            consecutiveMisses++;
        } else {
            consecutiveMisses = 0;
        }

        if ((currentPlayer === 2 || isSelfPlayTraining || isBackgroundTraining) && lastAIState && lastAIAction) {
            let reward = -0.1; 
            if (pottedOwnPieceThisTurn) reward += 10.0; 
            if (pottedStrikerThisTurn) reward -= 10.0; 
            
            if (pottedQueenThisTurn) {
                if (ownRemaining > 0) {
                    reward -= 20.0; 
                } else {
                    reward += 100.0; 
                }
            }
            
            if (isFoulMiss) {
                reward -= 5.0;  
                if (consecutiveMisses >= 4) {
                    reward -= 50.0; 
                    consecutiveMisses = 0; 
                }
            }
            
            await carromBrain.rememberAndTrain(lastAIState, lastAIAction, reward, lastAIExpertAction);
        }

        if (isFoul) {
            piecesPottedThisTurn.forEach(p => {
                let rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                let ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
                
                if (p.render.fillStyle === colorQueen) {
                    rx = WIDTH / 2;
                    ry = HEIGHT / 2;
                }

                Body.setPosition(p, { x: rx, y: ry });
                Body.setVelocity(p, { x: 0, y: 0 });

                if (p.render.fillStyle === colorBlack) {
                    blackCount++;
                    if(!isBackgroundTraining) document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else if (p.render.fillStyle === colorWhite) {
                    whiteCount++;
                    if(!isBackgroundTraining) document.getElementById('white-count').innerText = `x ${whiteCount}`;
                }
            });

            const myColor = currentPlayer === 1 ? colorBlack : colorWhite;
            const penaltyPiece = pucks.find(p => p.render.fillStyle === myColor && p.position.x === -100 && !piecesPottedThisTurn.includes(p));
            
            if (penaltyPiece) {
                const rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                const ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
                Body.setPosition(penaltyPiece, { x: rx, y: ry });
                Body.setVelocity(penaltyPiece, { x: 0, y: 0 });
                
                if (myColor === colorBlack) {
                    blackCount++;
                    if(!isBackgroundTraining) document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else {
                    whiteCount++;
                    if(!isBackgroundTraining) document.getElementById('white-count').innerText = `x ${whiteCount}`;
                }
            }
            pottedOwnPieceThisTurn = false; 
        }

        const keepTurn = (pottedOwnPieceThisTurn || isGameWon) && !isFoul;

        if (!keepTurn) {
            currentPlayer = currentPlayer === 1 ? 2 : 1;
        }

        pottedOwnPieceThisTurn = false;
        pottedStrikerThisTurn = false;
        pottedQueenThisTurn = false;
        hitAnyPuckThisTurn = false; 
        piecesPottedThisTurn = []; 
        
        if (!isBackgroundTraining) {
            const turnIndicator = document.getElementById('turn-indicator');
            if (isSelfPlayTraining) {
                turnIndicator.innerText = `🤖 訓練模式：AI 運算中... (第 ${totalTurnsThisGame} 桿)`;
                turnIndicator.style.color = "#f39c12";
            } else if (currentPlayer === 1) {
                turnIndicator.innerText = "現在輪到：玩家 1 (下方，黑棋)";
                turnIndicator.style.color = "#2ecc71"; 
            } else {
                turnIndicator.innerText = "現在輪到：AI 神經網路 (思考中...)";
                turnIndicator.style.color = "#e74c3c"; 
            }
        }

        const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: WIDTH/2, y: resetY });
        Body.setVelocity(striker, { x: 0, y: 0 });

        if (isGameWon || totalTurnsThisGame > 150) {
            if (isBackgroundTraining) {
                bgTrainingCurrent++;
                document.getElementById('bg-progress-text').innerText = `已完成: ${bgTrainingCurrent} / ${bgTrainingTarget} 局`;
            }
            
            //🔥 將這局的最終出桿數紀錄到折線圖中
            if (typeof addChartData === 'function') {
                addChartData(totalTurnsThisGame);
            }
            
            await carromBrain.save();
            resetGame(); 
            
            if (!isBackgroundTraining && (isSelfPlayTraining || currentPlayer === 2)) {
                const delay = isSelfPlayTraining ? Math.max(1, 50 / currentTrainingSpeed) : 500;
                setTimeout(requestLocalAIPrediction, delay);
            }
            return;
        }

        if (!isBackgroundTraining && (currentPlayer === 2 || isSelfPlayTraining)) {
            const delay = isSelfPlayTraining ? Math.max(1, 50 / currentTrainingSpeed) : 500;
            setTimeout(requestLocalAIPrediction, delay);
        }
    }
}

// 8. 自定義繪製
Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    
    ctx.save();
    ctx.translate(WIDTH/2, HEIGHT/2);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(20, -50, 40, -50, 0, -80);
        ctx.bezierCurveTo(-40, -50, -20, -50, 0, 0);
    }
    ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)'; 
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#d35400';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(100, HEIGHT * 0.8);
    ctx.lineTo(WIDTH - 100, HEIGHT * 0.8);
    ctx.moveTo(100, HEIGHT * 0.2);
    ctx.lineTo(WIDTH - 100, HEIGHT * 0.2);
    ctx.strokeStyle = 'rgba(62, 39, 35, 0.6)'; 
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#3e2723'; 
    ctx.beginPath(); ctx.arc(100, HEIGHT * 0.8, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(WIDTH - 100, HEIGHT * 0.8, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(100, HEIGHT * 0.2, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(WIDTH - 100, HEIGHT * 0.2, 4, 0, 2 * Math.PI); ctx.fill();

    const allGamePieces = [...pucks, striker];
    allGamePieces.sort((pieceA, pieceB) => pieceA.position.y - pieceB.position.y);

    allGamePieces.forEach(p => {
        if (p.position.x === -100) return;

        const pos = p.position;
        const radius = p.circleRadius;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = p.render.fillStyle;
        ctx.fill();
        if (p.render.strokeStyle) {
            ctx.strokeStyle = p.render.strokeStyle;
            ctx.lineWidth = p.render.lineWidth || 1;
            ctx.stroke();
        }

        if (p.label === 'striker') {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius - 5, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(241, 196, 15, 0.4)'; 
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(pos.x - radius/3, pos.y - radius/3, radius/3, 1 * Math.PI, 1.5 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; 
            ctx.lineWidth = 3;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius - 3, 0, 2 * Math.PI); 
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'; 
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(pos.x - radius/3, pos.y - radius/3, radius/3, 1 * Math.PI, 1.5 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; 
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    if (isDragging && startPoint) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = 'rgba(62, 39, 35, 0.7)'; 
        ctx.lineWidth = 5; 
        ctx.setLineDash([8, 8]); 
        ctx.stroke();
        ctx.setLineDash([]);
    }

    for (let i = potEffects.length - 1; i >= 0; i--) {
        const effect = potEffects[i];
        
        ctx.save();
        const alpha = effect.life / 30; 
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.r, 0, 2 * Math.PI);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 4;
        ctx.stroke();

        if (alpha > 0) {
            ctx.globalAlpha = alpha * 0.8;
            const scaledRad = effect.pieceRad * alpha; 
            ctx.beginPath();
            ctx.arc(effect.piecePos.x, effect.piecePos.y, scaledRad, 0, 2 * Math.PI);
            ctx.fillStyle = effect.pieceColor;
            ctx.fill();
        }
        ctx.restore();

        effect.r += 2; 
        effect.life--; 

        if (effect.life <= 0) {
            potEffects.splice(i, 1);
        }
    }
});

// UI 按鈕與控制邏輯
document.getElementById('speed-slider').addEventListener('input', (e) => {
    currentTrainingSpeed = parseInt(e.target.value);
    document.getElementById('speed-label').innerText = `畫面速度: ${currentTrainingSpeed}x`;
});

document.getElementById('btn-self-play').addEventListener('click', () => {
    isSelfPlayTraining = !isSelfPlayTraining;
    const btn = document.getElementById('btn-self-play');
    if(isSelfPlayTraining) {
        btn.innerText = "🛑 停止畫面互搏";
        btn.style.backgroundColor = "#c0392b";
        requestLocalAIPrediction(); 
    } else {
        btn.innerText = "🤖 啟動畫面互搏";
        btn.style.backgroundColor = "#e67e22";
    }
});

document.getElementById('btn-download').addEventListener('click', async () => {
    if (!carromBrain.isInitialized) return;
    try {
        await carromBrain.model.save('downloads://carrom-ai-model');
        alert("下載成功！\n\n請將下載的兩個檔案放到專案的 public 目錄中。");
    } catch (e) {
        alert("下載失敗：" + e.message);
    }
});

document.getElementById('btn-reset-ai').addEventListener('click', async () => {
    const confirmReset = confirm("確定要刪除 AI 的所有記憶，讓它從頭開始學習嗎？");
    if (confirmReset) {
        localStorage.removeItem('carrom-ai-exploration');
        localStorage.removeItem('carrom-ai-memory'); 
        try { await tf.io.removeModel('localstorage://carrom-ai-model'); } catch(e) {}
        if (isSelfPlayTraining) document.getElementById('btn-self-play').click();
        alert("記憶已清除！網頁將重新載入。");
        window.location.href = window.location.pathname;
    }
});

document.getElementById('btn-bg-train').addEventListener('click', async () => {
    if (isBackgroundTraining) return;
    isBackgroundTraining = true;
    bgTrainingTarget = 500;
    bgTrainingCurrent = 0;
    
    if (isSelfPlayTraining) document.getElementById('btn-self-play').click();

    document.getElementById('bg-training-screen').style.display = 'flex';
    document.querySelector('canvas').style.display = 'none';

    resetGame();

    let ticks = 0;
    while (bgTrainingCurrent < bgTrainingTarget) {
        if (!isMoving && !turnActive) {
            executeAIActionSync();
        }

        Engine.update(engine, 16.666);
        await checkTurnEndAsync();

        ticks++;
        if (ticks % 100 === 0) {
            await new Promise(r => setTimeout(r, 0)); 
        }
    }

    await carromBrain.save();
    isBackgroundTraining = false;
    
    //🔥 閉關結束出關時，一次性更新折線圖，讓玩家看到壯觀的下降曲線
    if (turnChart) turnChart.update();

    document.getElementById('bg-training-screen').style.display = 'none';
    document.querySelector('canvas').style.display = 'block';
    
    resetGame();
    alert("⚡ 精神時光屋修煉完成！500 局極速訓練已結束，AI 大腦已存檔！");
});


// TensorFlow.js 神經網路大腦
class CarromBrain {
    constructor() {
        this.explorationRate = 1.0; 
        this.explorationDecay = 0.995; 
        this.minExploration = 0.05; 
        this.isInitialized = false; 
        this.memory = [];
        this.maxMemory = 2000;
        this.batchSize = 32;
    }

    async init() {
        try {
            this.model = await tf.loadLayersModel('./carrom-ai-model.json');
            console.log('成功載入伺服器上的【全球發布版 AI】！');
            this.explorationRate = 0.05; 
            document.getElementById('ml-status').innerText = `已載入伺服器上的最強大腦！`;
        } catch (e1) {
            try {
                this.model = await tf.loadLayersModel('localstorage://carrom-ai-model');
                console.log('成功載入本地先前的 AI 記憶！');
                
                const savedRate = localStorage.getItem('carrom-ai-exploration');
                if (savedRate !== null) {
                    this.explorationRate = parseFloat(savedRate);
                }

                const savedMemory = localStorage.getItem('carrom-ai-memory');
                if (savedMemory !== null) {
                    this.memory = JSON.parse(savedMemory);
                    console.log(`成功載入海馬迴：恢復 ${this.memory.length} 筆歷史動作記憶！`);
                }

                document.getElementById('ml-status').innerText = `本地記憶載入成功！目前探索率: ${Math.round(this.explorationRate * 100)}% (記憶庫: ${this.memory.length})`;
            } catch (e2) {
                console.log('找不到舊記憶，建立全新 AI 大腦...');
                this.model = tf.sequential();
                
                this.model.add(tf.layers.dense({ units: 64, inputShape: [39], activation: 'relu' }));
                this.model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
                this.model.add(tf.layers.dense({ units: 3, activation: 'tanh' })); 
            }
        }
        
        this.model.compile({
            optimizer: tf.train.adam(0.01),
            loss: 'meanSquaredError'
        });

        this.isInitialized = true;
    }

    async save() {
        if (!this.isInitialized) return;
        await this.model.save('localstorage://carrom-ai-model');
        localStorage.setItem('carrom-ai-exploration', this.explorationRate.toString());
        
        try {
            const memoryToSave = this.memory.slice(-1000); 
            localStorage.setItem('carrom-ai-memory', JSON.stringify(memoryToSave));
        } catch(e) {
            console.warn('記憶庫存檔失敗', e);
        }
    }

    getStateArray() {
        const state = [];
        const queen = pucks.find(p => p.render.fillStyle === colorQueen);
        if (queen && queen.position.x !== -100) {
            state.push(queen.position.x / WIDTH, queen.position.y / HEIGHT);
        } else {
            state.push(-1, -1);
        }

        const myColor = currentPlayer === 1 ? colorBlack : colorWhite;
        const oppColor = currentPlayer === 1 ? colorWhite : colorBlack;
        let myPucks = pucks.filter(p => p.render.fillStyle === myColor && p.position.x !== -100);
        let oppPucks = pucks.filter(p => p.render.fillStyle === oppColor && p.position.x !== -100);

        const targetY = currentPlayer === 1 ? 30 : HEIGHT - 30;
        myPucks.sort((a, b) => Math.abs(a.position.y - targetY) - Math.abs(b.position.y - targetY));
        oppPucks.sort((a, b) => Math.abs(a.position.y - targetY) - Math.abs(b.position.y - targetY));

        for (let i = 0; i < 9; i++) {
            if (i < myPucks.length) {
                state.push(myPucks[i].position.x / WIDTH, myPucks[i].position.y / HEIGHT);
            } else { state.push(-1, -1); }
        }

        for (let i = 0; i < 9; i++) {
            if (i < oppPucks.length) {
                state.push(oppPucks[i].position.x / WIDTH, oppPucks[i].position.y / HEIGHT);
            } else { state.push(-1, -1); }
        }

        state.push(currentPlayer === 1 ? 1 : -1);
        return state;
    }

    getExpertAction() {
        const myColor = currentPlayer === 1 ? colorBlack : colorWhite;
        let myPucks = pucks.filter(p => p.render.fillStyle === myColor && p.position.x !== -100);
        
        if (myPucks.length === 0) {
            const queen = pucks.find(p => p.render.fillStyle === colorQueen && p.position.x !== -100);
            if (queen) {
                myPucks = [queen];
            } else {
                return [0, 0, 0]; 
            }
        }

        if (myPucks.length === 0) return [0, 0, 0];

        const pocketY = currentPlayer === 1 ? 30 : HEIGHT - 30;
        const leftPocket = {x: 30, y: pocketY};
        const rightPocket = {x: WIDTH - 30, y: pocketY};

        let bestPuck = myPucks[0];
        let minDist = 99999;
        let targetPocket = leftPocket;

        myPucks.forEach(p => {
            const dLeft = Vector.magnitude(Vector.sub(p.position, leftPocket));
            const dRight = Vector.magnitude(Vector.sub(p.position, rightPocket));
            if (dLeft < minDist) { minDist = dLeft; bestPuck = p; targetPocket = leftPocket; }
            if (dRight < minDist) { minDist = dRight; bestPuck = p; targetPocket = rightPocket; }
        });

        const dx = targetPocket.x - bestPuck.position.x;
        const offset = dx > 0 ? -12 : 12; 
        let idealStrikerX = bestPuck.position.x + offset;
        idealStrikerX = Math.max(120, Math.min(480, idealStrikerX));

        const forceX = dx > 0 ? 0.3 : -0.3;
        const forceY = 0.6; 

        const nnX = ((idealStrikerX - 120) / (480 - 120)) * 2 - 1;
        const nnForceX = forceX / 0.8;
        const nnForceY = ((forceY - 0.01) / 0.79) * 2 - 1;

        return [
            nnX + (Math.random() * 0.2 - 0.1),
            nnForceX + (Math.random() * 0.2 - 0.1),
            nnForceY + (Math.random() * 0.2 - 0.1)
        ].map(v => Math.max(-1, Math.min(1, v)));
    }

    predict(stateArray) {
        if (!this.isInitialized) return [0, 0, 0]; 

        if (Math.random() < this.explorationRate) {
            if (Math.random() < 0.7) {
                return this.getExpertAction();
            } else {
                return [
                    (Math.random() * 2) - 1, 
                    (Math.random() * 2) - 1, 
                    (Math.random() * 2) - 1  
                ];
            }
        }

        return tf.tidy(() => {
            const inputTensor = tf.tensor2d([stateArray]);
            const prediction = this.model.predict(inputTensor);
            const data = prediction.dataSync();
            
            return [
                data[0] + (Math.random() * 0.04 - 0.02),
                data[1] + (Math.random() * 0.04 - 0.02),
                data[2] + (Math.random() * 0.04 - 0.02)
            ].map(v => Math.max(-1, Math.min(1, v)));
        });
    }

    async rememberAndTrain(stateArray, actionTaken, reward, expertAction) {
        if (!this.isInitialized) return;

        //🔥 新增：判斷這桿原本是否有得分 (獲得正向獎勵)
        const isScoringShot = reward > 0;

        let finalAction = actionTaken;
        
        if (reward < 0 && expertAction) {
            finalAction = expertAction;
            reward = 1.0; 
        } else if (reward > 0) {
            reward = 1.0;
        }

        //🔥 修改：海馬迴「只記錄得分的球」，過濾掉所有沒進球的軌跡
        if (isScoringShot) {
            this.memory.push({ state: stateArray, action: finalAction, reward: reward });
            if (this.memory.length > this.maxMemory) {
                this.memory.shift(); 
            }
        }

        //🔥 如果記憶庫是空的（還沒進過半顆球），先跳過訓練避免報錯
        if (this.memory.length === 0) return;

        const batchSize = Math.min(this.memory.length, this.batchSize);
        const batch = [];
        for (let i = 0; i < batchSize; i++) {
            const randomIndex = Math.floor(Math.random() * this.memory.length);
            batch.push(this.memory[randomIndex]);
        }
        
        //🔥 如果這局有進球，才把它放在 batch[0] 強制複習最新成功的經驗
        if (isScoringShot) {
            batch[0] = this.memory[this.memory.length - 1];
        }

        const states = batch.map(b => b.state);
        const targetActions = batch.map(b => b.action);

        const xs = tf.tensor2d(states);
        const ys = tf.tensor2d(targetActions);

        await this.model.fit(xs, ys, { epochs: 1, verbose: 0 });

        xs.dispose();
        ys.dispose();

        if (this.explorationRate > this.minExploration) {
            this.explorationRate *= this.explorationDecay;
        }

        if(!isBackgroundTraining) {
            document.getElementById('ml-status').innerText = `AI 探索率: ${Math.round(this.explorationRate * 100)}% (記憶庫: ${this.memory.length})`;
        }
    }
}

const carromBrain = new CarromBrain();
carromBrain.init(); 

function executeAIActionSync() {
    lastAIState = carromBrain.getStateArray();
    lastAIExpertAction = carromBrain.getExpertAction(); 
    
    const rawAction = carromBrain.predict(lastAIState);
    lastAIAction = rawAction;

    const aiX = 120 + ((rawAction[0] + 1) / 2) * (480 - 120); 
    const aiForceX = rawAction[1] * 0.8;
    
    let aiForceY = 0;
    let aiStrikerY = 0;
    if (currentPlayer === 1) {
        aiForceY = -0.01 - ((rawAction[2] + 1) / 2) * 0.79; 
        aiStrikerY = HEIGHT * 0.8;
    } else {
        aiForceY = 0.01 + ((rawAction[2] + 1) / 2) * 0.79; 
        aiStrikerY = HEIGHT * 0.2;
    }

    Body.setPosition(striker, { x: aiX, y: aiStrikerY });
    Body.setVelocity(striker, { x: 0, y: 0 });

    hitAnyPuckThisTurn = false;
    
    const forceVector = { x: aiForceX, y: aiForceY };
    Body.applyForce(striker, striker.position, forceVector);
    
    turnActive = true;
}

function requestLocalAIPrediction() {
    const delay = isSelfPlayTraining ? Math.max(1, 50 / currentTrainingSpeed) : 500;
    setTimeout(() => {
        executeAIActionSync();
    }, delay);
}

async function customGameLoop() {
    if (!isBackgroundTraining) {
        const steps = isSelfPlayTraining ? currentTrainingSpeed : 1;
        for (let i = 0; i < steps; i++) {
            Engine.update(engine, 16.666); 
            await checkTurnEndAsync();
        }
        Render.world(render); 
    }
    window.requestAnimationFrame(customGameLoop);
}
customGameLoop();

//🔥 === 折線圖資料與初始化 ===
let globalGameCount = 0;
let turnHistory = [];
let gameLabels = [];
let turnChart = null;

function initChart() {
    const ctx = document.getElementById('turnChart').getContext('2d');
    
    // 設定 Chart.js 預設字體顏色為淺色以搭配深色背景
    Chart.defaults.color = '#bdc3c7';
    
    turnChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: gameLabels,
            datasets: [{
                label: '單局出桿數 (越低越聰明)',
                data: turnHistory,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    display: true, 
                    title: { display: true, text: '遊戲局數' } 
                },
                y: { 
                    display: true, 
                    title: { display: true, text: '總出桿數' }, 
                    beginAtZero: true,
                    max: 160 // 設定上限 160，因為 150 是強制死局重置的極限
                }
            },
            plugins: {
                legend: { labels: { color: '#ecf0f1' } }
            }
        }
    });
}

function addChartData(turns) {
    globalGameCount++;
    
    // 最多只保留最新 50 局的紀錄，讓圖表不會因為點太多而變成糊糊的一條線
    if (gameLabels.length >= 50) {
        gameLabels.shift();
        turnHistory.shift();
    }
    
    gameLabels.push(globalGameCount);
    turnHistory.push(turns);
    
    // 為了效能，背景極速訓練時不更新畫面，等出關時再一口氣畫出來
    if (turnChart && !isBackgroundTraining) {
        turnChart.update();
    }
}

// 啟動時立刻初始化圖表
initChart();
