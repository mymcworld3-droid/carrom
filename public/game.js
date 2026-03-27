const { Engine, Render, Runner, Bodies, Composite, Vector, Body, Events } = Matter;

const socket = io(); // 保留連線能力

const WIDTH = 600;
const HEIGHT = 600;

// 初始化音效
const potSound = new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_13334d7003.mp3');

// 1. 初始化物理引擎
const engine = Engine.create({
    positionIterations: 10, // 提高精確度，防止高速穿透
    velocityIterations: 10
});
engine.world.gravity.y = 0; // 俯視圖，無重力

// 2. 初始化渲染器
const render = Render.create({
    element: document.body,
    engine: engine,
    options: {
        width: WIDTH,
        height: HEIGHT,
        wireframes: false, // 顯示實心物體
        background: '#e0c097', // 木質棋盤色
        showAngleIndicator: false,
        // 啟用自定義渲染，這樣我們才能自己動手畫更好看的元素
        hasBounds: true
    }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// 3. 建立棋盤邊界 (牆壁) 與 球洞 (Pockets)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6, friction: 0 }; // 將摩擦力 friction 設為 0

// 加厚牆壁厚度到 100px 並向外偏移。畫面上看起來一樣是 20px 的邊框，但物理上是一堵厚牆，徹底防止高速穿透
const walls = [
    Bodies.rectangle(WIDTH/2, -30, WIDTH + 200, 100, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT + 30, WIDTH + 200, 100, wallOptions), // 下
    Bodies.rectangle(-30, HEIGHT/2, 100, HEIGHT + 200, wallOptions), // 左
    Bodies.rectangle(WIDTH + 30, HEIGHT/2, 100, HEIGHT + 200, wallOptions) // 右
];

// 建立四個角落的球洞
const pocketRadius = 30;
// 給球洞加一點內部陰影效果， label 用來辨識球洞
// 這裡將球洞標記為 Sensor，不進行實體碰撞，我們將轉為手動判定嚴格進洞
const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket', render: { fillStyle: '#1a1a1a' } };
const pockets = [
    Bodies.circle(30, 30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, 30, pocketRadius, pocketOptions),
    Bodies.circle(30, HEIGHT-30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, HEIGHT-30, pocketRadius, pocketOptions)
];

// 4. 建立棋子

// 定義棋子外觀顏色
const colorQueen = '#d35400'; // 皇后
const colorWhite = '#ecf0f1'; // 白棋
const colorBlack = '#2c3e50'; // 黑棋
const colorStriker = '#c0392b'; // 打擊子

const striker = Bodies.circle(WIDTH/2, HEIGHT * 0.8, 20, { 
    label: 'striker',
    restitution: 0.6, 
    frictionAir: 0.008, 
    friction: 0.01,     
    mass: 15, 
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
    mass: 5 
};

// 中心皇后 (id: 100)
pucks.push(Bodies.circle(cx, cy, puckRadius, { 
    ...puckOptions, 
    id: puckId++, 
    render: { visible: false, fillStyle: colorQueen, strokeStyle: '#e67e22', lineWidth: 1 }
}));

// 內圈 (id: 101~106)
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

// 外圈 (id: 107~118)
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

// 用於機器學習的狀態追蹤與掛機系統
let lastAIState = null;
let lastAIAction = null;
let isSelfPlayTraining = false; 
let totalTurnsThisGame = 0; 
let currentTrainingSpeed = 10; 

//🔥 新增：背景極速訓練專用變數
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

// 5. 處理嚴格進洞邏輯 (每個物理 Tick 都會執行)
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

    //🔥 在正常遊戲模式下，每一幀檢查回合是否結束
    if (!isBackgroundTraining) {
        checkTurnEndAsync();
    }
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

//🔥 新增：瞬間重置盤面功能 (避免重新載入網頁拖慢訓練)
function resetGame() {
    blackCount = 9;
    whiteCount = 9;
    currentPlayer = 1;
    totalTurnsThisGame = 0;
    turnActive = false;
    isMoving = false;
    hitAnyPuckThisTurn = false;
    pottedOwnPieceThisTurn = false;
    pottedStrikerThisTurn = false;
    pottedQueenThisTurn = false;
    piecesPottedThisTurn = [];
    potEffects = [];

    document.getElementById('black-count').innerText = `x ${blackCount}`;
    document.getElementById('white-count').innerText = `x ${whiteCount}`;

    // 將所有棋子依照初始排法放回中間
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

//🔥 將原本的在 afterUpdate 中的回合結算，獨立成非同步函式，以便背景訓練能完美等待
async function checkTurnEndAsync() {
    let anyMoving = false;
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;

    if (!isMoving && turnActive) {
        turnActive = false; // 鎖定狀態，避免重複進入
        totalTurnsThisGame++; 
        
        let isFoulQueen = false;
        if (pottedQueenThisTurn) {
            const ownRemaining = currentPlayer === 1 ? blackCount : whiteCount;
            if (ownRemaining > 0) {
                isFoulQueen = true;
            }
        }

        let isFoulMiss = !hitAnyPuckThisTurn;
        let isFoul = isFoulQueen || pottedStrikerThisTurn || isFoulMiss;

        // 強化學習獎勵結算
        if ((currentPlayer === 2 || isSelfPlayTraining || isBackgroundTraining) && lastAIState && lastAIAction) {
            let reward = -0.1; 
            if (pottedOwnPieceThisTurn) reward += 10.0; 
            if (pottedStrikerThisTurn) reward -= 10.0; 
            if (isFoulQueen) reward -= 10.0; 
            if (isFoulMiss) reward -= 10.0;  
            
            await carromBrain.train(lastAIState, lastAIAction, reward);
        }

        // 如果有犯規，執行退球懲罰
        if (isFoul) {
            piecesPottedThisTurn.forEach(p => {
                const rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                const ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
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

        const keepTurn = pottedOwnPieceThisTurn && !isFoul;

        if (!keepTurn) {
            currentPlayer = currentPlayer === 1 ? 2 : 1;
        }

        pottedOwnPieceThisTurn = false;
        pottedStrikerThisTurn = false;
        pottedQueenThisTurn = false;
        hitAnyPuckThisTurn = false; 
        piecesPottedThisTurn = []; 
        
        // UI 更新 (背景模式下跳過以節省效能)
        if (!isBackgroundTraining) {
            const turnIndicator = document.getElementById('turn-indicator');
            if (isSelfPlayTraining) {
                turnIndicator.innerText = `🤖 訓練模式：AI 運算中... (第 ${totalTurnsThisGame} 桿)`;
                turnIndicator.style.color = "#f39c12";
            } else if (currentPlayer === 1) {
                turnIndicator.innerText = "現在輪到：玩家 1 (下方，黑棋)";
                turnIndicator.style.color = "#2ecc71"; // 綠色
            } else {
                turnIndicator.innerText = "現在輪到：AI 神經網路 (思考中...)";
                turnIndicator.style.color = "#e74c3c"; // 紅色
            }
        }

        const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: WIDTH/2, y: resetY });
        Body.setVelocity(striker, { x: 0, y: 0 });

        // 死局防護機制與重置
        if (blackCount === 0 || whiteCount === 0 || totalTurnsThisGame > 150) {
            // 背景模式下，這裡只負責存檔與加總
            if (isBackgroundTraining) {
                bgTrainingCurrent++;
                document.getElementById('bg-progress-text').innerText = `已完成: ${bgTrainingCurrent} / ${bgTrainingTarget} 局`;
            } else {
                await carromBrain.save();
            }
            resetGame(); // 瞬間重置盤面，不用重新整理網頁！
            
            // 正常模式重置後繼續觸發下一桿
            if (!isBackgroundTraining && (isSelfPlayTraining || currentPlayer === 2)) {
                const delay = isSelfPlayTraining ? Math.max(1, 50 / currentTrainingSpeed) : 500;
                setTimeout(requestLocalAIPrediction, delay);
            }
            return;
        }

        // 正常繼續下一桿
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

//🔥 === UI 按鈕與控制邏輯 ===

document.getElementById('speed-slider').addEventListener('input', (e) => {
    currentTrainingSpeed = parseInt(e.target.value);
    document.getElementById('speed-label').innerText = `畫面速度: ${currentTrainingSpeed}x`;
    
    if (isSelfPlayTraining && !isBackgroundTraining) {
        engine.timing.timeScale = currentTrainingSpeed;
        engine.positionIterations = 10 + currentTrainingSpeed * 2;
        engine.velocityIterations = 10 + currentTrainingSpeed * 2;
    }
});

document.getElementById('btn-self-play').addEventListener('click', () => {
    isSelfPlayTraining = !isSelfPlayTraining;
    const btn = document.getElementById('btn-self-play');
    if(isSelfPlayTraining) {
        btn.innerText = "🛑 停止畫面互搏";
        btn.style.backgroundColor = "#c0392b";
        
        engine.timing.timeScale = currentTrainingSpeed; 
        engine.positionIterations = 10 + currentTrainingSpeed * 2; 
        engine.velocityIterations = 10 + currentTrainingSpeed * 2;
        
        requestLocalAIPrediction(); 
    } else {
        btn.innerText = "🤖 啟動畫面互搏";
        btn.style.backgroundColor = "#e67e22";
        
        engine.timing.timeScale = 1; 
        engine.positionIterations = 10; 
        engine.velocityIterations = 10;
    }
});

document.getElementById('btn-download').addEventListener('click', async () => {
    if (!carromBrain.isInitialized) return;
    try {
        await carromBrain.model.save('downloads://carrom-ai-model');
        alert("下載成功！\n\n請將下載的兩個檔案 (carrom-ai-model.json 和 weights.bin) 放到專案的 public 目錄中。\n未來任何人開啟遊戲，都會自動讀取這個最強大腦！");
    } catch (e) {
        alert("下載失敗：" + e.message);
    }
});

document.getElementById('btn-reset-ai').addEventListener('click', async () => {
    const confirmReset = confirm("確定要刪除 AI 的所有記憶，讓它從頭開始學習嗎？");
    if (confirmReset) {
        localStorage.removeItem('carrom-ai-exploration');
        try { await tf.io.removeModel('localstorage://carrom-ai-model'); } catch(e) {}
        if (isSelfPlayTraining) document.getElementById('btn-self-play').click();
        alert("記憶已清除！網頁將重新載入。");
        window.location.href = window.location.pathname;
    }
});

//🔥 新增：啟動背景極速訓練 500 局
document.getElementById('btn-bg-train').addEventListener('click', async () => {
    if (isBackgroundTraining) return;
    isBackgroundTraining = true;
    bgTrainingTarget = 500;
    bgTrainingCurrent = 0;
    
    // 關閉原本的畫面互搏
    if (isSelfPlayTraining) document.getElementById('btn-self-play').click();

    // 顯示遮罩、停止渲染與預設引擎迴圈
    document.getElementById('bg-training-screen').style.display = 'flex';
    document.querySelector('canvas').style.display = 'none';
    Render.stop(render);
    Runner.stop(runner);

    // 大幅提高物理精確度，因為背景運算沒有視覺限制
    engine.positionIterations = 20;
    engine.velocityIterations = 20;

    resetGame();

    let ticks = 0;
    //🔥 核心迴圈：完全脫離 setTimeout，CPU 全速運轉
    while (bgTrainingCurrent < bgTrainingTarget) {
        if (!isMoving && !turnActive) {
            executeAIActionSync();
        }

        // 手動推進物理時間 (每次推進約 16 毫秒)
        Engine.update(engine, 16.666);
        
        // 手動等待並結算回合
        await checkTurnEndAsync();

        ticks++;
        // 每運算 100 幀 (約等於物理世界過了 1.6 秒)，釋放一次主執行緒，避免瀏覽器當機
        if (ticks % 100 === 0) {
            await new Promise(r => setTimeout(r, 0)); 
        }
    }

    // 訓練結束，存檔並恢復畫面
    await carromBrain.save();
    isBackgroundTraining = false;
    document.getElementById('bg-training-screen').style.display = 'none';
    document.querySelector('canvas').style.display = 'block';
    
    // 恢復正常物理引擎設定並重置
    engine.positionIterations = 10;
    engine.velocityIterations = 10;
    resetGame();
    Render.run(render);
    Runner.run(runner, engine);

    alert("⚡ 精神時光屋修煉完成！500 局極速訓練已結束，AI 大腦已存檔！");
});


//🔥 === TensorFlow.js 本機機器學習 AI 大腦 ===

class CarromBrain {
    constructor() {
        this.explorationRate = 1.0; 
        this.explorationDecay = 0.995; 
        this.minExploration = 0.05; 
        this.isInitialized = false; 
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
                document.getElementById('ml-status').innerText = `本地記憶載入成功！目前探索率: ${Math.round(this.explorationRate * 100)}%`;
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
    }

    getStateArray() {
        const state = [];
        for (let id = 100; id <= 118; id++) {
            const puck = pucks.find(p => p.id === id);
            if (puck && puck.position.x !== -100) {
                state.push(puck.position.x / WIDTH);
                state.push(puck.position.y / HEIGHT);
            } else {
                state.push(0);
                state.push(0);
            }
        }
        state.push(currentPlayer === 1 ? 1 : -1);
        return state;
    }

    predict(stateArray) {
        if (!this.isInitialized) return [0, 0, 0]; 

        if (Math.random() < this.explorationRate) {
            return [
                (Math.random() * 2) - 1, 
                (Math.random() * 2) - 1, 
                (Math.random() * 2) - 1  
            ];
        }

        return tf.tidy(() => {
            const inputTensor = tf.tensor2d([stateArray]);
            const prediction = this.model.predict(inputTensor);
            return prediction.dataSync();
        });
    }

    async train(stateArray, actionTaken, reward) {
        if (!this.isInitialized) return;

        const targetAction = actionTaken.map(a => {
            let adjustment = a + (reward * 0.1 * a);
            return Math.max(-1, Math.min(1, adjustment)); 
        });

        const xs = tf.tensor2d([stateArray]);
        const ys = tf.tensor2d([targetAction]);

        await this.model.fit(xs, ys, { epochs: 1, verbose: 0 });

        xs.dispose();
        ys.dispose();

        if (this.explorationRate > this.minExploration) {
            this.explorationRate *= this.explorationDecay;
        }

        if(!isBackgroundTraining) {
            document.getElementById('ml-status').innerText = `AI 探索率: ${Math.round(this.explorationRate * 100)}% (上次獎勵: ${reward})`;
        }
    }
}

const carromBrain = new CarromBrain();
carromBrain.init(); 

//🔥 新增：同步執行 AI 動作 (完全去除 setTimeout，專為背景極速模式打造)
function executeAIActionSync() {
    lastAIState = carromBrain.getStateArray();
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

// 正常畫面的 AI 預測呼叫 (保有視覺延遲)
function requestLocalAIPrediction() {
    const delay = isSelfPlayTraining ? Math.max(1, 50 / currentTrainingSpeed) : 500;
    setTimeout(() => {
        executeAIActionSync();
    }, delay);
}
