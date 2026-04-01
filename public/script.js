const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnDisplay = document.getElementById('turn-display');
const actionDamageEl = document.getElementById('action-damage-text');
const blueDotsContainer = document.getElementById('blue-score-dots');
const redDotsContainer = document.getElementById('red-score-dots');

canvas.width = 800;
canvas.height = 600;

const FRICTION = 0.985; 
const WALL_BOUNCE = 0.8; 
const MIN_SPEED = 0.2; 
const LAUNCH_FORCE_MULT = 0.15; 
const MAX_DRAG = 150; 

let leopards = [];
let damageTexts = []; 
let particles = []; 
let blueKills = 0;   
let redKills = 0;    
let currentActionDamage = 0; 
let currentTurn = 'blue'; 
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
let isProcessing = false; 
let gameOver = false;

const blueSpawns = [{x: 100, y: 150}, {x: 100, y: 300}, {x: 100, y: 450}];
const redSpawns = [{x: 700, y: 150}, {x: 700, y: 300}, {x: 700, y: 450}];

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 12;
        this.vy = (Math.random() - 0.5) * 12;
        this.life = 40 + Math.random() * 20;
        this.size = Math.random() * 6 + 2;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.95;
        this.vy *= 0.95;
        this.life--;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = this.life / 60;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class DamageText {
    constructor(x, y, value) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.life = 60; 
        this.vy = -2.5; 
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
        ctx.fillStyle = '#ffcc00'; 
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`-${Math.floor(this.value)}`, this.x, this.y);
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
        this.isDying = false; 
    }

    draw() {
        if (this.isDying) return; 

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
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

        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`❤️${Math.max(0, Math.ceil(this.hp))}  🗡️${this.atk}`, this.x, this.y + this.radius + 25);
    }

    update() {
        if (this.isDying) return;

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

    die() {
        this.isDying = true;
        for (let i = 0; i < 25; i++) {
            particles.push(new Particle(this.x, this.y, this.color));
        }
        
        if (this.team === 'blue') redKills++;
        else blueKills++;
        
        updateExternalUI();
        checkWinCondition();
    }
}

// 🔥 預測碰撞邏輯
function getPredictedCollision(attacker, dx, dy) {
    const angle = Math.atan2(dy, dx);
    const rayVx = Math.cos(angle);
    const rayVy = Math.sin(angle);
    
    let closestDist = Infinity;
    let target = null;

    leopards.forEach(l => {
        if (l === attacker || l.isDying) return;

        const toTargetX = l.x - attacker.x;
        const toTargetY = l.y - attacker.y;
        const projection = toTargetX * rayVx + toTargetY * rayVy;
        
        if (projection > 0) {
            const nearestX = attacker.x + rayVx * projection;
            const nearestY = attacker.y + rayVy * projection;
            const distSq = (l.x - nearestX)**2 + (l.y - nearestY)**2;

            const collisionDistThreshold = attacker.radius + l.radius;
            if (distSq < collisionDistThreshold**2) {
                const offset = Math.sqrt(collisionDistThreshold**2 - distSq);
                const actualDist = projection - offset;

                if (actualDist > 0 && actualDist < closestDist) {
                    closestDist = actualDist;
                    target = l;
                }
            }
        }
    });

    if (target) {
        const ghostX = attacker.x + rayVx * closestDist;
        const ghostY = attacker.y + rayVy * closestDist;
        return { hit: true, ghostX, ghostY, target };
    }
    return { hit: false };
}

function initScoreDots() {
    blueDotsContainer.innerHTML = '';
    redDotsContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const d1 = document.createElement('div'); d1.className = 'dot'; blueDotsContainer.appendChild(d1);
        const d2 = document.createElement('div'); d2.className = 'dot'; redDotsContainer.appendChild(d2);
    }
}

function updateExternalUI() {
    const bDots = blueDotsContainer.children;
    const rDots = redDotsContainer.children;
    for (let i = 0; i < 5; i++) {
        bDots[i].classList.toggle('blue-fill', i < blueKills);
        rDots[i].classList.toggle('red-fill', i < redKills);
    }

    if (currentActionDamage > 0) {
        actionDamageEl.innerText = `💥 行動傷害: ${Math.floor(currentActionDamage)}`;
        actionDamageEl.style.opacity = '1';
    }
}

function checkWinCondition() {
    if (blueKills >= 5 || redKills >= 5) {
        gameOver = true;
        turnDisplay.innerText = blueKills >= 5 ? "藍隊獲勝！" : "紅隊獲勝！";
        turnDisplay.style.color = "gold";
        turnDisplay.style.fontSize = "32px";
    }
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
    leopard.hp = 100;
    leopard.isDying = false;
    leopard.hasMoved = false;
}

function initGame() {
    initScoreDots();
    leopards = [
        new Leopard(150, 150, 25, '#3498db', 'blue', 1),
        new Leopard(240, 300, 25, '#3498db', 'blue', 2), 
        new Leopard(150, 450, 25, '#3498db', 'blue', 3),
        new Leopard(650, 150, 25, '#e74c3c', 'red', 4),
        new Leopard(560, 300, 25, '#e74c3c', 'red', 5), 
        new Leopard(650, 450, 25, '#e74c3c', 'red', 6)
    ];
}

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
                if (b1.team !== b2.team) {
                    let relVx = b1.vx - b2.vx;
                    let relVy = b1.vy - b2.vy;
                    let dotProduct = relVx * dx + relVy * dy;

                    if (dotProduct > 0) {
                        let attacker = (b1.team === currentTurn) ? b1 : b2;
                        let victim = (attacker === b1) ? b2 : b1;
                        
                        victim.hp -= attacker.atk;
                        currentActionDamage += attacker.atk;
                        updateExternalUI();

                        damageTexts.push(new DamageText(victim.x, victim.y - 40, attacker.atk));
                        if (victim.hp <= 0) victim.die();
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

function drawArrow(context, fromx, fromy, tox, toy, color = 'yellow') {
    const headlen = 15; 
    const angle = Math.atan2(toy - fromy, tox - fromx);
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(fromx, fromy);
    context.lineTo(tox, toy);
    context.stroke();
    context.beginPath();
    context.moveTo(tox, toy);
    context.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    context.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.restore();
}

function checkTurnSystem() {
    if (gameOver) return;

    const activeLeopards = leopards.filter(l => !l.isDying && (Math.abs(l.vx) > 0.05 || Math.abs(l.vy) > 0.05));
    
    if (isProcessing && activeLeopards.length === 0) {
        isProcessing = false;
        
        leopards.forEach(l => { if (l.isDying) respawnLeopard(l); });

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
        
        actionDamageEl.style.opacity = '0';
        currentActionDamage = 0;

        turnDisplay.innerText = `輪到${currentTurn === 'blue' ? '藍隊' : '紅隊'}彈射 1 隻`;
    }
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
    if (isProcessing || gameOver) return;
    const pos = getPointerPos(e);
    leopards.forEach(l => {
        if (l.team === currentTurn && !l.hasMoved && !l.isDying) {
            let dist = Math.sqrt((pos.x - l.x)**2 + (pos.y - l.y)**2);
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
    let dx = selectedLeopard.x - dragEndPos.x;
    let dy = selectedLeopard.y - dragEndPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX_DRAG) {
        const ratio = MAX_DRAG / dist;
        dx *= ratio; dy *= ratio;
    }
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
    
    if (isDragging && selectedLeopard) {
        let dx = selectedLeopard.x - dragEndPos.x;
        let dy = selectedLeopard.y - dragEndPos.y;
        const dist = Math.sqrt(dx**2 + dy**2);
        
        if (dist > 5) {
            // 限制最大力道
            let limitedDx = dx;
            let limitedDy = dy;
            if (dist > MAX_DRAG) {
                const ratio = MAX_DRAG / dist;
                limitedDx *= ratio; limitedDy *= ratio;
            }

            const prediction = getPredictedCollision(selectedLeopard, limitedDx, limitedDy);
            
            if (prediction.hit) {
                // 1. 到碰撞點的虛線
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([8, 6]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 2;
                ctx.moveTo(selectedLeopard.x, selectedLeopard.y);
                ctx.lineTo(prediction.ghostX, prediction.ghostY);
                ctx.stroke();
                ctx.restore();

                // 2. 圓圈虛影
                ctx.save();
                ctx.globalAlpha = 0.4;
                ctx.beginPath();
                ctx.arc(prediction.ghostX, prediction.ghostY, selectedLeopard.radius, 0, Math.PI * 2);
                ctx.strokeStyle = 'white';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.fillStyle = selectedLeopard.color;
                ctx.fill();
                ctx.restore();

                // 3. 物理動量分配預測 (紅色與黃色箭頭長度隨力道改變)
                const vLaunchX = limitedDx * LAUNCH_FORCE_MULT;
                const vLaunchY = limitedDy * LAUNCH_FORCE_MULT;
                
                // 法線向量 (Ghost -> Target)
                const nx = (prediction.target.x - prediction.ghostX) / (selectedLeopard.radius + prediction.target.radius);
                const ny = (prediction.target.y - prediction.ghostY) / (selectedLeopard.radius + prediction.target.radius);
                
                // 投影 (傳遞給目標的衝量)
                const dot = vLaunchX * nx + vLaunchY * ny;
                
                // 被擊中者向量 (紅色箭頭)
                const vVictimX = dot * nx;
                const vVictimY = dot * ny;
                
                // 本身碰撞後向量 (黃色箭頭 = 原始向量 - 傳遞向量)
                const vAttackerX = vLaunchX - vVictimX;
                const vAttackerY = vLaunchY - vVictimY;

                const arrowScale = 6; // 視覺縮放係數
                drawArrow(ctx, prediction.target.x, prediction.target.y, prediction.target.x + vVictimX * arrowScale, prediction.target.y + vVictimY * arrowScale, '#ff4444');
                drawArrow(ctx, prediction.ghostX, prediction.ghostY, prediction.ghostX + vAttackerX * arrowScale, prediction.ghostY + vAttackerY * arrowScale, 'yellow');

            } else {
                ctx.save();
                ctx.setLineDash([8, 6]);
                drawArrow(ctx, selectedLeopard.x, selectedLeopard.y, selectedLeopard.x + limitedDx, selectedLeopard.y + limitedDy, 'rgba(255, 255, 255, 0.5)');
                ctx.restore();
            }
        }
    }

    leopards.forEach(l => {
        l.update();
        l.draw();
    });

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw();
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

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
