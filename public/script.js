const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnDisplay = document.getElementById('turn-display');
const actionDamageEl = document.getElementById('action-damage-text');
const blueDotsContainer = document.getElementById('blue-score-dots');
const redDotsContainer = document.getElementById('red-score-dots');

canvas.width = 800;
canvas.height = 600;

// 🔥 核心物理與效果參數
const FRICTION = 0.985; 
const WALL_BOUNCE = 0.8; 
const MIN_SPEED = 0.2; 
const LAUNCH_FORCE_MULT = 0.15; 
const MAX_DRAG = 150; 

// 🔥 豹種定義
const LEOPARD_TYPES = {
    balanced: { name: '全能豹', icon: '🐾', hp: 100, atk: 20, desc: '屬性均衡，適合新手。' },
    tank: { name: '重裝豹', icon: '🛡️', hp: 150, atk: 15, desc: '高生命力，極難被擊殺。' },
    assassin: { name: '刺客豹', icon: '🗡️', hp: 70, atk: 35, desc: '極高攻擊，但非常脆弱。' },
    support: { name: '戰吼豹', icon: '🔥', hp: 90, atk: 15, desc: '特殊能力：碰撞我方豹豹時，該隊友攻擊力 +5 (死後重置)。' },
    speedster: { name: '疾風豹', icon: '⚡', hp: 80, atk: 15, desc: '特殊能力：初始彈射速度增加 50%，且每次碰撞牆壁增加 10 點攻擊力 (回合結束重置)。' }
};

// 🔥 遊戲模式與連線變數
let gameMode = 'local'; 
let myTeam = 'blue';    
let socket = null;      

// 🔥 配置階段變數
let selectingTeam = 'blue'; 
let blueTeamConfig = [];
let redTeamConfig = [];

// 🔥 動態攝影機與時間參數
let camera = { x: 400, y: 300, zoom: 1, targetZoom: 1, targetX: 400, targetY: 300 };
let timeScale = 1.0;
let targetTimeScale = 1.0;
let isSlowMo = false;
let slowMoTimer = 0;

let leopards = [];
let damageTexts = []; 
let particles = []; 
let blueKills = 0;   
let redKills = 0;
let totalDamageDealt = 0;
let currentActionDamage = 0;
let currentActionHits = 0;
let currentTurn = 'blue'; 
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
let lastBlueKills = 0;
let lastRedKills = 0;
let isProcessing = false; 
let gameOver = false;

// 🔥 新增變數：追蹤輪數、先後手與目前的彈射者
let roundCount = 1;         // 目前總輪數
let firstTeam = 'blue';    // 本輪的先手隊伍
let activeStriker = null;  // 目前正在移動的主動彈射豹豹

const blueSpawns = [{x: 100, y: 150}, {x: 100, y: 300}, {x: 100, y: 450}];
const redSpawns = [{x: 700, y: 150}, {x: 700, y: 300}, {x: 700, y: 450}];

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 15;
        this.vy = (Math.random() - 0.5) * 15;
        this.life = 40 + Math.random() * 30;
        this.size = Math.random() * 8 + 2;
    }
    update() {
        this.x += this.vx * timeScale;
        this.y += this.vy * timeScale;
        this.vx *= 0.96;
        this.vy *= 0.96;
        this.life -= 1 * timeScale;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life / 70);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class DamageText {
    constructor(x, y, value, isSpecial = false) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.life = 80; 
        this.vy = -1.5; 
        this.scale = isSpecial ? 2 : 1;
        this.color = isSpecial ? '#ff3333' : '#ffcc00';
        if (typeof value === 'string') this.color = '#00ff00'; // 增益顏色
    }
    update() {
        this.y += this.vy * timeScale;
        this.life -= 1 * timeScale;
    }
    draw() {
        if (this.life <= 0) return;
        ctx.save();
        ctx.font = `bold ${24 * this.scale}px "Microsoft JhengHei"`;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'black';
        
        const bounce = Math.sin(this.life * 0.1) * 5;
        ctx.fillStyle = 'white';
        ctx.fillText(this.value, this.x, this.y + bounce);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.strokeText(this.value, this.x, this.y + bounce);
        ctx.restore();
    }
}

class Leopard {
    constructor(x, y, radius, color, team, id, typeKey) {
        // 增加安全回退機制，若 typeKey 無效則預設為 balanced
        const config = LEOPARD_TYPES[typeKey] || LEOPARD_TYPES['balanced']; 
        this.id = id;
        this.type = typeKey || 'balanced';
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.team = team;
        this.vx = 0;
        this.vy = 0;
        this.hp = config.hp;
        this.maxHp = config.hp;
        this.atk = config.atk;
        this.baseAtk = config.atk; // 🔥 記錄原始攻擊力，用於重置
        this.hasMoved = false; 
        this.isDying = false; 
        this.buffedThisTurn = false; // 用於防止同一回合重複獲得戰吼增益
    }

    draw() {
        if (this.isDying && !isSlowMo) return; 

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fill();
        
        if (!isProcessing && currentTurn === this.team && !this.hasMoved) {
            if (gameMode !== 'online' || currentTurn === myTeam) {
                ctx.strokeStyle = 'yellow';
                ctx.lineWidth = 5;
                ctx.stroke();
            } else {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        } else {
            ctx.strokeStyle = this.hasMoved ? '#444' : 'white';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        ctx.closePath();

        // 繪製豹種圖標
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '20px Arial';
        ctx.fillText(LEOPARD_TYPES[this.type].icon, this.x, this.y + 7);

        // 狀態欄
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`❤️${Math.max(0, Math.ceil(this.hp))}  🗡️${this.atk}`, this.x, this.y + this.radius + 25);
        ctx.restore();
    }

    update() {
        if (this.isDying) return;

        this.x += this.vx * timeScale;
        this.y += this.vy * timeScale;
        this.vx *= FRICTION;
        this.vy *= FRICTION;

        if (Math.abs(this.vx) < MIN_SPEED) this.vx = 0;
        if (Math.abs(this.vy) < MIN_SPEED) this.vy = 0;

        // 🔥 碰撞牆壁邏輯：疾風豹每次反彈增加攻擊力
        let hitWall = false;
        if (this.x - this.radius < 0 || this.x + this.radius > canvas.width) {
            this.vx = -this.vx * WALL_BOUNCE;
            this.x = this.x - this.radius < 0 ? this.radius : canvas.width - this.radius;
            hitWall = true;
        }
        if (this.y - this.radius < 0 || this.y + this.radius > canvas.height) {
            this.vy = -this.vy * WALL_BOUNCE;
            this.y = this.y - this.radius < 0 ? this.radius : canvas.height - this.radius;
            hitWall = true;
        }

        if (hitWall && this.type === 'speedster') {
            this.atk += 10;
            damageTexts.push(new DamageText(this.x, this.y - 40, "加速! ATK+5", true));
        }
    }

    die() {
        this.isDying = true;
        isSlowMo = true;
        slowMoTimer = 60; 
        targetTimeScale = 0.1; 
        camera.targetZoom = 2.5; 
        camera.targetX = this.x;
        camera.targetY = this.y;

        for (let i = 0; i < 30; i++) {
            particles.push(new Particle(this.x, this.y, this.color));
        }
        
        if (this.team === 'blue') redKills++;
        else blueKills++;
        
        updateExternalUI();
        checkWinCondition();
    }
}

// 🔥 修改 script.js：新增變數與房間函式
let currentRoomId = null;

// 入口修改
window.enterSelection = function(mode) {
    gameMode = mode;
    document.getElementById('menu-layer').style.display = 'none';
    document.getElementById('selection-layer').style.display = 'flex';
    
    if (mode === 'online') {
        document.getElementById('room-section').style.display = 'block';
        document.getElementById('leopard-selection-section').style.display = 'none';
        initOnlineMode();
    } else {
        // 單機模式直接顯示選擇豹豹
        document.getElementById('room-section').style.display = 'none';
        document.getElementById('leopard-selection-section').style.display = 'block';
        renderTypeSelection();
    }
};

function renderTypeSelection() {
    const list = document.getElementById('type-list');
    list.innerHTML = '';
    
    for (let key in LEOPARD_TYPES) {
        const type = LEOPARD_TYPES[key];
        const card = document.createElement('div');
        card.className = 'type-card';
        card.onclick = () => selectType(key);
        card.innerHTML = `
            <div class="type-icon">${type.icon}</div>
            <span class="type-name">${type.name}</span>
            <div class="type-stats">HP: ${type.hp} | ATK: ${type.atk}</div>
            <div style="font-size:12px; color:#888; margin-top:5px;">${type.desc}</div>
        `;
        list.appendChild(card);
    }
}


function renderMySelection() {
    let team = (gameMode === 'online') ? myTeam : selectingTeam;
    let config = (team === 'blue') ? blueTeamConfig : redTeamConfig;
    const preview = document.getElementById('current-selection');
    
    preview.innerHTML = config.map(key => `
        <div class="dot ${team}-fill" style="width:35px; height:35px; display:flex; align-items:center; justify-content:center; font-size:16px; border:2px solid gold;">
            ${LEOPARD_TYPES[key].icon}
        </div>
    `).join('');
    
    document.getElementById('confirm-selection-btn').disabled = config.length < 3;
}


// 🔥 更新：重選功能 (全模式適用)
function resetSelection() {
    if (gameMode === 'online') {
        if (myTeam === 'blue') blueTeamConfig = [];
        else redTeamConfig = [];
        // 同步清空給對手
        socket.emit('updateSelection', { roomId: currentRoomId, config: [] });
    } else {
        if (selectingTeam === 'blue') blueTeamConfig = [];
        else redTeamConfig = [];
    }
    renderSelectionUI();
    document.getElementById('confirm-selection-btn').disabled = true;
    document.getElementById('confirm-selection-btn').innerText = "準備就緒";
}

// 🔥 修改 selectType：加入同步邏輯
function selectType(key) {
    let team = (gameMode === 'online') ? myTeam : selectingTeam;
    let config = (team === 'blue') ? blueTeamConfig : redTeamConfig;
    
    if (config.length < 3) {
        config.push(key);
        renderSelectionUI();
        
        if (gameMode === 'online') {
            socket.emit('updateSelection', { roomId: currentRoomId, config: config });
        }
    }
}

// 渲染自己的選擇
function renderSelectionUI() {
    let team = (gameMode === 'online') ? myTeam : selectingTeam;
    let config = (team === 'blue') ? blueTeamConfig : redTeamConfig;
    const preview = document.getElementById('current-selection');
    
    preview.innerHTML = config.map(key => `
        <div class="dot ${team}-fill" style="width:35px; height:35px; display:flex; align-items:center; justify-content:center; font-size:16px; border:1.5px solid gold;">
            ${LEOPARD_TYPES[key].icon}
        </div>
    `).join('');
    
    document.getElementById('confirm-selection-btn').disabled = config.length < 3;
}


// 🔥 為了連線模式微調的預覽函式
function updateSelectionPreviewForOnline(targetTeam) {
    const preview = document.getElementById('current-selection');
    const btn = document.getElementById('confirm-selection-btn');
    let currentConfig = (targetTeam === 'blue') ? blueTeamConfig : redTeamConfig;
    
    preview.innerHTML = currentConfig.map(key => `<div class="dot ${targetTeam}-fill" style="width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:14px;">${LEOPARD_TYPES[key].icon}</div>`).join('');
    
    btn.disabled = currentConfig.length < 3;
}

function updateSelectionPreview() {
    const preview = document.getElementById('current-selection');
    const btn = document.getElementById('confirm-selection-btn');
    let currentConfig = (selectingTeam === 'blue') ? blueTeamConfig : redTeamConfig;
    
    preview.innerHTML = currentConfig.map(key => `<div class="dot ${selectingTeam}-fill" style="width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:14px;">${LEOPARD_TYPES[key].icon}</div>`).join('');
    
    btn.disabled = currentConfig.length < 3;
}

// 🔥 修正後的 confirmSelection
function confirmSelection() {
    // 關鍵修正：連線模式應看 myTeam，非連線模式看 selectingTeam
    let team = (gameMode === 'online') ? myTeam : selectingTeam;
    let currentConfig = (team === 'blue') ? blueTeamConfig : redTeamConfig;
    
    if (gameMode === 'online') {
        if (currentConfig.length < 3) return; // 安全檢查
        document.getElementById('confirm-selection-btn').disabled = true;
        document.getElementById('confirm-selection-btn').innerText = "等待對手中...";
        socket.emit('confirmSelection', { roomId: currentRoomId, team: myTeam, config: currentConfig });
        return;
    }

    // 原有的單機/區域模式邏輯
    if (gameMode === 'local' && selectingTeam === 'blue') {
        selectingTeam = 'red';
        document.getElementById('selection-title').innerText = '紅隊 配置隊伍';
        updateSelectionPreview();
        return;
    }
    
    if (gameMode === 'single') {
        const keys = Object.keys(LEOPARD_TYPES);
        redTeamConfig = [keys[Math.floor(Math.random()*keys.length)], keys[Math.floor(Math.random()*keys.length)], keys[Math.floor(Math.random()*keys.length)]];
    }

    startGame();
}

// 🔥 修改 script.js 中的 startGame 函式
function startGame() {
    // 這個函式現在只處理單人或本機模式的切換
    // 連線模式由 allPlayersReady 事件觸發
    if (gameMode !== 'online') {
        document.getElementById('selection-layer').style.display = 'none';
        document.getElementById('game-layer').style.display = 'flex';
        initGame();
        updateExternalUI();
        updateTurnDisplay();
    }
}

// 🔥 修改後的 resolveCollisions 區段
function resolveCollisions() {
    for (let i = 0; i < leopards.length; i++) {
        for (let j = i + 1; j < leopards.length; j++) {
            let b1 = leopards[i];
            let b2 = leopards[j];
            if (b1.isDying || b2.isDying) continue;

            let dx = b2.x - b1.x;
            let dy = b2.y - b1.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < b1.radius + b2.radius) {
                // 判斷是否為 Host 或單機模式，負責處理增傷判定
                const canProcessDamage = (gameMode !== 'online') || (gameMode === 'online' && myTeam === 'blue');

                // 🔥 疾風豹新能力：碰撞到任何豹豹（隊友或敵人）都增加攻擊力
                if (canProcessDamage) {
                    [b1, b2].forEach(leopard => {
                        if (leopard.type === 'speedster') {
                            leopard.atk += 10; // 每次碰撞增加 10 點攻擊
                            damageTexts.push(new DamageText(leopard.x, leopard.y - 40, "加速! ATK+10", true));
                            
                            // 連線同步：發送 midMoveSync 給對手
                            if (gameMode === 'online') {
                                socket.emit('midMoveSync', { 
                                    roomId: currentRoomId, 
                                    id: leopard.id, 
                                    type: 'buff', 
                                    value: leopard.atk 
                                });
                            }
                        }
                    });
                }

                // 戰吼豹邏輯 (原有的隊友碰撞增強)
                if (b1.team === b2.team) {
                    if (activeStriker === b1 || activeStriker === b2) {
                        let striker = (activeStriker === b1) ? b1 : b2;
                        let target = (striker === b1) ? b2 : b1;
                        if (striker.type === 'support' && canProcessDamage) {
                            target.atk += 5;
                            damageTexts.push(new DamageText(target.x, target.y - 40, "戰吼! ATK+5", true));
                            if (gameMode === 'online') {
                                socket.emit('midMoveSync', { roomId: currentRoomId, id: target.id, type: 'buff', value: target.atk });
                            }
                        }
                    }
                } else {
                    // 對手碰撞邏輯 (計算傷害與死亡)
                    let relVx = b1.vx - b2.vx;
                    let relVy = b1.vy - b2.vy;
                    let dotProduct = relVx * dx + relVy * dy;

                    if (dotProduct > 0 && canProcessDamage) {
                        let attacker = (b1.team === currentTurn) ? b1 : b2;
                        let victim = (attacker === b1) ? b2 : b1;
                        
                        victim.hp -= attacker.atk;
                        totalDamageDealt += attacker.atk;
                        currentActionDamage += attacker.atk;
                        currentActionHits++; // 🔥 每次造成傷害就計數一次
                        
                        damageTexts.push(new DamageText(victim.x, victim.y - 40, attacker.atk, victim.hp <= 0));
                        
                        if (gameMode === 'online') {
                            socket.emit('midMoveSync', { 
                                roomId: currentRoomId, 
                                id: victim.id, 
                                type: 'damage', 
                                damage: attacker.atk,
                                hp: victim.hp 
                            });
                        }

                        if (victim.hp <= 0) {
                            victim.die();
                            if (gameMode === 'online') {
                                socket.emit('midMoveSync', { roomId: currentRoomId, id: victim.id, type: 'death' });
                            }
                        }
                        updateExternalUI();
                    }
                }

                let collisionAngle = Math.atan2(dy, dx);
                let speed1 = Math.sqrt(b1.vx * b1.vx + b1.vy * b1.vy);
                let speed2 = Math.sqrt(b2.vx * b2.vx + b2.vy * b2.vy);
                let direction1 = Math.atan2(b1.vy, b1.vx);
                let direction2 = Math.atan2(b2.vy, b2.vx);

                let vx1 = speed1 * Math.cos(direction1 - collisionAngle);
                let vy1 = speed1 * Math.sin(direction1 - collisionAngle);
                let vx2 = speed2 * Math.cos(direction2 - collisionAngle);
                let vy2 = speed2 * Math.sin(direction2 - collisionAngle);

                b1.vx = Math.cos(collisionAngle) * vx2 + Math.cos(collisionAngle + Math.PI / 2) * vy1;
                b1.vy = Math.sin(collisionAngle) * vx2 + Math.sin(collisionAngle + Math.PI / 2) * vy1;
                b2.vx = Math.cos(collisionAngle) * vx1 + Math.cos(collisionAngle + Math.PI / 2) * vy2;
                b2.vy = Math.sin(collisionAngle) * vx1 + Math.sin(collisionAngle + Math.PI / 2) * vy2;

                let overlap = b1.radius + b2.radius - distance;
                b1.x -= Math.cos(collisionAngle) * (overlap / 2);
                b1.y -= Math.sin(collisionAngle) * (overlap / 2);
                b2.x += Math.cos(collisionAngle) * (overlap / 2);
                b2.y += Math.sin(collisionAngle) * (overlap / 2);
            }
        }
    }
}

function checkTurnSystem() {
    if (gameOver) return;
    const movingLeopards = leopards.filter(l => !l.isDying && (Math.abs(l.vx) > 0.05 || Math.abs(l.vy) > 0.05));
    const canCurrentTeamMove = leopards.some(l => l.team === currentTurn && !l.hasMoved && !l.isDying);
    
    if (!isProcessing && !isSlowMo && !canCurrentTeamMove) {
        isProcessing = true;
    }

    if (isProcessing && movingLeopards.length === 0 && !isSlowMo) {
        // 🔥 關鍵邏輯：如果剛才是手動示範，且「真的有打到球」
        if (isTraining && isManualDemo && pendingMemory) {
            if (currentActionHits > 0) {
                userMemories.push(pendingMemory);
                const memBtn = document.getElementById('learn-memory-btn');
                memBtn.style.display = 'inline-block';
                memBtn.innerText = `🧠 學習紀錄 (${userMemories.length})`;
                showBigAnnouncement("成功擊中！已存入紀錄", "gold");
            } else {
                showBigAnnouncement("揮空，不予紀錄", "#888");
            }
            pendingMemory = null;
        }

        const wasMyTurn = (gameMode === 'online' && activeStriker && activeStriker.team === myTeam);
        isProcessing = false;

        // 1. 處理重生與增益清理
        leopards.forEach(l => { 
            l.buffedThisTurn = false;
            if (l.isDying) respawnLeopard(l); 
        });

        // 2. 切換回合邏輯：直到找到一個有豹豹可以動的隊伍
        let turnSwitched = false;
        let attempt = 0;
        while (!turnSwitched && attempt < 5) { // 增加安全計數防止死循環
            attempt++;
            const otherTeam = currentTurn === 'blue' ? 'red' : 'blue';
            const otherCanMove = leopards.some(l => l.team === otherTeam && !l.hasMoved);

            if (otherCanMove) {
                currentTurn = otherTeam;
                turnSwitched = true;
            } else {
                const currentCanMove = leopards.some(l => l.team === currentTurn && !l.hasMoved);
                if (!currentCanMove) {
                    roundCount++;
                    leopards.forEach(l => { if (l.type === 'speedster') l.atk = l.baseAtk; });
                    firstTeam = (roundCount % 2 === 1) ? 'blue' : 'red';
                    currentTurn = firstTeam;
                    leopards.forEach(l => l.hasMoved = false);
                    turnSwitched = true; 
                } else {
                    turnSwitched = true; 
                }
            }
        }

        const teamColor = currentTurn === 'blue' ? '#3498db' : '#e74c3c';
        const teamName = currentTurn === 'blue' ? '藍隊' : '紅隊';
        const statusText = currentTurn === firstTeam ? '先手' : '後手';
        showBigAnnouncement(`${teamName} 行動\n(${statusText})`, teamColor);

        if (wasMyTurn && gameMode === 'online') {
            socket.emit('syncState', {
                roomId: currentRoomId, 
                leopards: leopards.map(l => ({ id: l.id, x: l.x, y: l.y, hp: l.hp, atk: l.atk, isDying: l.isDying, hasMoved: l.hasMoved })),
                blueKills, redKills, totalDamage: totalDamageDealt, round: roundCount, firstTeam: firstTeam, nextTurn: currentTurn
            });
        }

        activeStriker = null;
        if (gameMode === 'single' && currentTurn === 'red' && !isTraining) {
            setTimeout(makeAIMove, 1000);
        }

        actionDamageEl.style.opacity = '0';
        currentActionDamage = 0;
        updateTurnDisplay();
    }
}

function initGame() {
    initScoreDots();
    leopards = [
        new Leopard(150, 150, 25, '#3498db', 'blue', 1, blueTeamConfig[0]),
        new Leopard(240, 300, 25, '#3498db', 'blue', 2, blueTeamConfig[1]), 
        new Leopard(150, 450, 25, '#3498db', 'blue', 3, blueTeamConfig[2]),
        new Leopard(650, 150, 25, '#e74c3c', 'red', 4, redTeamConfig[0]),
        new Leopard(560, 300, 25, '#e74c3c', 'red', 5, redTeamConfig[1]), 
        new Leopard(650, 450, 25, '#e74c3c', 'red', 6, redTeamConfig[2])
    ];
}

function respawnLeopard(leopard) {
    const points = leopard.team === 'blue' ? blueSpawns : redSpawns;
    const enemies = leopards.filter(l => l.team !== leopard.team && !l.isDying);
    
    let bestPoint = points[0];
    let maxMinDist = -1;

    points.forEach(p => {
        let minDistToEnemy = Infinity;
        enemies.forEach(e => {
            let d = Math.sqrt((p.x - e.x)**2 + (p.y - e.y)**2);
            if (d < minDistToEnemy) minDistToEnemy = d;
        });
        if (minDistToEnemy > maxMinDist) {
            maxMinDist = minDistToEnemy;
            bestPoint = p;
        }
    });

    leopard.x = bestPoint.x;
    leopard.y = bestPoint.y;
    leopard.vx = 0;
    leopard.vy = 0;
    leopard.hp = leopard.maxHp;
    // 🔥 修改：死後重置攻擊力 (包含戰吼豹的增傷)
    leopard.atk = leopard.baseAtk; 
    leopard.isDying = false;
}

// 房間操作函式
function createRoom() { socket.emit('createRoom'); }
function joinRoom() {
    const id = document.getElementById('room-input').value;
    if (id) socket.emit('joinRoom', id);
}

// 🔥 核心邏輯：統一處理進入房間後的 UI 切換
function handleEnterRoom(data) {
    currentRoomId = data.roomId;
    myTeam = data.team;
    
    // 隱藏房間列表，顯示豹豹選擇區
    document.getElementById('room-section').style.display = 'none';
    document.getElementById('leopard-selection-section').style.display = 'block';
    
    // 更新標題隊伍顏色
    const titleEl = document.getElementById('selection-title');
    titleEl.innerText = (myTeam === 'blue') ? '藍隊 配置隊伍' : '紅隊 配置隊伍';
    titleEl.style.color = (myTeam === 'blue') ? '#3498db' : '#e74c3c';
    
    renderTypeSelection();
    renderSelectionUI();
}

function initOnlineMode() {
    if (socket) return;
    socket = io();
    socket.emit('getRooms');

    // 🔥 核心修復：監聽伺服器廣播的房間列表，並動態生成「加入房間」按鈕
    socket.on('roomListUpdate', (rooms) => {
        const container = document.getElementById('room-list-container');
        if (!container) return;
        
        if (rooms.length === 0) {
            container.innerHTML = '<p style="color: #666; padding: 20px;">目前沒有開放中的房間</p>';
            return;
        }

        container.innerHTML = rooms.map(room => `
            <div class="room-item">
                <div class="room-info">
                    <span class="room-name">${room.name}</span>
                    <span class="room-players">人數: ${room.playerCount}/2</span>
                </div>
                <button class="join-btn" onclick="socket.emit('joinRoom', '${room.id}')" ${room.playerCount >= 2 ? 'disabled' : ''}>
                    ${room.playerCount >= 2 ? '已滿' : '加入房間'}
                </button>
            </div>
        `).join('');
    });

    // 🔥 核心修復：監聽建立房間成功的訊息
    socket.on('roomCreated', (data) => {
        handleEnterRoom(data);
        showBigAnnouncement("房間已建立", "#4ecca3");
    });

    socket.on('opponentSelectionUpdate', (data) => {
        const preview = document.getElementById('opponent-selection-preview');
        const oppTeam = (myTeam === 'blue') ? 'red' : 'blue';
        preview.innerHTML = data.config.map(key => `
            <div class="dot ${oppTeam}-fill" style="width:35px; height:35px; display:flex; align-items:center; justify-content:center; font-size:16px;">
                ${LEOPARD_TYPES[key].icon}
            </div>
        `).join('');
    });

    socket.on('roomJoined', (data) => {
        handleEnterRoom(data);
        document.getElementById('opponent-status-hint').innerText = "對手已加入";
        // 如果對方已經選了，立刻同步過來
        if (data.opponentConfig) {
            socket.emit('opponentSelectionUpdate', { config: data.opponentConfig });
        }
    });

    socket.on('opponentJoined', () => {
        document.getElementById('opponent-status-hint').innerText = "對手已加入";
        showBigAnnouncement("對手已加入", "#3498db");
    });

    socket.on('opponentLeft', () => {
        showBigAnnouncement("對手逃跑了...", "#ff4444");
        setTimeout(() => location.reload(), 2000);
    });
    
    socket.on('errorMsg', (msg) => alert(msg));
    
    socket.on('opponentReady', () => {
        showBigAnnouncement("對手已就緒", "#4ecca3");
    });

    socket.on('allPlayersReady', (data) => {
        blueTeamConfig = data.blueConfig;
        redTeamConfig = data.redConfig;
        showBigAnnouncement("戰鬥開始！", "gold");
        setTimeout(() => {
            document.getElementById('selection-layer').style.display = 'none';
            document.getElementById('game-layer').style.display = 'flex';
            initGame();
            updateExternalUI();
            updateTurnDisplay();
        }, 1500);
    });

    socket.on('opponentMove', (data) => {
        const leopard = leopards.find(l => l.id === data.id);
        if (leopard) {
            activeStriker = leopard;
            leopard.vx = data.vx; leopard.vy = data.vy;
            leopard.hasMoved = true; isProcessing = true;
        }
    });

    // 在 initOnlineMode 內加入監聽
    socket.on('updateMidMove', (data) => {
        const leopard = leopards.find(l => l.id === data.id);
        if (!leopard) return;
    
        if (data.type === 'damage') {
            leopard.hp = data.hp;
            damageTexts.push(new DamageText(leopard.x, leopard.y - 40, data.damage, leopard.hp <= 0));
        } else if (data.type === 'death') {
            if (!leopard.isDying) leopard.die();
        } else if (data.type === 'buff') {
            leopard.atk = data.value;
            damageTexts.push(new DamageText(leopard.x, leopard.y - 40, "戰吼! ATK+5", true));
        }
    });

    socket.on('updateClientState', (data) => {
        data.leopards.forEach(remoteL => {
            const localL = leopards.find(l => l.id === remoteL.id);
            if (localL) {
                localL.x = remoteL.x; 
                localL.y = remoteL.y;
                localL.hp = remoteL.hp; 
                localL.atk = remoteL.atk;
                localL.vx = 0; // 強制歸零速度
                localL.vy = 0;
                localL.isDying = remoteL.isDying;
                localL.hasMoved = remoteL.hasMoved;
            }
        });
    
        // 🔥 關鍵修正：強制重置所有流程旗標，確保 UI 解鎖
        isProcessing = false;   // 解除「處理中」狀態
        activeStriker = null;  // 清空發動者
        isSlowMo = false;      // 強制關閉慢動作
        slowMoTimer = 0;       // 重置計時器
        targetTimeScale = 1.0; // 回復正常時間流速
        timeScale = 1.0;
        
        // 重置畫面中央的傷害文字 UI
        actionDamageEl.style.opacity = '0';
        currentActionDamage = 0;
    
        blueKills = data.blueKills; 
        redKills = data.redKills;
        totalDamageDealt = data.totalDamage; 
        roundCount = data.round;
        firstTeam = data.firstTeam; 
        currentTurn = data.nextTurn;
    
        updateExternalUI(); 
        updateTurnDisplay();
    });
}

function quitRoom() {
    location.reload(); // 最快的方式是重整，確保狀態乾淨
}

// 🔥 AI 訓練相關變數
let isTraining = false;
let trainRender = true;
let aiModel = null;
let curriculumLevel = 1; // 1: 打死固定目標, 2: 打死隨機目標, 3: 對戰弱 AI, 4: 完全體對戰
let trainStats = { episodes: 0, wins: 0, rewards: [] };
let trainingSpeed = 1;
// 🔥 訓練模式與高手紀錄變數 (補上這些宣告)
let isManualDemo = false;      // 是否開啟手動示範
let userMemories = [];         // 存放成功擊中的操作紀錄
let pendingMemory = null;      // 暫存目前的動作，等物理跑完判定

// 🔥 新增：讓 AI 學習剛剛錄製的高手動作
async function trainFromUserMemories() {
    if (userMemories.length === 0) return;
    
    isManualDemo = false;
    document.getElementById('manual-demo-btn').innerText = "🎮 開啟手動示範";
    document.getElementById('manual-demo-btn').style.background = "#4ecca3";
    
    showBigAnnouncement(`正在學習 ${userMemories.length} 筆高手紀錄...`, "#3498db");

    // 將記憶轉換為 Tensor 進行批次訓練
    const states = tf.tensor2d(userMemories.map(m => m.state));
    const actions = tf.tensor2d(userMemories.map(m => m.action));

    // 🚀 改進 3：大幅增加高手紀錄的訓練次數
    // 讓 AI 針對你的示範「深思熟慮」50 次，而不是原本的 10 次
    await aiModel.fit(states, actions, {
        epochs: 50, 
        shuffle: true,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (epoch % 10 === 0) console.log(`特訓中... 第 ${epoch} 回合`);
            }
        }
    });

    states.dispose();
    actions.dispose();
    
    showBigAnnouncement("特訓完成！AI 已吸收你的風格", "gold");
    userMemories = []; // 清空，避免重複訓練
    document.getElementById('learn-memory-btn').style.display = 'none';
}

// 🔥 新增：切換手動示範
function toggleManualDemo() {
    isManualDemo = !isManualDemo;
    const btn = document.getElementById('manual-demo-btn');
    btn.innerText = isManualDemo ? "🚀 示範錄製中..." : "🎮 開啟手動示範";
    btn.style.background = isManualDemo ? "#ff4444" : "#4ecca3";
    btn.style.color = isManualDemo ? "white" : "#1a1a2e";
    
    if (isManualDemo) {
        showBigAnnouncement("手動模式：請親自下場彈射", "#4ecca3");
    }
}

function updateSpeedDisplay(val) {
    trainingSpeed = parseInt(val);
    document.getElementById('speed-val').innerText = val + 'x';
}

async function initPPO() {
    try {
        try {
            aiModel = await tf.loadLayersModel('localstorage://leopard-ppo-model');
        } catch (e) {
            aiModel = await tf.loadLayersModel('./model/leopard-ppo-model.json');
        }
    } catch (e) {
        console.log("建立新的 AI 神經網路 (維度: 48)...");
        // 🔥 修正：這裡的 shape 必須與 getGameStateTensor 的 48 維一致
        const input = tf.input({shape: [48]}); 
        let l1 = tf.layers.dense({units: 128, activation: 'relu'}).apply(input);
        let l2 = tf.layers.dense({units: 128, activation: 'relu'}).apply(l1);
        
        const output = tf.layers.dense({units: 3, activation: 'tanh'}).apply(l2);
        aiModel = tf.model({inputs: input, outputs: output});
        aiModel.compile({optimizer: tf.train.adam(0.0005), loss: 'meanSquaredError'});
    }
}

function getGameStateTensor() {
    let state = [];
    const myLeopard = leopards.find(l => l.team === 'red' && !l.isDying) || leopards[0];
    
    leopards.forEach(l => {
        // 1. 座標與 HP 基礎資訊
        state.push(l.x / 800, l.y / 600, l.hp / 150, l.team === 'red' ? 1 : 0);
        
        // 🔥 2. 加入相對位置資訊 (幫助神經網路快速理解空間關係)
        state.push((l.x - myLeopard.x) / 800);
        state.push((l.y - myLeopard.y) / 600);
    });
    
    // 確保維度固定，若豹豹不足則補零
    while(state.length < 48) state.push(0); // 增加維度到 48
    return tf.tensor2d([state]);
}

// 🔥 物理引擎加速執行函式
function runPhysicsSteps(count) {
    for (let i = 0; i < count; i++) {
        leopards.forEach(l => l.update());
        resolveCollisions();
        checkTurnSystem();
    }
}

// 1. 修正 makeAIMove 增加 async
async function makeAIMove() {
    if (gameOver || isProcessing) return;
    
    // 如果有訓練好的模型且是單人模式，優先使用模型
    if (aiModel && gameMode === 'single') {
        const state = getGameStateTensor();
        const prediction = aiModel.predict(state);
        const action = await prediction.data();
        
        await performAIAction(action); // 使用統一的動作執行函式
        
        state.dispose();
        prediction.dispose();
        return;
    }

    // 原有的隨機 AI 邏輯
    const aiLeopards = leopards.filter(l => l.team === 'red' && !l.hasMoved && !l.isDying);
    if (aiLeopards.length === 0) return;
    const attacker = aiLeopards[Math.floor(Math.random() * aiLeopards.length)];
    const enemies = leopards.filter(l => l.team === 'blue' && !l.isDying);
    if (enemies.length === 0) return;

    let closestEnemy = enemies[0];
    let minDist = Infinity;
    enemies.forEach(e => {
        const d = Math.sqrt((e.x - attacker.x)**2 + (e.y - attacker.y)**2);
        if (d < minDist) { minDist = d; closestEnemy = e; }
    });
    const dx = closestEnemy.x - attacker.x;
    const dy = closestEnemy.y - attacker.y;
    const angle = Math.atan2(dy, dx);
    const force = Math.min(minDist * 0.4, MAX_DRAG);
    attacker.vx = Math.cos(angle) * force * LAUNCH_FORCE_MULT;
    attacker.vy = Math.sin(angle) * force * LAUNCH_FORCE_MULT;
    attacker.hasMoved = true; 
    isProcessing = true;
}

async function performAIAction(action) {
    // 🔥 修正：必須從 action 陣列中解構出數值
    const [targetIdx, angleNorm, forceNorm] = action;

    const myLeopards = leopards.filter(l => l.team === 'red' && !l.hasMoved && !l.isDying);
    if (myLeopards.length === 0) {
        isProcessing = true; 
        return;
    }

    // 現在 targetIdx 已經定義，可以正常運算
    const attacker = myLeopards[Math.floor(Math.abs(targetIdx) * myLeopards.length) % myLeopards.length];
    
    const angle = angleNorm * Math.PI; 
    const force = (forceNorm + 1) * 0.5 * MAX_DRAG; 

    activeStriker = attacker;
    currentActionHits = 0;
    currentActionDamage = 0;
    attacker.vx = Math.cos(angle) * force * LAUNCH_FORCE_MULT;
    attacker.vy = Math.sin(angle) * force * LAUNCH_FORCE_MULT;
    attacker.hasMoved = true;
    isProcessing = true;
}

function makeRandomPlayerMove() {
    if (gameOver || isProcessing) return;
    const pLeopards = leopards.filter(l => l.team === 'blue' && !l.hasMoved && !l.isDying);
    if (pLeopards.length === 0) return;

    const attacker = pLeopards[Math.floor(Math.random() * pLeopards.length)];
    const angle = Math.random() * Math.PI * 2;
    const force = 40 + Math.random() * 80;

    currentActionHits = 0; // 🔥 重置計數
    attacker.vx = Math.cos(angle) * force * LAUNCH_FORCE_MULT;
    attacker.vy = Math.sin(angle) * force * LAUNCH_FORCE_MULT;
    attacker.hasMoved = true;
    isProcessing = true;
}

// 🔥 修改 calculateReward (約第 592 行)
function calculateReward() {
    let r = 0;
    
    if (curriculumLevel === 1) {
        // 第一階段：純粹以「打到」為目標
        if (currentActionHits > 0) {
            // 基本獎勵 + (碰撞次數的平方)
            r += (currentActionHits * 5.0) + Math.pow(currentActionHits, 2) * 2; 
        } else {
            // 🔥 沒打中時扣分，強制 AI 必須去尋找目標
            r -= 2.5; 
        }
        
        // 🔥 已刪除：原本的「在場內加分 (r += 0.1)」，避免 AI 為了領補助金而偷懶不動
    }
    else if (curriculumLevel === 2) {
        // 第二階段：撞牆加成 (Level 2 依然保留，因為這階段需要練習走位)
        if (activeStriker && activeStriker.type === 'speedster' && currentActionDamage > 0) {
            let wallBounceCount = (activeStriker.atk - activeStriker.baseAtk) / 10;
            r += (wallBounceCount > 0) ? (2.0 + wallBounceCount * 1.0) : 0.5;
        } else if (currentActionDamage === 0) {
            r -= 1.0;
        }
    } 

    else if (curriculumLevel === 3) {
        // 第三階段：英雄協作
        leopards.filter(l => l.team === 'red').forEach(l => {
            if (l.atk > l.baseAtk && l.type !== 'speedster') r += 2.0;
        });
        if (blueKills > lastBlueKills) r += 5.0;
        let assassin = leopards.find(l => l.type === 'assassin' && l.team === 'red');
        if (!assassin || assassin.isDying) r -= 5.0; // 加重刺客死亡懲罰
    } 
    else {
        // 第四階段：實戰
        r += (currentActionDamage / 5);
        if (blueKills > lastBlueKills) r += 15;
        if (redKills > lastRedKills) r -= 10;
        if (blueKills >= 5) r += 100;
    }

    lastBlueKills = blueKills;
    lastRedKills = redKills;
    return r;
}

// 6. 在進入選單時就嘗試讀取模型，讓單人模式生效
const originalEnterSelection = window.enterSelection;
window.enterSelection = async function(mode) {
    if (mode === 'single' && !aiModel) {
        await initPPO();
    }
    originalEnterSelection(mode);
};

let epsilon = 0.3;

async function startTraining() {
    isTraining = true;
    if (!aiModel) await initPPO();

    document.getElementById('menu-layer').style.display = 'none';
    document.getElementById('game-layer').style.display = 'flex';
    document.getElementById('training-status-bar').style.display = 'block';

    while (isTraining) {
        resetGameForTraining(curriculumLevel);
        while (!gameOver && isTraining) {
            if (isProcessing) { await new Promise(r => setTimeout(r, 30)); continue; }
        
            if (currentTurn === 'red') {
                if (isManualDemo) { await new Promise(r => setTimeout(r, 100)); continue; }

                const state = getGameStateTensor();
                let action;
                
                if (Math.random() < epsilon) {
                    action = [Math.random(), (Math.random() * 2 - 1), (Math.random() * 2 - 1)];
                } else {
                    const prediction = aiModel.predict(state);
                    action = await prediction.data();
                    prediction.dispose();
                }
                
                await performAIAction(action);
                
                let reward = calculateReward();
                if (reward > 0) {
                    const target = tf.tensor2d([action]);
                    await aiModel.fit(state, target, {epochs: 1, verbose: 0});
                    target.dispose();
                }
                state.dispose();
            } else {
                // 🔥 修正：如果等級是 1，讓藍隊直接結束回合而不移動
                if (curriculumLevel === 1) {
                    leopards.filter(l => l.team === 'blue').forEach(l => l.hasMoved = true);
                } else {
                    makeRandomPlayerMove();
                }
            }

            if (document.getElementById('render-toggle').checked) {
                await tf.nextFrame();
            } else {
                await new Promise(r => setTimeout(r, 1));
            }
        }
        
        epsilon = Math.max(0.05, epsilon * 0.998); 
        trainStats.episodes++;
        updateTrainingUI();
    }
}

function resetGameForTraining(level) {
    gameOver = false;
    blueKills = 0; redKills = 0;
    lastBlueKills = 0; lastRedKills = 0;
    roundCount = 1; currentTurn = 'red';
    isProcessing = false;
    
    isSlowMo = false;
    timeScale = 1.0;
    targetTimeScale = 1.0;
    slowMoTimer = 0;
    camera.targetZoom = 1.0;
    camera.targetX = 400;
    camera.targetY = 300;
    camera.zoom = 1.0;
    camera.x = 400;
    camera.y = 300;

    particles = [];
    damageTexts = [];
    document.getElementById('result-layer').style.display = 'none';
    document.getElementById('result-layer').classList.remove('show');
    
    leopards = [];

    if (level === 1) {
        leopards.push(new Leopard(400, 500, 25, '#e74c3c', 'red', 1, 'balanced'));
        // 🔥 對手大小改回 25，與 AI 保持一致
        let target = new Leopard(400, 200, 25, '#3498db', 'blue', 2, 'tank'); 
        target.hp = 999; target.maxHp = 999;
        leopards.push(target);
    }
    else if (level === 2) {
        // 第二階段：1隻疾風豹 (加強牆壁反彈練習)
        leopards.push(new Leopard(150, 500, 25, '#e74c3c', 'red', 1, 'speedster'));
        leopards.push(new Leopard(650, 150, 25, '#3498db', 'blue', 2, 'balanced'));
    } 
    else if (level === 3) {
        // 第三階段：戰吼豹 + 刺客豹 (隊友協作練習)
        leopards.push(new Leopard(300, 500, 25, '#e74c3c', 'red', 1, 'support'));
        leopards.push(new Leopard(500, 500, 25, '#e74c3c', 'red', 2, 'assassin'));
        // 敵人放兩隻普通的
        leopards.push(new Leopard(400, 150, 25, '#3498db', 'blue', 3, 'balanced'));
        leopards.push(new Leopard(600, 200, 25, '#3498db', 'blue', 4, 'balanced'));
    } 
    else {
        // 第四階段：完整 3v3 實戰
        blueTeamConfig = ['balanced', 'tank', 'assassin'];
        redTeamConfig = ['support', 'speedster', 'assassin'];
        initGame(); // 使用原本的 3v3 初始化邏輯
    }
    
    updateExternalUI(); // 更新介面點點
}

// 🔥 修改 saveAIModel：同時儲存到瀏覽器並下載檔案以便上傳 GitHub
async function saveAIModel() {
    if (!aiModel) {
        alert("模型尚未訓練，無法下載！");
        return;
    }
    
    // 1. 儲存在瀏覽器 LocalStorage，讓你在本地重新整理後依然可以使用
    await aiModel.save('localstorage://leopard-ppo-model');
    
    // 2. 觸發瀏覽器下載 AI 檔案 (會產生 model.json 與 .bin 檔案)
    // 下載後請將這些檔案上傳到 GitHub，並放置於 public/model/ 路徑下
    await aiModel.save('downloads://leopard-ppo-model');
    
    alert("匯出成功！檔案已開始下載。\n請將下載的檔案放入 GitHub 專案的 public/model 檔案夾中。");
}

function toggleTrainingUI() {
    const ui = document.getElementById('training-status-bar');
    if (ui.style.display === 'none') {
        startTraining();
    } else {
        stopTraining();
    }
}

function stopTraining() {
    isTraining = false;
    document.getElementById('training-status-bar').style.display = 'none';
}

function updateTrainingUI() {
    document.getElementById('curr-level').innerText = curriculumLevel;
    document.getElementById('train-episodes').innerText = trainStats.episodes;
    document.getElementById('win-rate').innerText = Math.round((trainStats.wins / trainStats.episodes) * 100) + "%";
}

function getPredictedCollision(attacker, dx, dy) {
    const angle = Math.atan2(dy, dx);
    const rayVx = Math.cos(angle); const rayVy = Math.sin(angle);
    let closestDist = Infinity; let target = null;
    leopards.forEach(l => {
        if (l === attacker || l.isDying) return;
        const toTargetX = l.x - attacker.x; const toTargetY = l.y - attacker.y;
        const projection = toTargetX * rayVx + toTargetY * rayVy;
        if (projection > 0) {
            const nearestX = attacker.x + rayVx * projection; const nearestY = attacker.y + rayVy * projection;
            const distSq = (l.x - nearestX)**2 + (l.y - nearestY)**2;
            const collisionDistThreshold = attacker.radius + l.radius;
            if (distSq < collisionDistThreshold**2) {
                const offset = Math.sqrt(collisionDistThreshold**2 - distSq);
                const actualDist = projection - offset;
                if (actualDist > 0 && actualDist < closestDist) { closestDist = actualDist; target = l; }
            }
        }
    });
    if (target) { return { hit: true, ghostX: attacker.x + rayVx * closestDist, ghostY: attacker.y + rayVy * closestDist, target }; }
    return { hit: false };
}

function initScoreDots() {
    blueDotsContainer.innerHTML = ''; redDotsContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const d1 = document.createElement('div'); d1.className = 'dot'; blueDotsContainer.appendChild(d1);
        const d2 = document.createElement('div'); d2.className = 'dot'; redDotsContainer.appendChild(d2);
    }
}

function updateExternalUI() {
    const bDots = blueDotsContainer.children; const rDots = redDotsContainer.children;
    for (let i = 0; i < 5; i++) {
        if (bDots[i]) bDots[i].classList.toggle('blue-fill', i < blueKills);
        if (rDots[i]) rDots[i].classList.toggle('red-fill', i < redKills);
    }
    if (currentActionDamage > 0) {
        actionDamageEl.innerText = `💥 行動總傷: ${Math.floor(currentActionDamage)}`;
        actionDamageEl.style.opacity = '1'; actionDamageEl.style.transform = 'scale(1.2)';
        setTimeout(() => { actionDamageEl.style.transform = 'scale(1.0)'; }, 150);
    }
}

function checkWinCondition() {
    if (blueKills >= 5 || redKills >= 5) {
        gameOver = true;
        
        const winner = blueKills >= 5 ? 'blue' : 'red';
        
        // 🔥 修正：訓練模式下不顯示結算畫面，避免干擾自動訓練流程
        if (!isTraining) {
            showFinalResult(winner);
        }
    }
}

function drawArrow(context, fromx, fromy, tox, toy, color = 'yellow') {
    const headlen = 15; const angle = Math.atan2(toy - fromy, tox - fromx);
    context.save(); context.strokeStyle = color; context.lineWidth = 4;
    context.beginPath(); context.moveTo(fromx, fromy); context.lineTo(tox, toy); context.stroke();
    context.beginPath(); context.moveTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    context.closePath(); context.fillStyle = color; context.fill(); context.restore();
}

// 🔥 尋找 getPointerPos 函式並替換為以下內容
function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    
    // 計算 CSS 縮放後的比例
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    // 1. 先將點擊點轉為相對於 canvas 的座標
    // 2. 乘以 scale 比例還原回 800x600 內部的座標
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    // 3. 考量攝影機(Camera)系統的位移與縮放
    return {
        x: (canvasX - canvas.width / 2) / camera.zoom + camera.x,
        y: (canvasY - canvas.height / 2) / camera.zoom + camera.y
    };
}

function handleStart(e) {
    if (isProcessing || gameOver) return;
    
    // 🔥 修正：如果是訓練中，必須同時開啟手動示範才能操作
    if (isTraining && !isManualDemo) {
        console.log("AI 正在訓練中，如需操作請開啟「手動示範」");
        return; 
    }
    
    if (gameMode === 'online' && currentTurn !== myTeam) return;

    const pos = getPointerPos(e);
    leopards.forEach(l => {
        // 確保你拉的是目前回合的隊伍（通常是紅隊）
        if (l.team === currentTurn && !l.hasMoved && !l.isDying) {
            let dist = Math.sqrt((pos.x - l.x)**2 + (pos.y - l.y)**2);
            if (dist < l.radius * 1.5) { 
                selectedLeopard = l; 
                isDragging = true; 
                dragEndPos = { x: pos.x, y: pos.y };

                // 錄製狀態
                if (isTraining && isManualDemo) {
                    const stateTensor = getGameStateTensor();
                    pendingMemory = {
                        state: stateTensor.arraySync()[0],
                        attackerId: l.id
                    };
                    stateTensor.dispose();
                }
            }
        }
    });
}

function handleMove(e) {
    if (!isDragging) return;
    const pos = getPointerPos(e);
    dragEndPos.x = pos.x; dragEndPos.y = pos.y;
    if (e.cancelable) e.preventDefault();
}

function handleEnd(e) {
    if (!isDragging) return;
    let dx = selectedLeopard.x - dragEndPos.x;
    let dy = selectedLeopard.y - dragEndPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 15) {
        if (dist > MAX_DRAG) {
            const ratio = MAX_DRAG / dist;
            dx *= ratio; dy *= ratio;
        }

        let vx = dx * LAUNCH_FORCE_MULT;
        let vy = dy * LAUNCH_FORCE_MULT;

        if (selectedLeopard.type === 'speedster') { vx *= 1.5; vy *= 1.5; }

        // 錄製動作：將向量轉回 AI 能理解的 normalized 數值
        if (isTraining && isManualDemo && pendingMemory) {
            const angle = Math.atan2(dy, dx) / Math.PI;
            const force = (dist / MAX_DRAG) * 2 - 1; // 轉回 -1 ~ 1 區間
            pendingMemory.action = [0, angle, force]; // 這裡簡化 targetIdx 為 0
        }

        if (gameMode === 'online') {
            socket.emit('playerMove', { roomId: currentRoomId, id: selectedLeopard.id, vx, vy });
        }

        activeStriker = selectedLeopard; 
        selectedLeopard.vx = vx;
        selectedLeopard.vy = vy;
        selectedLeopard.hasMoved = true;
        isProcessing = true;
        currentActionHits = 0; // 重置碰撞計數
    }

    isDragging = false;
    selectedLeopard = null;
}

canvas.addEventListener('mousedown', handleStart);
canvas.addEventListener('touchstart', handleStart, { passive: false });
window.addEventListener('mousemove', handleMove, { passive: false });
window.addEventListener('touchmove', handleMove, { passive: false });
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchend', handleEnd);

function updateCameraAndSlowMo() {
    timeScale += (targetTimeScale - timeScale) * 0.1;
    if (isSlowMo) {
        slowMoTimer--;
        if (slowMoTimer <= 0) { isSlowMo = false; targetTimeScale = 1.0; camera.targetZoom = 1.0; camera.targetX = 400; camera.targetY = 300; }
    }
    camera.zoom += (camera.targetZoom - camera.zoom) * 0.1;
    camera.x += (camera.targetX - camera.x) * 0.1;
    camera.y += (camera.targetY - camera.y) * 0.1;
}

function showFinalResult(winner) {
    const layer = document.getElementById('result-layer');
    const banner = document.getElementById('winner-banner');
    
    // 設定贏家色彩與文字
    if (winner === 'blue') {
        banner.innerText = "藍隊 壓倒性勝利";
        banner.style.color = "#3498db";
    } else {
        banner.innerText = "紅隊 統治了戰場";
        banner.style.color = "#e74c3c";
    }

    // 填入統計數據
    document.getElementById('final-kills').innerText = winner === 'blue' ? blueKills : redKills;
    document.getElementById('final-damage').innerText = Math.floor(totalDamageDealt);
    document.getElementById('final-rounds').innerText = roundCount;

    // 顯示圖層
    layer.style.display = 'flex';
    setTimeout(() => layer.classList.add('show'), 100);
}

function updateTurnDisplay() {
    const teamName = currentTurn === 'blue' ? '藍隊' : '紅隊';
    const isFirst = currentTurn === firstTeam ? '(先手)' : '(後手)';
    
    // 更新畫面上方 turn-display 的文字
    turnDisplay.innerText = `第 ${roundCount} 輪 - 輪到 ${teamName} ${isFirst}`;
}

// 🔥 新增於 script.js
function showBigAnnouncement(text, color = "white") {
    const el = document.getElementById('announcement');
    el.innerText = text;
    el.style.color = color;
    el.classList.add('show');
    
    setTimeout(() => {
        el.classList.remove('show');
    }, 1200); // 顯示 1.2 秒後消失
}

function gameLoop() {
    updateCameraAndSlowMo();

    // 🔥 修改：根據 trainingSpeed 決定物理更新頻率
    // 如果在訓練中，物理更新次數 = trainingSpeed，否則 = 1
    const steps = isTraining ? trainingSpeed : 1;

    if (isTraining && !trainRender) {
        runPhysicsSteps(steps);
        requestAnimationFrame(gameLoop);
        return; 
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateCameraAndSlowMo();
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    if (isDragging && selectedLeopard) {
        let dx = selectedLeopard.x - dragEndPos.x; let dy = selectedLeopard.y - dragEndPos.y;
        const dist = Math.sqrt(dx**2 + dy**2);
        // 🔥 同步視覺門檻：距離大於 15 才會顯示預覽線，否則視為取消狀態
        if (dist > 15) {
            let limDx = dx, limDy = dy; if (dist > MAX_DRAG) { const r = MAX_DRAG / dist; limDx *= r; limDy *= r; }
            const pred = getPredictedCollision(selectedLeopard, limDx, limDy);
            if (pred.hit) {
                ctx.save(); ctx.beginPath(); ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.moveTo(selectedLeopard.x, selectedLeopard.y); ctx.lineTo(pred.ghostX, pred.ghostY); ctx.stroke(); ctx.restore();
                ctx.save(); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(pred.ghostX, pred.ghostY, selectedLeopard.radius, 0, Math.PI*2); ctx.fillStyle = selectedLeopard.color; ctx.fill(); ctx.restore();
            } else {
                ctx.save(); ctx.setLineDash([8, 6]); drawArrow(ctx, selectedLeopard.x, selectedLeopard.y, selectedLeopard.x + limDx, selectedLeopard.y + limDy, 'rgba(255,255,255,0.5)'); ctx.restore();
            }
        }
    }

    leopards.forEach(l => l.draw()); // 繪圖維持一次
    runPhysicsSteps(steps); // 物理更新多次
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(); particles[i].draw();
        if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (let i = damageTexts.length - 1; i >= 0; i--) {
        damageTexts[i].update(); damageTexts[i].draw();
        if (damageTexts[i].life <= 0) damageTexts.splice(i, 1);
    }
    resolveCollisions();
    checkTurnSystem();
    ctx.restore(); 
    requestAnimationFrame(gameLoop);
}

gameLoop();
