const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnDisplay = document.getElementById('turn-display');
const blueCountEl = document.getElementById('blue-count');
const redCountEl = document.getElementById('red-count');

canvas.width = 800;
canvas.height = 600;

const FRICTION = 0.985; 
const WALL_BOUNCE = 0.8; 
const MIN_SPEED = 0.2; 
const LAUNCH_FORCE_MULT = 0.15; 

let leopards = [];
let damageTexts = []; 
let currentTurn = 'blue'; 
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
let isProcessing = false; 

// 🔥 傷害數字跳出效果
class DamageText {
    constructor(x, y, value) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.life = 60; 
        this.vy = -2.5; // 向上飄
        this.opacity = 1;
    }
    update() {
        this.y += this.vy;
        this.life--;
        this.opacity = this.life / 60;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = '#ffcc00'; // 醒目的亮黃色
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.fillText(`-${this.value}`, this.x, this.y);
        ctx.restore();
    }
}

class Leopard {
    constructor(x, y, radius, color, team, id) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.team = team;
        this.vx = 0;
        this.vy = 0;
        this.hp = 100;
        this.atk = 20;
        this.hasMoved = false; 
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
        // 輪到該豹豹時的外框特效
        if (!isProcessing && currentTurn === this.team && !this.hasMoved) {
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 5;
            ctx.stroke();
        } else {
            ctx.strokeStyle = this.hasMoved ? '#444' : 'white';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        ctx.closePath();

        // 🔥 顯示在豹豹下方：❤️ 生命值 🗡️ 攻擊力
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`❤️${Math.max(0, Math.ceil(this.hp))}  🗡️${this.atk}`, this.x, this.y + this.radius + 25);
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
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
}

function initGame() {
    // 🔥 中間豹豹往前推進的陣型
    leopards = [
        new Leopard(150, 200, 25, '#3498db', 'blue', 1),
        new Leopard(240, 300, 25, '#3498db', 'blue', 2), // 藍隊往前
        new Leopard(150, 400, 25, '#3498db', 'blue', 3),
        
        new Leopard(650, 200, 25, '#e74c3c', 'red', 4),
        new Leopard(560, 300, 25, '#e74c3c', 'red', 5),  // 紅隊往前
        new Leopard(650, 400, 25, '#e74c3c', 'red', 6)
    ];
}

function resolveCollisions() {
    for (let i = 0; i < leopards.length; i++) {
        for (let j = i + 1; j < leopards.length; j++) {
            let b1 = leopards[i];
            let b2 = leopards[j];
            let dx = b2.x - b1.x;
            let dy = b2.y - b1.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < b1.radius + b2.radius) {
                // 🔥 傷害判定：己方攻擊時，碰到對方的任何碰撞都會造成傷害
                if (b1.team !== b2.team) {
                    let relVx = b1.vx - b2.vx;
                    let relVy = b1.vy - b2.vy;
                    // dotProduct > 0 表示兩顆球正在互相靠近
                    let dotProduct = relVx * dx + relVy * dy;

                    if (dotProduct > 0) {
                        let attacker, victim;
                        // 判定誰是己方 (目前回合方)
                        if (b1.team === currentTurn) {
                            attacker = b1;
                            victim = b2;
                        } else {
                            attacker = b2;
                            victim = b1;
                        }
                        
                        // 造成傷害
                        victim.hp -= attacker.atk;
                        damageTexts.push(new DamageText(victim.x, victim.y - 40, attacker.atk));
                    }
                }

                // 彈性碰撞物理反彈
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

                // 防止重疊卡死
                let overlap = b1.radius + b2.radius - distance;
                b1.x -= Math.cos(collisionAngle) * (overlap / 2);
                b1.y -= Math.sin(collisionAngle) * (overlap / 2);
                b2.x += Math.cos(collisionAngle) * (overlap / 2);
                b2.y += Math.sin(collisionAngle) * (overlap / 2);
            }
        }
    }
}

// 🔥 繪製箭頭功能
function drawArrow(context, fromx, fromy, tox, toy) {
    const headlen = 15; 
    const angle = Math.atan2(toy - fromy, tox - fromx);
    
    context.save();
    context.strokeStyle = 'yellow';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(fromx, fromy);
    context.lineTo(tox, toy);
    context.stroke();
    
    context.beginPath();
    context.moveTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = 'yellow';
    context.fill();
    context.restore();
}

function checkTurnSystem() {
    const activeLeopards = leopards.filter(l => Math.abs(l.vx) > 0.05 || Math.abs(l.vy) > 0.05);
    
    if (isProcessing && activeLeopards.length === 0) {
        isProcessing = false;
        leopards = leopards.filter(l => l.hp > 0);
        updateUI();

        const nextTeam = currentTurn === 'blue' ? 'red' : 'blue';
        const nextTeamCanMove = leopards.some(l => l.team === nextTeam && !l.hasMoved);

        if (nextTeamCanMove) {
            currentTurn = nextTeam;
        } else {
            const currentTeamCanMove = leopards.some(l => l.team === currentTurn && !l.hasMoved);
            if (!currentTeamCanMove) {
                leopards.forEach(l => l.hasMoved = false);
                currentTurn = 'blue';
            }
        }
        turnDisplay.innerText = `輪到${currentTurn === 'blue' ? '藍隊' : '紅隊'}彈射 1 隻`;
    }
}

function updateUI() {
    blueCountEl.innerText = leopards.filter(l => l.team === 'blue').length;
    redCountEl.innerText = leopards.filter(l => l.team === 'red').length;
}

function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function handleStart(e) {
    if (isProcessing) return;
    const pos = getPointerPos(e);

    leopards.forEach(l => {
        if (l.team === currentTurn && !l.hasMoved) {
            let dist = Math.sqrt((pos.x - l.x) ** 2 + (pos.y - l.y) ** 2);
            if (dist < l.radius) {
                selectedLeopard = l;
                isDragging = true;
                dragEndPos = { x: pos.x, y: pos.y };
            }
        }
    });
    if (isDragging && e.cancelable) e.preventDefault();
}

function handleMove(e) {
    if (!isDragging) return;
    const pos = getPointerPos(e);
    dragEndPos.x = pos.x;
    dragEndPos.y = pos.y;
    if (e.cancelable) e.preventDefault();
}

function handleEnd(e) {
    if (!isDragging) return;
    const dx = selectedLeopard.x - dragEndPos.x;
    const dy = selectedLeopard.y - dragEndPos.y;
    selectedLeopard.vx = dx * LAUNCH_FORCE_MULT;
    selectedLeopard.vy = dy * LAUNCH_FORCE_MULT;
    selectedLeopard.hasMoved = true;
    isDragging = false;
    selectedLeopard = null;
    isProcessing = true;
}

canvas.addEventListener('mousedown', handleStart);
canvas.addEventListener('touchstart', handleStart, { passive: false });
window.addEventListener('mousemove', handleMove, { passive: false });
window.addEventListener('touchmove', handleMove, { passive: false });
window.addEventListener('mouseup', handleEnd);
window.addEventListener('touchend', handleEnd);

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 拉弓預測
    if (isDragging && selectedLeopard) {
        ctx.beginPath();
        ctx.moveTo(selectedLeopard.x, selectedLeopard.y);
        ctx.lineTo(dragEndPos.x, dragEndPos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        const dx = selectedLeopard.x - dragEndPos.x;
        const dy = selectedLeopard.y - dragEndPos.y;
        // 🔥 繪製指向箭頭
        drawArrow(ctx, selectedLeopard.x, selectedLeopard.y, selectedLeopard.x + dx, selectedLeopard.y + dy);
    }

    leopards.forEach(l => {
        l.update();
        l.draw();
    });

    // 更新與顯示傷害文字
    for (let i = damageTexts.length - 1; i >= 0; i--) {
        damageTexts[i].update();
        damageTexts[i].draw();
        if (damageTexts[i].life <= 0) damageTexts.splice(i, 1);
    }

    resolveCollisions();
    checkTurnSystem();
    requestAnimationFrame(gameLoop);
}

initGame();
gameLoop();
