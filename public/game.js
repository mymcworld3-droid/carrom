const { Engine, Render, Runner, Bodies, Composite, Mouse, Vector, Body, Events } = Matter;

const WIDTH = 600;
const HEIGHT = 600;

// 1. 初始化物理引擎
const engine = Engine.create();
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
        showAngleIndicator: false
    }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// 3. 建立棋盤邊界 (牆壁) 與 球洞 (Pockets)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6 };
const walls = [
    Bodies.rectangle(WIDTH/2, 10, WIDTH, 20, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT-10, WIDTH, 20, wallOptions), // 下
    Bodies.rectangle(10, HEIGHT/2, 20, HEIGHT, wallOptions), // 左
    Bodies.rectangle(WIDTH-10, HEIGHT/2, 20, HEIGHT, wallOptions) // 右
];

// 建立四個角落的球洞
const pocketRadius = 30;
const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket', render: { fillStyle: '#2d3436' } };
const pockets = [
    Bodies.circle(30, 30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, 30, pocketRadius, pocketOptions),
    Bodies.circle(30, HEIGHT-30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, HEIGHT-30, pocketRadius, pocketOptions)
];

// 4. 建立棋子

// 打擊子 (Striker) - 較大
const striker = Bodies.circle(WIDTH/2, HEIGHT * 0.8, 20, { 
    label: 'striker',
    restitution: 0.6, 
    frictionAir: 0.02, 
    mass: 5,
    render: { fillStyle: '#ff4757', strokeStyle: '#fff', lineWidth: 2 } 
});

// 目標棋子 (Pucks) - 較小
const pucks = [];
for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const dist = 50;
    pucks.push(Bodies.circle(WIDTH/2 + Math.cos(angle) * dist, HEIGHT/2 + Math.sin(angle) * dist, 12, { 
        id: i + 100,
        label: 'puck',
        restitution: 0.8, 
        frictionAir: 0.015,
        render: { fillStyle: (i === 0) ? '#ff9f43' : '#2f3542' } // 中間一個是黃色的
    }));
}

// 將球洞 pockets 加入物理世界
Composite.add(engine.world, [...walls, ...pockets, striker, ...pucks]);

// 5. 處理進洞邏輯 (偵測碰撞)
Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;

        const pocket = (bodyA.label === 'pocket') ? bodyA : ((bodyB.label === 'pocket') ? bodyB : null);
        const piece = (bodyA.label === 'pocket') ? bodyB : ((bodyB.label === 'pocket') ? bodyA : null);

        if (pocket && piece) {
            if (piece.label === 'puck') {
                // 棋子進洞，移出畫面並停止運動
                Body.setPosition(piece, { x: -100, y: -100 });
                Body.setVelocity(piece, { x: 0, y: 0 });
            } else if (piece.label === 'striker') {
                // 打擊子進洞，懲罰性重置到發球線
                Body.setPosition(striker, { x: WIDTH/2, y: HEIGHT * 0.8 });
                Body.setVelocity(striker, { x: 0, y: 0 });
            }
        }
    }
});

// 6. 互動邏輯 (打擊)

let isDragging = false;
let startPoint = null;
let mousePos = { x: 0, y: 0 };
let isMoving = false; // 防止移動中重複擊打

// 監聽指標移動 (PointerEvent 同時支援滑鼠與觸控螢幕)
window.addEventListener('pointermove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// 指標按下：檢查是否點擊在打擊子上
window.addEventListener('pointerdown', (e) => {
    if (isMoving) return; // 棋子移動中不允許拖曳

    const rect = render.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // 簡單的距離檢查，判斷是否點擊在 striker 附近
    const dist = Vector.magnitude(Vector.sub({ x: clickX, y: clickY }, striker.position));
    if (dist < 30) {
        isDragging = true;
        startPoint = { x: striker.position.x, y: striker.position.y };
    }
});

// 指標放開：施加力量
window.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const rect = render.canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    // 計算反向力 (像拉彈弓)
    const forceMultiplier = 0.08; // 調整力道
    const forceVector = {
        x: (startPoint.x - endX) * forceMultiplier,
        y: (startPoint.y - endY) * forceMultiplier
    };

    // 應用物理力到 striker
    Body.applyForce(striker, striker.position, forceVector);
});

// 7. 檢查是否所有棋子都靜止
Events.on(engine, 'afterUpdate', () => {
    let anyMoving = false;
    // 檢查速度是否大於微小值
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;
});

// 8. 視覺化拉力線與棋盤線 (自定義渲染)
Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    
    // 畫棋盤中心圓
    ctx.beginPath();
    ctx.arc(WIDTH/2, HEIGHT/2, 60, 0, 2 * Math.PI);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 畫底部的發球線區域
    ctx.beginPath();
    ctx.moveTo(100, HEIGHT * 0.8);
    ctx.lineTo(WIDTH - 100, HEIGHT * 0.8);
    ctx.strokeStyle = 'rgba(93, 64, 55, 0.5)';
    ctx.lineWidth = 20;
    ctx.stroke();

    if (isDragging && startPoint) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 4;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
});
