// 自動連接到託管的伺服器
const socket = io();

const { Engine, Render, Runner, Bodies, Composite, Mouse, Vector, Body } = Matter;

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

// 3. 建立棋盤邊界 (牆壁)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' } };
const walls = [
    Bodies.rectangle(WIDTH/2, 10, WIDTH, 20, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT-10, WIDTH, 20, wallOptions), // 下
    Bodies.rectangle(10, HEIGHT/2, 20, HEIGHT, wallOptions), // 左
    Bodies.rectangle(WIDTH-10, HEIGHT/2, 20, HEIGHT, wallOptions) // 右
];

// 4. 建立棋子

// 打擊子 (Striker) - 較大
const striker = Bodies.circle(WIDTH/2, HEIGHT * 0.8, 20, { 
    restitution: 0.5, 
    frictionAir: 0.03, 
    mass: 5,
    render: { fillStyle: '#ff4757', strokeStyle: '#fff', lineWidth: 2 } 
});

// 目標棋子 (Pucks) - 較小
const pucks = [];
for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const dist = 50;
    pucks.push(Bodies.circle(WIDTH/2 + Math.cos(angle) * dist, HEIGHT/2 + Math.sin(angle) * dist, 12, { 
        restitution: 0.8, 
        frictionAir: 0.02,
        render: { fillStyle: (i === 0) ? '#ff9f43' : '#2f3542' } // 中間一個是黃色的
    }));
}

Composite.add(engine.world, [...walls, striker, ...pucks]);

// 5. 互動邏輯 (打擊)

let isDragging = false;
let startPoint = null;
let mousePos = { x: 0, y: 0 };

// 監聽滑鼠移動以繪製拉力線 (僅視覺)
window.addEventListener('mousemove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// 滑鼠按下：檢查是否點擊在打擊子上
window.addEventListener('mousedown', (e) => {
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

// 滑鼠放開：施加力量並傳送給對手
window.addEventListener('mouseup', (e) => {
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

    // 🔥 傳送擊球數據到伺服器
    socket.emit('strike', {
        force: forceVector,
        position: striker.position // 傳送當前位置以進行粗略同步
    });
});

// 6. 接收對手動作
socket.on('opponentStrike', (data) => {
    // 收到對手擊球，同步 Striker 位置並施力
    // 注意：這只是基礎原型，實際遊戲需要更精密的狀態同步演算法
    Body.setPosition(striker, data.position);
    Body.applyForce(striker, striker.position, data.force);
});

// 7. 視覺化拉力線 (自定義渲染)
Matter.Events.on(render, 'afterRender', () => {
    if (isDragging && startPoint) {
        const ctx = render.context;
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
});
