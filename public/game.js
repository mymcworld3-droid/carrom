const { Engine, Render, Runner, Bodies, Composite, Vector, Body, Events, Mouse, MouseConstraint } = Matter;

// 遊戲區域設定
const WIDTH = 600;
const HEIGHT = 600;

// 🔥 --- 定義自定義顏色 --- 🔥
// Brown/Coffee color for table elements
const tableDetailColor = 'rgba(93, 64, 55, 0.6)'; // Table detail brown for pattern and baseline
const queenColor = '#d35400'; // 皇后橘紅

// 1. 初始化物理引擎
const engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 10
});
engine.world.gravity.y = 0; // 俯視圖無重力

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
        hasBounds: true
    }
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// 3. 建立棋盤邊界 (牆壁) 與 球洞 (Pockets)
const wallOptions = { isStatic: true, render: { fillStyle: '#5d4037' }, restitution: 0.6, friction: 0 };

// 加厚牆壁厚度並向外偏移。視覺上看起来是一樣的邊框，但物理上是一堵厚牆，彻底防止高速穿透
const walls = [
    Bodies.rectangle(WIDTH/2, -30, WIDTH + 200, 100, wallOptions), // 上
    Bodies.rectangle(WIDTH/2, HEIGHT + 30, WIDTH + 200, 100, wallOptions), // 下
    Bodies.rectangle(-30, HEIGHT/2, 100, HEIGHT + 200, wallOptions), // 左
    Bodies.rectangle(WIDTH + 30, HEIGHT/2, 100, HEIGHT + 200, wallOptions) // 右
];

// 建立四個角落的球洞
const pocketRadius = 30;
const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket', render: { fillStyle: '#1a1a1a' } };
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
    frictionAir: 0.008, // 降低阻力，更滑
    friction: 0.01,
    mass: 15,
    render: { fillStyle: '#c0392b', strokeStyle: '#f39c12', lineWidth: 3 } // 打擊子質感
});

// 目標棋子 (Pucks) - 黑白紅標準六角形排法
const pucks = [];
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const puckRadius = 12;
const gap = 24.5; // 稍微大於直徑(24)，避免初始載入時爆開
let puckId = 100;

const puckOptions = {
    label: 'puck',
    restitution: 0.8, 
    frictionAir: 0.004, // 棋子更滑
    friction: 0.01,
    mass: 5,
    render: { lineWidth: 1 } // 用於凹槽視覺
};

// 1. 中心皇后 (1顆橘紅)
pucks.push(Bodies.circle(cx, cy, puckRadius, { 
    ...puckOptions, 
    id: puckId++, 
    render: { fillStyle: queenColor, strokeStyle: '#e67e22', lineWidth: 1 } 
}));

// 2. 內圈 (6顆，交替顏色)
for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x = cx + Math.cos(angle) * gap;
    const y = cy + Math.sin(angle) * gap;
    const color = (i % 2 === 0) ? '#ecf0f1' : '#2c3e50';
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 } 
    }));
}

// 3. 外圈 (12顆，交替顏色 Y 字型對齊)
for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    let dist, color;
    
    if (i % 2 === 0) {
        dist = gap * 2;
        color = '#ecf0f1'; // 角落白
    } else {
        dist = gap * Math.sqrt(3);
        color = '#2c3e50'; // 邊中點黑
    }
    
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    pucks.push(Bodies.circle(x, y, puckRadius, { 
        ...puckOptions, 
        id: puckId++, 
        render: { fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 } 
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
                // 棋子進洞，移出畫面
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

// 6. 滑鼠控制與互動 (原本的 MouseConstraint)
let mouse = Mouse.create(render.canvas),
    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: {
                visible: false
            }
        }
    });
Composite.add(engine.world, mouseConstraint);
render.mouse = mouse;

// 互動狀態
let dragging = false;

window.addEventListener('pointermove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    const mousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
});

window.addEventListener('pointerdown', (e) => {
    // 檢查是否點擊 striker 附近以啟用拖曳效果 (標準滑鼠控制仍然生效，此為自定義邏輯)
    const rect = render.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const strikerPos = striker.position;
    
    // 簡單的距離檢查，判斷是否點擊在 striker 附近
    const dist = Vector.magnitude(Vector.sub({ x: clickX, y: clickY }, strikerPos));
    if (dist < 40) {
        dragging = true;
    }
});

window.addEventListener('pointerup', (e) => {
    // 在放開滑鼠時，如果正在拖曳 stiker，標記回合開始
    if (dragging) {
        dragging = false;
        
        //🔥 修正拼寫錯誤: Body.setPosition(stiker, ...) -> striker
        Body.setPosition(striker, { x: WIDTH/2, y: HEIGHT * 0.8 }); // 重置紅球位置
        Body.setVelocity(striker, { x: 0, y: 0 });
    }
});

// 🔥 --- 自定義繪製：確保元素層級 (Table elements under pieces) --- 🔥

// 🔥 將原本 afterRender 中的背景繪製邏輯移至 beforeRender 事件。
// 🔥 Matter.js 標準渲染器會在 beforeRender 事件之後繪製實體（棋子），
// 🔥 確保了背景圖案在下方。
Events.on(render, 'beforeRender', (event) => {
    const ctx = render.context;
    // Context is clean (just background color). Draw table details.

    // 1. --- 桌子中間的花形 Pattern (Below pieces) ---
    // Deep Brown color for a wood carving look.
    ctx.save();
    ctx.translate(WIDTH/2, HEIGHT/2);
    ctx.beginPath();
    // 繪製8個花瓣
    for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(20, -50, 40, -50, 0, -80);
        ctx.bezierCurveTo(-40, -50, -20, -50, 0, 0);
    }
    // 使用深褐色 (Table detail brown)，看起來像木頭雕刻
    ctx.strokeStyle = tableDetailColor; 
    ctx.lineWidth = 2;
    ctx.stroke();
    // 畫皇后位置小圓
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, 2 * Math.PI);
    ctx.fillStyle = queenColor;
    ctx.fill();
    ctx.restore();

    // 2. --- 基準線 Baseline (Below pieces, Coffee Brown color) ---
    // baseline is defined at HEIGHT * 0.8
    const baselineY = HEIGHT * 0.8;
    ctx.beginPath();
    // 🔥 畫一條咖啡色細線 (Coffee brown)
    ctx.moveTo(100, baselineY);
    ctx.lineTo(WIDTH - 100, baselineY);
    // 使用咖啡色 (Table detail brown)
    ctx.strokeStyle = tableDetailColor; 
    ctx.lineWidth = 2;
    ctx.stroke();
    // 畫咖啡色細線兩端的小圓
    ctx.beginPath();
    ctx.arc(100, baselineY, 4, 0, 2 * Math.PI);
    ctx.arc(WIDTH - 100, baselineY, 4, 0, 2 * Math.PI);
    ctx.fillStyle = tableDetailColor;
    ctx.fill();
});

// Interaction/Foreground visual line (On top of pieces)
Events.on(render, 'afterRender', () => {
    // Standard renderer already drew bodies.

    // 視覺拉線效果 (Dashed white line on top)
    if (dragging && mouseConstraint.body && mouseConstraint.body.label === 'striker') {
        const ctx = render.context;
        const strikerPos = mouseConstraint.body.position;
        const mousePos = mouseConstraint.mouse.position;
        
        ctx.beginPath();
        ctx.moveTo(strikerPos.x, strikerPos.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; // 半透明白色虛線
        ctx.lineWidth = 4;
        ctx.setLineDash([5, 5]); // 虛線樣式
        ctx.stroke();
        ctx.setLineDash([]); // 重置虛線
    }
});
