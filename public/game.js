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

// 用於機器學習的狀態追蹤
let lastAIState = null;
let lastAIAction = null;

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
Events.on(engine, 'afterUpdate', async () => {
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

        // 強化學習獎勵結算 (Reward Calculation)
        if (currentPlayer === 2 && lastAIState && lastAIAction) {
            let reward = -0.1; // 基礎懲罰，逼迫 AI 趕快進球
            if (pottedOwnPieceThisTurn) reward += 10.0; // 打進自己的白球，大獎勵！
            if (pottedStrikerThisTurn) reward -= 10.0; // 洗澡，大懲罰！
            if (isFoulQueen) reward -= 10.0; // 犯規，大懲罰！
            
            // 訓練神經網路
            await carromBrain.train(lastAIState, lastAIAction, reward);
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
            turnIndicator.innerText = "現在輪到：AI 神經網路 (思考中...)";
            turnIndicator.style.color = "#e74c3c"; // 紅色
        }

        const resetY = currentPlayer === 1 ? HEIGHT * 0.8 : HEIGHT * 0.2;
        Body.setPosition(striker, { x: WIDTH/2, y: resetY });
        Body.setVelocity(striker, { x: 0, y: 0 });

        if (currentPlayer === 2) {
            // 呼叫本機的 TensorFlow 神經網路進行打擊
            requestLocalAIPrediction();
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

//🔥 === TensorFlow.js 本機機器學習 AI 大腦 ===

class CarromBrain {
    constructor() {
        this.explorationRate = 1.0; // 初始探索率 (100% 隨機嘗試)
        this.explorationDecay = 0.995; // 每次打擊後慢慢降低隨機性
        this.minExploration = 0.05; // 至少保留 5% 的隨機性來尋找新打法
        this.isInitialized = false; // 標記是否已經準備好
    }

    //🔥 新增：啟動時嘗試讀取先前的記憶
    async init() {
        try {
            // 嘗試從瀏覽器的 LocalStorage 讀取已儲存的腦部神經網路
            this.model = await tf.loadLayersModel('localstorage://carrom-ai-model');
            console.log('成功載入先前的 AI 記憶！');
            
            // 讀取上次存檔的探索率 (讓它記得自己學到哪裡了)
            const savedRate = localStorage.getItem('carrom-ai-exploration');
            if (savedRate !== null) {
                this.explorationRate = parseFloat(savedRate);
            }
            
            document.getElementById('ml-status').innerText = `AI 記憶載入成功！目前探索率: ${Math.round(this.explorationRate * 100)}%`;
        } catch (e) {
            console.log('找不到舊記憶，建立全新 AI 大腦...');
            this.model = tf.sequential();
            
            // 輸入層：19 顆棋子 * 2 (x,y 座標) = 38 個特徵
            this.model.add(tf.layers.dense({ units: 64, inputShape: [38], activation: 'relu' }));
            this.model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
            
            // 輸出層：3 個數值 (strikerX, forceX, forceY)
            // 使用 tanh 讓輸出介於 -1 到 1 之間
            this.model.add(tf.layers.dense({ units: 3, activation: 'tanh' })); 
        }
        
        // 編譯神經網路
        this.model.compile({
            optimizer: tf.train.adam(0.01),
            loss: 'meanSquaredError'
        });

        this.isInitialized = true;
    }

    //🔥 新增：自動將記憶存入平板瀏覽器
    async save() {
        if (!this.isInitialized) return;
        await this.model.save('localstorage://carrom-ai-model');
        localStorage.setItem('carrom-ai-exploration', this.explorationRate.toString());
    }

    // 將物理盤面轉換成神經網路看得懂的 38 維陣列
    getStateArray() {
        const state = [];
        // 確保陣列順序永遠固定：9顆白棋、9顆黑棋、1顆皇后
        for (let id = 100; id <= 118; id++) {
            const puck = pucks.find(p => p.id === id);
            if (puck && puck.position.x !== -100) {
                // 正規化座標到 0~1 之間，方便神經網路吸收
                state.push(puck.position.x / WIDTH);
                state.push(puck.position.y / HEIGHT);
            } else {
                // 如果已經進洞，補 0
                state.push(0);
                state.push(0);
            }
        }
        return state;
    }

    // 進行預測或隨機探索
    predict(stateArray) {
        if (!this.isInitialized) return [0, 0, 0]; // 安全防護

        // 如果擲骰子小於探索率，就大膽隨機嘗試 (Exploration)
        if (Math.random() < this.explorationRate) {
            return [
                (Math.random() * 2) - 1, // strikerX 映射: -1 到 1
                (Math.random() * 2) - 1, // forceX 映射: -1 到 1
                (Math.random() * 2) - 1  // forceY 映射: -1 到 1
            ];
        }

        // 否則，依照神經網路目前的智慧進行推論 (Exploitation)
        return tf.tidy(() => {
            const inputTensor = tf.tensor2d([stateArray]);
            const prediction = this.model.predict(inputTensor);
            return prediction.dataSync();
        });
    }

    // 根據獎勵調整神經網路權重
    async train(stateArray, actionTaken, reward) {
        if (!this.isInitialized) return;

        // 建立一組期望的目標輸出。如果得到正獎勵，就更鼓勵這個動作；負獎勵則遠離
        const targetAction = actionTaken.map(a => {
            // 簡單的 Policy Gradient 近似概念
            let adjustment = a + (reward * 0.1 * a);
            return Math.max(-1, Math.min(1, adjustment)); // 限制在 -1 到 1
        });

        const xs = tf.tensor2d([stateArray]);
        const ys = tf.tensor2d([targetAction]);

        await this.model.fit(xs, ys, { epochs: 1, verbose: 0 });

        xs.dispose();
        ys.dispose();

        // 降低探索率，讓 AI 慢慢變得越來越確定
        if (this.explorationRate > this.minExploration) {
            this.explorationRate *= this.explorationDecay;
        }

        // 更新 UI 狀態
        document.getElementById('ml-status').innerText = `AI 探索率: ${Math.round(this.explorationRate * 100)}% (上次獎勵: ${reward})`;

        //🔥 每次訓練完畢後，強制自動存檔！
        await this.save();
    }
}

// 初始化神經網路大腦
const carromBrain = new CarromBrain();
carromBrain.init(); //🔥 程式啟動時立刻執行記憶載入

// 呼叫本機 AI 進行推論並執行
function requestLocalAIPrediction() {
    lastAIState = carromBrain.getStateArray();
    const rawAction = carromBrain.predict(lastAIState);
    lastAIAction = rawAction;

    // 將神經網路輸出的 [-1, 1] 解碼回遊戲物理世界的實際數值
    // strikerX: -1~1 對應到 120~480
    const aiX = 120 + ((rawAction[0] + 1) / 2) * (480 - 120); 
    // forceX: -1~1 對應到 -0.8 ~ 0.8
    const aiForceX = rawAction[1] * 0.8;
    // forceY: -1~1 對應到 0.01 ~ 0.8 (強制往下打)
    const aiForceY = 0.01 + ((rawAction[2] + 1) / 2) * 0.79;

    // 1. 移動打擊子到 AI 決定的 X 座標
    Body.setPosition(striker, { x: aiX, y: HEIGHT * 0.2 });
    Body.setVelocity(striker, { x: 0, y: 0 });

    const turnIndicator = document.getElementById('turn-indicator');
    if (turnIndicator) turnIndicator.innerText = "現在輪到：AI 神經網路 - 出桿！";

    // 2. 刻意延遲 0.5 秒再擊打，讓人類能看清楚
    setTimeout(() => {
        const forceVector = { x: aiForceX, y: aiForceY };
        Body.applyForce(striker, striker.position, forceVector);
        
        setTimeout(() => {
            turnActive = true;
        }, 50);
    }, 500);
}
