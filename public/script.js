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
    support: { name: '戰吼豹', icon: '🔥', hp: 90, atk: 15, desc: '特殊能力：碰撞我方豹豹時，該隊友攻擊力 +5。' }
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
let currentTurn = 'blue'; 
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
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
        const config = LEOPARD_TYPES[typeKey];
        this.id = id;
        this.type = typeKey;
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

        if (this.x - this.radius < 0 || this.x + this.radius > canvas.width) {
            this.vx = -this.vx * WALL_BOUNCE;
            this.x = this.x - this.radius < 0 ? this.radius : canvas.width - this.radius;
        }
        if (this.y - this.radius < 0 || this.y + this.radius > canvas.height) {
            this.vy = -this.vy * WALL_BOUNCE;
            this.y = this.y - this.radius < 0 ? this.radius : canvas.height - this.radius;
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

// 🔥 配置階段邏輯
window.enterSelection = function(mode) {
    gameMode = mode;
    document.getElementById('menu-layer').style.display = 'none';
    document.getElementById('selection-layer').style.display = 'flex';
    
    renderTypeSelection();
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

function selectType(key) {
    let currentConfig = (selectingTeam === 'blue') ? blueTeamConfig : redTeamConfig;
    if (currentConfig.length < 3) {
        currentConfig.push(key);
        updateSelectionPreview();
    }
}

function updateSelectionPreview() {
    const preview = document.getElementById('current-selection');
    const btn = document.getElementById('confirm-selection-btn');
    let currentConfig = (selectingTeam === 'blue') ? blueTeamConfig : redTeamConfig;
    
    preview.innerHTML = currentConfig.map(key => `<div class="dot ${selectingTeam}-fill" style="width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:14px;">${LEOPARD_TYPES[key].icon}</div>`).join('');
    
    btn.disabled = currentConfig.length < 3;
}

function confirmSelection() {
    if (gameMode === 'local' && selectingTeam === 'blue') {
        selectingTeam = 'red';
        document.getElementById('selection-title').innerText = '紅隊 配置隊伍';
        updateSelectionPreview();
        return;
    }
    
    // 如果是單人模式，AI 隨機選
    if (gameMode === 'single') {
        const keys = Object.keys(LEOPARD_TYPES);
        redTeamConfig = [keys[Math.floor(Math.random()*keys.length)], keys[Math.floor(Math.random()*keys.length)], keys[Math.floor(Math.random()*keys.length)]];
    }

    startGame();
}

function startGame() {
    document.getElementById('selection-layer').style.display = 'none';
    document.getElementById('game-layer').style.display = 'flex';
    
    if (gameMode === 'online') {
        initOnlineMode();
    }
    
    initGame();
    updateExternalUI();
}

// 🔥 核心物理衝突
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
                // 🔥 戰吼邏輯：移除 buffedThisTurn 限制，允許複數次增加
                if (b1.team === b2.team) {
                    if (activeStriker === b1 || activeStriker === b2) {
                        let striker = (activeStriker === b1) ? b1 : b2;
                        let target = (striker === b1) ? b2 : b1;
                        
                        if (striker.type === 'support') {
                            target.atk += 5;
                            // 每次碰撞都彈出文字
                            damageTexts.push(new DamageText(target.x, target.y - 40, "戰吼! ATK+5", true));
                        }
                    }
                } else {
                    // 對手碰撞
                    let relVx = b1.vx - b2.vx;
                    let relVy = b1.vy - b2.vy;
                    let dotProduct = relVx * dx + relVy * dy;

                    if (dotProduct > 0) {
                        let attacker = (b1.team === currentTurn) ? b1 : b2;
                        let victim = (attacker === b1) ? b2 : b1;
                        
                        victim.hp -= attacker.atk;
                        totalDamageDealt += attacker.atk;
                        currentActionDamage += attacker.atk;
                        updateExternalUI();

                        damageTexts.push(new DamageText(victim.x, victim.y - 40, attacker.atk, victim.hp <= 0));
                        if (victim.hp <= 0) victim.die();
                    }
                }

                // 彈性碰撞物理
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

// 🔥 修改 script.js 中的 checkTurnSystem 函式
function checkTurnSystem() {
    if (gameOver) return;

    const movingLeopards = leopards.filter(l => !l.isDying && (Math.abs(l.vx) > 0.05 || Math.abs(l.vy) > 0.05));
    
    if (isProcessing && movingLeopards.length === 0 && !isSlowMo) {
        isProcessing = false;
        activeStriker = null;

        leopards.forEach(l => { 
            l.buffedThisTurn = false;
            if (l.isDying) respawnLeopard(l); 
        });

        const otherTeam = currentTurn === 'blue' ? 'red' : 'blue';
        const otherCanMove = leopards.some(l => l.team === otherTeam && !l.hasMoved);

        if (otherCanMove) {
            currentTurn = otherTeam;
        } else {
            const currentCanMove = leopards.some(l => l.team === currentTurn && !l.hasMoved);
            if (!currentCanMove) {
                // 進入下一輪並交換先後手
                roundCount++;
                firstTeam = (roundCount % 2 === 1) ? 'blue' : 'red';
                currentTurn = firstTeam;
                leopards.forEach(l => l.hasMoved = false);
            }
        }
        
        // 🔥 跳出大字公告
        const teamColor = currentTurn === 'blue' ? '#3498db' : '#e74c3c';
        const teamName = currentTurn === 'blue' ? '藍隊' : '紅隊';
        const statusText = currentTurn === firstTeam ? '先手' : '後手';
        showBigAnnouncement(`${teamName} 行動\n(${statusText})`, teamColor);

        // 🔥 單人模式：若輪到紅方，由 AI 執行
        if (gameMode === 'single' && currentTurn === 'red') {
            setTimeout(makeAIMove, 1500); // 等大字跑完再射
        }

        const targetTeamCanMove = leopards.some(l => l.team === currentTurn && !l.hasMoved);
        if (!targetTeamCanMove && !gameOver) {
            checkTurnSystem(); 
            return;
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
    leopard.isDying = false;
}

// --- 以下維持原有物理模擬與渲染邏輯 ---

function initOnlineMode() {
    if (typeof io === 'undefined') return;
    socket = io();
    socket.on('initTeam', (assignedTeam) => { myTeam = assignedTeam; });
    socket.on('opponentMove', (data) => {
        const leopard = leopards.find(l => l.id === data.id);
        if (leopard) { leopard.vx = data.vx; leopard.vy = data.vy; leopard.hasMoved = true; isProcessing = true; }
    });
    socket.on('syncState', (data) => {
        data.leopards.forEach(remoteL => {
            const localL = leopards.find(l => l.id === remoteL.id);
            if (localL) { localL.x = remoteL.x; localL.y = remoteL.y; localL.hp = remoteL.hp; localL.atk = remoteL.atk; }
        });
        blueKills = data.blueKills; redKills = data.redKills; updateExternalUI();
    });
}

function makeAIMove() {
    if (gameOver || isProcessing) return;
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
    attacker.hasMoved = true; isProcessing = true;
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
        showFinalResult(winner);
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

function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
    else { clientX = e.clientX; clientY = e.clientY; }
    return { x: (clientX - rect.left - canvas.width/2) / camera.zoom + camera.x, y: (clientY - rect.top - canvas.height/2) / camera.zoom + camera.y };
}

function handleStart(e) {
    if (isProcessing || gameOver) return;
    if (gameMode === 'online' && currentTurn !== myTeam) return;
    const pos = getPointerPos(e);
    leopards.forEach(l => {
        if (l.team === currentTurn && !l.hasMoved && !l.isDying) {
            let dist = Math.sqrt((pos.x - l.x)**2 + (pos.y - l.y)**2);
            if (dist < l.radius * 1.5) { selectedLeopard = l; isDragging = true; dragEndPos = { x: pos.x, y: pos.y }; }
        }
    });
    if (isDragging && e.cancelable) e.preventDefault();
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
    
    if (dist > 5) {
        if (dist > MAX_DRAG) {
            const ratio = MAX_DRAG / dist;
            dx *= ratio; dy *= ratio;
        }

        const vx = dx * LAUNCH_FORCE_MULT;
        const vy = dy * LAUNCH_FORCE_MULT;

        if (gameMode === 'online') {
            socket.emit('playerMove', { id: selectedLeopard.id, vx, vy });
        }

        // 🔥 記錄主動彈射者
        activeStriker = selectedLeopard; 
        selectedLeopard.vx = vx;
        selectedLeopard.vy = vy;
        selectedLeopard.hasMoved = true;
        isProcessing = true;
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateCameraAndSlowMo();
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    if (isDragging && selectedLeopard) {
        let dx = selectedLeopard.x - dragEndPos.x; let dy = selectedLeopard.y - dragEndPos.y;
        const dist = Math.sqrt(dx**2 + dy**2);
        if (dist > 5) {
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

    leopards.forEach(l => { l.update(); l.draw(); });
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
