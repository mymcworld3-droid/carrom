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
    const clickY = e.clientY - top;

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
        const angle
