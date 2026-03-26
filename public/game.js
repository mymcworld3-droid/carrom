const { Engine, Render, Runner, Bodies, Composite, Vector, Body, Events } = Matter;

const socket = io(); //🔥 初始化與伺服器的連線

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
let piecesPottedThisTurn = []; 

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
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                    if (currentPlayer === 1) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorWhite) {
                    whiteCount--;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
                    if (currentPlayer === 2) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorQueen) {
                    pottedQueenThisTurn = true; 
                }

                potSound.play();
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

            potSound.play();
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
    if (currentPlayer === 2) return; 
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
    if (currentPlayer === 2) return; 
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
    if (currentPlayer === 2) return; 
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
    Body.applyForce(striker, striker.position, forceVector);

    setTimeout(() => {
        turnActive = true;
    }, 50);
});

// 7. 檢查是否所有棋子都靜止，並處理回合切換
Events.on(engine, 'afterUpdate', () => {
    let anyMoving = false;
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;

    if (!isMoving && turnActive) {
        turnActive = false; 
        
        let isFoulQueen = false;
        if (pottedQueenThisTurn) {
            const ownRemaining = currentPlayer === 1 ? blackCount : whiteCount;
            if (ownRemaining > 0) {
                isFoulQueen = true;
            }
        }

        if (isFoulQueen) {
            piecesPottedThisTurn.forEach(p => {
                const rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                const ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
                Body.setPosition(p, { x: rx, y: ry });
                Body.setVelocity(p, { x: 0, y: 0 });

                if (p.render.fillStyle === colorBlack) {
                    blackCount++;
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else if (p.render.fillStyle === colorWhite) {
                    whiteCount++;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
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
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else {
                    whiteCount++;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
                }
            }
            pottedOwnPieceThisTurn = false; 
        }

        const keepTurn = pottedOwnPieceThisTurn && !pottedStrikerThisTurn && !isFoulQueen;

        if (!keepTurn) {
            currentPlayer = currentPlayer === 1 ? 2 : 1;
        }

        pottedOwnPieceThisTurn = false;
        pottedStrikerThisTurn = false;
        pottedQueenThisTurn = false;
        piecesPottedThisTurn = []; 
        
        const turnIndicator = document.getElementById('turn-indicator');
        if (currentPlayer === 1) {
            turnIndicator.innerText = "現在輪到：玩家 1 (下方，黑棋)";
            turnIndicator.style.color = "#2ecc71"; // 綠色
        } else {
            //🔥 更新為明確的 AI 準備狀態
            turnIndicator.innerText = "現在輪到：AI (準備中...)";
            turnIndicator.style.color = "#e74c3c"; // 紅色
        }

        const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: WIDTH/2, y: resetY });
        Body.setVelocity(striker, { x: 0, y: 0 });

        if (currentPlayer === 2) {
            requestAIAction();
        }
    }
});

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

//🔥 === 新增 AI 專屬邏輯區塊 ===

function requestAIAction() {
    const whitePucks = pucks
        .filter(p => p.render.fillStyle === colorWhite && p.position.x !== -100)
        .map(p => ({ x: Math.round(p.position.x), y: Math.round(p.position.y) }));
    const blackPucks = pucks
        .filter(p => p.render.fillStyle === colorBlack && p.position.x !== -100)
        .map(p => ({ x: Math.round(p.position.x), y: Math.round(p.position.y) }));
    const queenPuck = pucks.find(p => p.render.fillStyle === colorQueen && p.position.x !== -100);

    const gameState = {
        whitePucks,
        blackPucks,
        queen: queenPuck ? { x: Math.round(queenPuck.position.x), y: Math.round(queenPuck.position.y) } : null
    };

    socket.emit('requestAIMove', gameState);
}

//🔥 接收 AI 即時狀態更新並顯示在左上角
socket.on('aiStatus', (statusMessage) => {
    const turnIndicator = document.getElementById('turn-indicator');
    if (turnIndicator && currentPlayer === 2) {
        turnIndicator.innerText = `現在輪到：AI - ${statusMessage}`;
    }
});

//🔥 接收並在畫面上顯示 AI 錯誤提示框 (沿用稍早加入的機制)
socket.on('aiError', (errorMessage) => {
    const errorToast = document.getElementById('error-toast');
    if (errorToast) {
        errorToast.innerText = errorMessage;
        errorToast.style.display = 'block';  
        
        setTimeout(() => {
            errorToast.style.display = 'none';
        }, 5000);
    } else {
        alert(errorMessage);
    }
});

socket.on('aiMove', (move) => {
    if (currentPlayer !== 2) return; 

    //🔥 讓前端顯示 AI 已經做完決定
    const turnIndicator = document.getElementById('turn-indicator');
    if (turnIndicator) {
        turnIndicator.innerText = "現在輪到：AI - 決定打擊力道與角度！";
    }

    const safeX = Math.max(120, Math.min(480, move.strikerX || 300));
    let safeForceX = Math.max(-0.8, Math.min(0.8, move.forceX || 0));
    let safeForceY = Math.max(0, Math.min(0.8, move.forceY || 0.4)); 

    Body.setPosition(striker, { x: safeX, y: HEIGHT * 0.2 });
    Body.setVelocity(striker, { x: 0, y: 0 });

    setTimeout(() => {
        //🔥 擊球瞬間顯示狀態
        if (turnIndicator) {
            turnIndicator.innerText = "現在輪到：AI - 擊球！";
        }
        
        const forceVector = { x: safeForceX, y: safeForceY };
        Body.applyForce(striker, striker.position, forceVector);
        
        setTimeout(() => {
            turnActive = true;
        }, 50);
    }, 1000);
});
