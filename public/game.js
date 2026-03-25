// 自動連接到託管的伺服器
const socket = io();

//🔥 引入 Events 來處理碰撞與每幀更新
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
//🔥 調整牆壁彈性 (restitution)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6 };
const walls = [
    Bodies.rectangle(WIDTH/2, 10, WIDTH, 20, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT-10, WIDTH, 20, wallOptions), // 下
    Bodies.rectangle(10, HEIGHT/2, 20, HEIGHT, wallOptions), // 左
    Bodies.rectangle(WIDTH-10, HEIGHT/2, 20, HEIGHT, wallOptions) // 右
];

//🔥 建立四個角落的球洞 (設定 isSensor 為 true，代表不產生實體反彈，只觸發事件)
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
    label: 'striker', //🔥 加入 label 方便辨識
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
        id: i + 100, //🔥 設定固定 ID 方便日後連線同步座標
        label: 'puck', //🔥 加入 label 方便辨識
        restitution: 0.8, 
        frictionAir: 0.015,
        render: { fillStyle: (i === 0) ? '#ff9f43' : '#2f3542' } // 中間一個是黃色的
    }));
}

//🔥 將球洞 pockets 加入物理世界
Composite.add(engine.world, [...walls, ...pockets, striker, ...pucks]);

//🔥 5. 處理進洞邏輯 (偵測碰撞)
Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;

        const pocket = (bodyA.label === 'pocket') ? bodyA : ((bodyB.label === 'pocket') ? bodyB : null);
        const piece = (bodyA.label === 'pocket') ? bodyB : ((bodyB.label === 'pocket') ? bodyA : null);

        if (pocket && piece) {
            if (piece.label === 'puck') {
                // 棋子進洞，移出畫面並停止運動 (簡單處理方式)
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
let isMoving = false; //🔥 防止移動中重複擊打
let hasStruck = false; //🔥 標記是否剛由自己完成擊球，用來判定同步權限

// 監聽滑鼠移動以繪製拉力線 (僅視覺)
window.addEventListener('mousemove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

// 滑鼠按下：檢查是否點擊在打擊子上
window.addEventListener('mousedown', (e) => {
    if (isMoving) return; //🔥 棋子移動中不允許拖曳

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

    //🔥 延遲一點點再標記已擊球，確保物理引擎已經賦予速度
    setTimeout(() => {
        hasStruck = true;
    }, 50);
});

//🔥 7. 確保狀態同步：檢查是否所有棋子都靜止
Events.on(engine, 'afterUpdate', () => {
    let anyMoving = false;
    // 檢查速度是否大於微小值
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;

    // 當我擊球後，若所有物體終於靜止，我將最新的精準座標發送給所有人強制同步
    if (!isMoving && hasStruck) {
        hasStruck = false; // 清空狀態
        
        const state = pucks.map(p => ({ id: p.id, x: p.position.x, y: p.position.y }));
        state.push({ id: 'striker', x: striker.position.x, y: striker.position.y });
        
        socket.emit('syncState', state);
    }
});

// 8. 接收對手動作
socket.on('opponentStrike', (data) => {
    // 收到對手擊球，同步 Striker 位置並施力
    Body.setPosition(striker, data.position);
    Body.setVelocity(striker, { x: 0, y: 0 }); //🔥 確保施力前速度歸零
    Body.applyForce(striker, striker.position, data.force);
});

//🔥 9. 接收對手發來的強制同步狀態
socket.on('syncState', (state) => {
    state.forEach(item => {
        if (item.id === 'striker') {
            Body.setPosition(striker, { x: item.x, y: item.y });
            Body.setVelocity(striker, { x: 0, y: 0 });
        } else {
            const puck = pucks.find(p => p.id === item.id);
            if (puck) {
                Body.setPosition(puck, { x: item.x, y: item.y });
                Body.setVelocity(puck, { x: 0, y: 0 });
            }
        }
    });
});

// 10. 視覺化拉力線與棋盤線 (自定義渲染)
Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    
    //🔥 畫棋盤中心圓
    ctx.beginPath();
    ctx.arc(WIDTH/2, HEIGHT/2, 60, 0, 2 * Math.PI);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.stroke();

    //🔥 畫底部的發球線區域
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
