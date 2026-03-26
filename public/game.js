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
// 這裡將球洞標記為 Sensor，不進行實體碰撞，我們將在下面手動判定嚴格進洞
const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket', render: { fillStyle: '#1a1a1a' } };
const pockets = [
    Bodies.circle(30, 30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, 30, pocketRadius, pocketOptions),
    Bodies.circle(30, HEIGHT-30, pocketRadius, pocketOptions),
    Bodies.circle(WIDTH-30, HEIGHT-30, pocketRadius, pocketOptions)
];

// 4. 建立棋子

// 定義棋子外觀顏色 (使用更有質感的色調)
const colorQueen = '#d35400'; // 皇后 (紅/橘)
const colorWhite = '#ecf0f1'; // 白棋
const colorBlack = '#2c3e50'; // 黑棋
const colorStriker = '#c0392b'; // 打擊子 (深紅)

// 打擊子 (Striker) - 較大，設定質量
const striker = Bodies.circle(WIDTH/2, HEIGHT * 0.8, 20, { 
    label: 'striker',
    restitution: 0.6, 
    frictionAir: 0.008, // 降低表面滑行阻力
    friction: 0.01,     // 降低接觸摩擦力
    mass: 15, // 打擊子質量為棋子的 3 倍
    render: { 
        visible: false, // 關閉引擎預設渲染，我們將在下面手動繪製，確保圖層完全正確
        fillStyle: colorStriker, 
        strokeStyle: '#f39c12', // 金色細邊框
        lineWidth: 3
    } 
});

// 目標棋子 (Pucks) - 黑白紅標準六角形排法
const pucks = [];
const cx = WIDTH / 2;
const cy = HEIGHT / 2;
const puckRadius = 12;
const gap = 24.5; // 稍微大於直徑(24)一點點，避免物理引擎剛載入時因邊緣重疊而爆開
let puckId = 100;

// 定義普通棋子與皇后的物理屬性
const puckOptions = {
    label: 'puck',
    restitution: 0.8, 
    frictionAir: 0.004, // 大幅降低普通棋子的表面滑行阻力
    friction: 0.01,     // 降低接觸摩擦力
    mass: 5 // 普通棋子質量為 5
};

// 1. 中心皇后 (1顆)
pucks.push(Bodies.circle(cx, cy, puckRadius, { 
    ...puckOptions, 
    id: puckId++, 
    render: { visible: false, fillStyle: colorQueen, strokeStyle: '#e67e22', lineWidth: 1 } // 關閉預設渲染
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
        render: { visible: false, fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 } // 關閉預設渲染
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
        render: { visible: false, fillStyle: color, strokeStyle: '#95a5a6', lineWidth: 1 } // 關閉預設渲染
    }));
}

// 將球洞、棋子加入物理世界
Composite.add(engine.world, [...walls, ...pockets, striker, ...pucks]);

// 宣告黑白棋剩餘數量與特效狀態
let blackCount = 9;
let whiteCount = 9;
let potEffects = []; // 用於儲存進洞特效的狀態 (光圈與棋子縮小)

// 定義當前玩家 (1 為下方/打黑棋，2 為上方/打白棋)
let currentPlayer = 1;

// 宣告這回合的擊球結算狀態變數
let pottedOwnPieceThisTurn = false;
let pottedStrikerThisTurn = false;
let pottedQueenThisTurn = false;
let piecesPottedThisTurn = []; // 記錄這回合被打進的所有棋子 (為了犯規時能吐出來)

// 5. 處理嚴格進洞邏輯 (由 collisionStart 改為在 afterUpdate 中手動計算距離)
Events.on(engine, 'afterUpdate', () => {
    // 檢查所有棋子 (Pucks)
    pucks.forEach(piece => {
        // 只有還在棋盤上的棋子才需要檢查
        if (piece.position.x === -100) return;

        pockets.forEach(pocket => {
            // 計算棋子與球洞中心點的距離
            const dist = Vector.magnitude(Vector.sub(piece.position, pocket.position));
            
            // 嚴格進洞判定：棋子中心點必須進入球洞半徑內 (這裡設定小於 25px)
            if (dist < 25) {
                // 記錄這回合進洞的棋子
                piecesPottedThisTurn.push(piece);

                // 進洞特效：新增一個特效狀態到陣列中
                potEffects.push({
                    x: pocket.position.x,
                    y: pocket.position.y,
                    r: 10,        // 初始光圈半徑
                    color: '#f1c40f', // 進球光圈顏色 (金色)
                    life: 30,     // 特效生命週期 (影格數)
                    type: 'piece', // 特效類型
                    // 儲存棋子消失前的最後狀態
                    piecePos: { x: piece.position.x, y: piece.position.y },
                    pieceRad: piece.circleRadius,
                    pieceColor: piece.render.fillStyle
                });

                // 進洞扣除數量邏輯與連擊條件判斷
                if (piece.render.fillStyle === colorBlack) {
                    blackCount--;
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                    if (currentPlayer === 1) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorWhite) {
                    whiteCount--;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
                    if (currentPlayer === 2) pottedOwnPieceThisTurn = true; 
                } else if (piece.render.fillStyle === colorQueen) {
                    pottedQueenThisTurn = true; // 標記皇后進洞
                }

                // 播放進洞音效
                potSound.play();

                // 棋子進洞，暫時移出畫面並停止運動
                Body.setPosition(piece, { x: -100, y: -100 });
                Body.setVelocity(piece, { x: 0, y: 0 });
            }
        });
    });

    // 檢查打擊子 (Striker)
    pockets.forEach(pocket => {
        // 計算打擊子與球洞中心點的距離
        const distS = Vector.magnitude(Vector.sub(striker.position, pocket.position));
        
        // 打擊子進洞嚴格判定 (中心點進入距離小於 25px)
        if (distS < 25 && !isPlacing) { // 擺放模式下不判定進洞
             // 進洞特效：新增一個特效狀態到陣列中
             potEffects.push({
                x: pocket.position.x,
                y: pocket.position.y,
                r: 10,        // 初始光圈半徑
                color: '#c0392b', // 進球光圈顏色 (深紅)
                life: 30,     // 特效生命週期 (影格數)
                type: 'striker', // 特效類型
                // 儲存棋子消失前的最後狀態
                piecePos: { x: striker.position.x, y: striker.position.y },
                pieceRad: striker.circleRadius,
                pieceColor: striker.render.fillStyle
            });

            // 播放進洞音效
            potSound.play();
            
            pottedStrikerThisTurn = true; // 標記母球洗澡(犯規)

            // 判斷當前玩家的基準線 Y 座標 (犯規重置仍在當前玩家這邊)
            const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
            Body.setPosition(striker, { x: WIDTH/2, y: resetY });
            Body.setVelocity(striker, { x: 0, y: 0 });
        }
    });
});

// 6. 互動邏輯 (打擊與擺放)

let isDragging = false;
let startPoint = null;
let mousePos = { x: 0, y: 0 };
let isMoving = false; // 防止移動中重複擊打
let turnActive = false; // 記錄是否剛擊打過，用來判定何時重置紅球
let isPlacing = false; // 判斷是否正在平行移動紅球

// 監聽指標移動 (PointerEvent 同時支援滑鼠與觸控螢幕)
window.addEventListener('pointermove', (e) => {
    if (currentPlayer === 2) return; //🔥 阻止玩家在 AI 回合操作
    const rect = render.canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;

    // 如果正在擺放模式，平行移動紅球
    if (isPlacing) {
        let newX = mousePos.x;
        const minX = 100 + striker.circleRadius;
        const maxX = WIDTH - 100 - striker.circleRadius;
        
        // 限制 X 軸移動範圍在發球線的兩側小圓點內
        if (newX < minX) newX = minX;
        if (newX > maxX) newX = maxX;

        // 根據當前玩家，決定鎖定在下方 (0.8) 還是上方 (0.2) 的基準線
        const lockY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        
        // 強制設定位置與清除速度
        Body.setPosition(striker, { x: newX, y: lockY });
        Body.setVelocity(striker, { x: 0, y: 0 });
    }
});

// 指標按下：檢查是否點擊在打擊子上
window.addEventListener('pointerdown', (e) => {
    if (currentPlayer === 2) return; //🔥 阻止玩家在 AI 回合操作
    if (isMoving) return; // 棋子移動中不允許拖曳或擺放

    const rect = render.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // 簡單的距離檢查，判斷是否點擊在 striker 附近
    const dist = Vector.magnitude(Vector.sub({ x: clickX, y: clickY }, striker.position));
    if (dist < 30) {
        // 點擊在紅球上 -> 進入瞄準發射模式
        isDragging = true;
        startPoint = { x: striker.position.x, y: striker.position.y };
    } else {
        // 點擊在紅球外 -> 進入擺放模式，並暫時關閉紅球的物理碰撞
        isPlacing = true;
        striker.isSensor = true;
    }
});

// 指標放開：施加力量或結束擺放
window.addEventListener('pointerup', (e) => {
    if (currentPlayer === 2) return; //🔥 阻止玩家在 AI 回合操作
    // 如果是擺放模式，結束擺放並恢復物理碰撞
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

    // 延遲一點點再標記回合進行中，確保物理引擎已經賦予球體速度
    setTimeout(() => {
        turnActive = true;
    }, 50);
});

// 7. 檢查是否所有棋子都靜止，並處理回合切換
Events.on(engine, 'afterUpdate', () => {
    let anyMoving = false;
    // 檢查速度是否大於微小值
    if (striker.speed > 0.1) anyMoving = true;
    pucks.forEach(p => {
        if (p.speed > 0.1) anyMoving = true;
    });

    isMoving = anyMoving;

    // 如果所有球都已經靜止，且是剛擊球後的回合
    if (!isMoving && turnActive) {
        turnActive = false; // 結束這回合的追蹤狀態
        
        // 檢查是否觸發「過早打進皇后」的犯規 (己方球大於0且打進Queen)
        let isFoulQueen = false;
        if (pottedQueenThisTurn) {
            const ownRemaining = currentPlayer === 1 ? blackCount : whiteCount;
            if (ownRemaining > 0) {
                isFoulQueen = true;
            }
        }

        // 如果觸發皇后犯規：本回合進球全部吐出來，並加罰一顆
        if (isFoulQueen) {
            // 1. 本回合進洞的球全部回到中間
            piecesPottedThisTurn.forEach(p => {
                // 在中心點附近給一點隨機偏移，避免棋子完美重疊而彈飛
                const rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                const ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
                Body.setPosition(p, { x: rx, y: ry });
                Body.setVelocity(p, { x: 0, y: 0 });

                // 恢復計分板數量
                if (p.render.fillStyle === colorBlack) {
                    blackCount++;
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else if (p.render.fillStyle === colorWhite) {
                    whiteCount++;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
                }
            });

            // 2. 額外加罰己方一顆球 (從已經進洞的球裡找一顆放回中間)
            const myColor = currentPlayer === 1 ? colorBlack : colorWhite;
            // 尋找顏色相符、目前在場外(-100)、且不是這回合剛被打進的球
            const penaltyPiece = pucks.find(p => p.render.fillStyle === myColor && p.position.x === -100 && !piecesPottedThisTurn.includes(p));
            
            if (penaltyPiece) {
                const rx = WIDTH/2 + (Math.random() - 0.5) * 40;
                const ry = HEIGHT/2 + (Math.random() - 0.5) * 40;
                Body.setPosition(penaltyPiece, { x: rx, y: ry });
                Body.setVelocity(penaltyPiece, { x: 0, y: 0 });
                
                // 恢復罰球的計分板數量
                if (myColor === colorBlack) {
                    blackCount++;
                    document.getElementById('black-count').innerText = `x ${blackCount}`;
                } else {
                    whiteCount++;
                    document.getElementById('white-count').innerText = `x ${whiteCount}`;
                }
            }

            // 犯規會喪失繼續擊球的權力
            pottedOwnPieceThisTurn = false; 
        }

        // 判斷是否可以繼續擊球：進了自己的球 且 沒洗澡 且 沒犯規打進皇后
        const keepTurn = pottedOwnPieceThisTurn && !pottedStrikerThisTurn && !isFoulQueen;

        if (!keepTurn) {
            // 切換玩家 (1 換 2，2 換 1)
            currentPlayer = currentPlayer === 1 ? 2 : 1;
        }

        // 重置這回合的狀態標記，為下一回合做準備
        pottedOwnPieceThisTurn = false;
        pottedStrikerThisTurn = false;
        pottedQueenThisTurn = false;
        piecesPottedThisTurn = []; // 清空本回合進洞紀錄
        
        // 更新 UI 顯示
        const turnIndicator = document.getElementById('turn-indicator');
        if (currentPlayer === 1) {
            turnIndicator.innerText = "現在輪到：玩家 1 (下方，黑棋)";
            turnIndicator.style.color = "#2ecc71"; // 綠色
        } else {
            turnIndicator.innerText = "現在輪到：玩家 2 (上方，白棋)";
            turnIndicator.style.color = "#e74c3c"; // 紅色
        }

        // 根據當前玩家，將紅球強制放回對應發球區中心
        const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: WIDTH/2, y: resetY });
        Body.setVelocity(striker, { x: 0, y: 0 });

        //🔥 如果輪到 AI (Player 2)，則向伺服器請求打擊指令
        if (currentPlayer === 2) {
            requestAIAction();
        }
    }
});

// 8. 自定義繪製與視覺化升級
Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    
    // 1. 繪製精緻的棋盤中心玫瑰花紋圖案 (在最底層)
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
    ctx.strokeStyle = 'rgba(93, 64, 55, 0.4)'; // 使用半透明的深褐色，看起來像木頭雕刻
    ctx.lineWidth = 2;
    ctx.stroke();
    // 畫中心小圓
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#d35400';
    ctx.fill();
    ctx.restore();

    // 2. 繪製下方與上方的發球線區域 (基準線)
    ctx.beginPath();
    // 畫下方咖啡色細線 (玩家 1)
    ctx.moveTo(100, HEIGHT * 0.8);
    ctx.lineTo(WIDTH - 100, HEIGHT * 0.8);
    // 畫上方咖啡色細線 (玩家 2)
    ctx.moveTo(100, HEIGHT * 0.2);
    ctx.lineTo(WIDTH - 100, HEIGHT * 0.2);
    ctx.strokeStyle = 'rgba(62, 39, 35, 0.6)'; // 半透明深咖啡色
    ctx.lineWidth = 2;
    ctx.stroke();

    // 畫深咖啡色細線兩端的小圓 (必須分開起筆，否則會連成巨大的沙漏多邊形)
    ctx.fillStyle = '#3e2723'; // 深咖啡色
    
    // 下方左端
    ctx.beginPath();
    ctx.arc(100, HEIGHT * 0.8, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // 下方右端
    ctx.beginPath();
    ctx.arc(WIDTH - 100, HEIGHT * 0.8, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // 上方左端
    ctx.beginPath();
    ctx.arc(100, HEIGHT * 0.2, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // 上方右端
    ctx.beginPath();
    ctx.arc(WIDTH - 100, HEIGHT * 0.2, 4, 0, 2 * Math.PI);
    ctx.fill();

    // 3. 正確的棋子圖層層級排序與繪製
    // 將所有棋子放入一個新陣列，以便進行排序
    const allGamePieces = [...pucks, striker];

    // 根據 Y 軸座標對棋子進行排序。
    allGamePieces.sort((pieceA, pieceB) => pieceA.position.y - pieceB.position.y);

    // 繪製排序後的棋子，確保正確的圖層層級
    allGamePieces.forEach(p => {
        // 只有還在棋盤上的棋子才需要畫
        if (p.position.x === -100) return;

        const pos = p.position;
        const radius = p.circleRadius;

        // 手動畫面出棋子的實體底色與外框 (取代引擎原本的渲染，確保圖層一定蓋住底線)
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = p.render.fillStyle;
        ctx.fill();
        if (p.render.strokeStyle) {
            ctx.strokeStyle = p.render.strokeStyle;
            ctx.lineWidth = p.render.lineWidth || 1;
            ctx.stroke();
        }

        // 畫出棋子上的凹槽與高光細節
        if (p.label === 'striker') {
            // 打擊子質感 (金色圓環凹槽與高光)
            ctx.beginPath();
            // 畫金色同心圓環
            ctx.arc(pos.x, pos.y, radius - 5, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(241, 196, 15, 0.4)'; // 半透明金色凹槽
            ctx.lineWidth = 2;
            ctx.stroke();

            // 加入高光 (圓弧線)，營造光澤感
            ctx.beginPath();
            ctx.arc(pos.x - radius/3, pos.y - radius/3, radius/3, 1 * Math.PI, 1.5 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 半透明白色高光
            ctx.lineWidth = 3;
            ctx.stroke();
        } else {
            // 普通棋子質感 (圓環凹槽與光澤)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius - 3, 0, 2 * Math.PI); // 畫一個較小的同心圓
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'; // 極細微的凹槽陰影
            ctx.lineWidth = 1;
            ctx.stroke();

            // 加入一個微小的高光 (圓弧線)，營造光澤感
            ctx.beginPath();
            ctx.arc(pos.x - radius/3, pos.y - radius/3, radius/3, 1 * Math.PI, 1.5 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; // 半透明白色高光
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    // 4. 繪製拉力線 (拖曳時顯示，畫在所有東西的最高層)
    if (isDragging && startPoint) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.strokeStyle = 'rgba(62, 39, 35, 0.7)'; // 使用咖啡色拉力線
        ctx.lineWidth = 5; // 稍微加粗一點
        ctx.setLineDash([8, 8]); // 調整虛線比例
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 5. 繪製與更新進洞特效 (光圈與棋子縮小)
    for (let i = potEffects.length - 1; i >= 0; i--) {
        const effect = potEffects[i];
        
        ctx.save();
        // 特效 1：擴散的光圈
        const alpha = effect.life / 30; // 根據生命週期計算透明度
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.r, 0, 2 * Math.PI);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 4;
        ctx.stroke();

        // 特效 2：棋子消失前的縮小視覺
        // 只有生命週期大於 0 時才繪製 (模擬掉進洞裡)
        if (alpha > 0) {
            ctx.globalAlpha = alpha * 0.8;
            const scaledRad = effect.pieceRad * alpha; // 快速縮小半徑
            ctx.beginPath();
            ctx.arc(effect.piecePos.x, effect.piecePos.y, scaledRad, 0, 2 * Math.PI);
            ctx.fillStyle = effect.pieceColor;
            ctx.fill();
        }
        ctx.restore();

        // 更新特效狀態
        effect.r += 2; // 光圈擴散
        effect.life--; // 生命週期減少

        // 特效結束後移除
        if (effect.life <= 0) {
            potEffects.splice(i, 1);
        }
    }
});

//🔥 === 新增 AI 專屬邏輯區塊 ===

// 收集並發送盤面資料給 Gemini
function requestAIAction() {
    // 過濾出還在檯面上的棋子，並四捨五入座標節省傳輸大小
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

// 接收來自伺服器的 AI 打擊指令並執行
socket.on('aiMove', (move) => {
    if (currentPlayer !== 2) return; // 雙重檢查，確保是 AI 回合

    // 安全防護機制：確保 AI 給出的數值沒有超出物理與規則邊界
    const safeX = Math.max(120, Math.min(480, move.strikerX || 300));
    let safeForceX = Math.max(-0.8, Math.min(0.8, move.forceX || 0));
    let safeForceY = Math.max(0, Math.min(0.8, move.forceY || 0.4)); // 必須往下打 (>0)

    // 1. 移動打擊子到 AI 決定的 X 座標
    Body.setPosition(striker, { x: safeX, y: HEIGHT * 0.2 });
    Body.setVelocity(striker, { x: 0, y: 0 });

    // 2. 刻意延遲 1 秒再擊打，讓人類玩家能看清楚 AI 把球擺在哪裡
    setTimeout(() => {
        const forceVector = { x: safeForceX, y: safeForceY };
        Body.applyForce(striker, striker.position, forceVector);
        
        // 延遲一點點標記回合啟動
        setTimeout(() => {
            turnActive = true;
        }, 50);
    }, 1000);
});
socket.on('aiError', (errorMessage) => {
    const errorToast = document.getElementById('error-toast');
    if (errorToast) {
        errorToast.innerText = errorMessage; // 寫入錯誤內容
        errorToast.style.display = 'block';  // 顯示提示框
        
        // 5 秒後自動隱藏
        setTimeout(() => {
            errorToast.style.display = 'none';
        }, 5000);
    } else {
        // 如果找不到 HTML 元素，則退回使用系統內建的警告視窗
        alert(errorMessage);
    }
});
