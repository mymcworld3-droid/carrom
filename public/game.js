const { Engine, Render, Runner, Bodies, Composite, Mouse, Vector, Body, Events } = Matter;

const WIDTH = 600;
const HEIGHT = 600;

// 1. 初始化物理引擎
//🔥 提高物理引擎的運算迭代次數，能大幅增加碰撞與邊界判定的精準度
const engine = Engine.create({
    positionIterations: 8,
    velocityIterations: 8
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
        showAngleIndicator: false
    }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

JavaScript
// 3. 建立棋盤邊界 (牆壁) 與 球洞 (Pockets)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6 };

//🔥 加厚牆壁厚度到 100px 並向外偏移。畫面上看起來一樣是 20px 的邊框，但物理上是一堵厚牆，徹底防止高速穿透
const walls = [
    Bodies.rectangle(WIDTH/2, -30, WIDTH + 200, 100, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT + 30, WIDTH + 200, 100, wallOptions), // 下
    Bodies.rectangle(-30, HEIGHT/2, 100, HEIGHT + 200, wallOptions), // 左
    Bodies.rectangle(WIDTH + 30, HEIGHT/2, 100, HEIGHT + 200, wallOptions) // 右
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
    mass: 15, //🔥 明確設定打擊子的質量為 15 (通常為棋子的 3 倍重)，撞擊會更有真實感與穿透力
    render: { fillStyle: '#ff4757', strokeStyle: '#fff', lineWidth: 2 } 
});

// 目標棋子 (Pucks) - 黑白紅標準六角形排法
const pucks = [];
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const puckRadius = 12;
const gap = 24.5; // 稍微大於直徑(24)一點點，避免物理引擎剛載入時因邊緣重疊而爆開
let puckId = 100;

// 定義標準顏色
const colorQueen = '#ff9f43'; // 皇后 (紅/橘)
const colorWhite = '#f5f6fa'; // 白棋
const colorBlack = '#2f3542'; // 黑棋

const puckOptions = {
    label: 'puck',
    restitution: 0.8, 
    frictionAir: 0.015,
    mass: 5 //🔥 明確設定普通棋子與皇后的質量為 5
};

// 1. 中心皇后 (1顆)
pucks.push(Bodies.circle(cx, cy, puckRadius, { 
    ...puckOptions, 
    id: puckId++, 
    render: { fillStyle: colorQueen } 
}));

// 2. 內圈 (6顆，交替顏色)
for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x = cx + Math.cos(angle) * gap;
    const y = cy + Math.sin(angle) * gap;
    const color = (i % 2 === 0) ? colorWhite : colorBlack;
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { fillStyle: color } 
    }));
}

// 3. 外圈 (12顆)
// 為了達到標準的 9白 9黑，並形成白棋的 Y 字型，外圈的 6 個「角」為白，6 個「邊中點」為黑
for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    let dist, color;
    
    if (i % 2 === 0) {
        // 角落 (0, 60, 120...度)
        dist = gap * 2;
        color = colorWhite;
    } else {
        // 邊緣中點 (30, 90, 150...度)
        dist = gap * Math.sqrt(3);
        color = colorBlack;
    }
    
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { fillStyle: color } 
    }));
}

// 將球洞、棋子加入物理世界
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

// 6. 互動邏輯 (打擊)

let isDragging = false;
let startPoint = null;
let mousePos = { x: 0, y: 0 };
let isMoving = false; // 防止移動中重複擊打
let turnActive = false; //🔥 新增變數：記錄是否剛擊打過，用來判定何時重置紅球

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

    // 計算反向力：大幅調降力道基數，避免物理引擎穿透
    const forceMultiplier = 0.005; 
    let forceX = (startPoint.x - endX) * forceMultiplier;
    let forceY = (startPoint.y - endY) * forceMultiplier;

    // 限制最大力道，防止玩家拉太遠導致球速過快飛出邊界
    const maxForce = 0.8;
    const currentForce = Math.sqrt(forceX * forceX + forceY * forceY);
    if (currentForce > maxForce) {
        forceX = (forceX / currentForce) * maxForce;
        forceY = (forceY / currentForce) * maxForce;
    }

    const forceVector = { x: forceX, y: forceY };

    // 應用物理力到 striker
    Body.applyForce(striker, striker.position, forceVector);

    //🔥 延遲一點點再標記回合進行中，確保物理引擎已經賦予球體速度
    setTimeout(() => {
        turnActive = true;
    }, 50);
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

    //🔥 如果所有球都已經靜止，且是擊球後的回合，則重置紅球位置
    if (!isMoving && turnActive) {
        turnActive = false; //🔥 結束這回合的追蹤狀態
        
        //🔥 把紅球強制放回發球區中心
        Body.setPosition(striker, { x: WIDTH/2, y: HEIGHT * 0.8 });
        Body.setVelocity(striker, { x: 0, y: 0 });
    }
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
