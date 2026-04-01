const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const turnDisplay = document.getElementById('turn-display');
const blueCountEl = document.getElementById('blue-count');
const redCountEl = document.getElementById('red-count');

canvas.width = 800;
canvas.height = 600;

// 遊戲常數
const FRICTION = 0.985; // 摩擦力，讓豹豹慢慢停下
const WALL_BOUNCE = 0.8; // 撞牆後的動量保留
const MIN_SPEED = 0.2; // 低於此速度則停止
const LAUNCH_FORCE_MULT = 0.15; // 發射力道倍率

let leopards = [];
let currentTurn = 'blue'; // 'blue' 或 'red'
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
let isProcessing = false; // 是否正在進行物理運動（運動時不能操作）

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
        this.hasMoved = false; // 紀錄本回合是否已彈射
    }

    draw() {
        // 繪製豹豹本體
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
        // 繪製外框（已行動則變灰暗）
        ctx.strokeStyle = this.hasMoved ? '#555' : 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.closePath();

        // 繪製血條
        ctx.fillStyle = 'red';
        ctx.fillRect(this.x - 20, this.y - this.radius - 10, 40, 5);
        ctx.fillStyle = 'green';
        ctx.fillRect(this.x - 20, this.y - this.radius - 10, (this.hp / 100) * 40, 5);
        
        // 標記目前可操作的豹豹（發光效果）
        if (!isProcessing && currentTurn === this.team && !this.hasMoved) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = 'yellow';
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        // 摩擦力
        this.vx *= FRICTION;
        this.vy *= FRICTION;

        if (Math.abs(this.vx) < MIN_SPEED) this.vx = 0;
        if (Math.abs(this.vy) < MIN_SPEED) this.vy = 0;

        // 邊界碰撞
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

// 初始化豹豹
function initGame() {
    leopards = [
        new Leopard(150, 200, 25, '#3498db', 'blue', 1),
        new Leopard(150, 300, 25, '#3498db', 'blue', 2),
        new Leopard(150, 400, 25, '#3498db', 'blue', 3),
        new Leopard(650, 200, 25, '#e74c3c', 'red', 4),
        new Leopard(650, 300, 25, '#e74c3c', 'red', 5),
        new Leopard(650, 400, 25, '#e74c3c', 'red', 6)
    ];
}

// 物理碰撞檢測
function resolveCollisions() {
    for (let i = 0; i < leopards.length; i++) {
        for (let j = i + 1; j < leopards.length; j++) {
            let b1 = leopards[i];
            let b2 = leopards[j];
            let dx = b2.x - b1.x;
            let dy = b2.y - b1.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < b1.radius + b2.radius) {
                // 發生碰撞，扣除 HP (如果是敵對隊伍)
                if (b1.team !== b2.team) {
                    b1.hp -= 0.5; // 持續碰撞扣血
                    b2.hp -= 0.5;
                }

                // 彈性碰撞物理計算
                let collisionAngle = Math.atan2(dy, dx);
                let speed1 = Math.sqrt(b1.vx * b1.vx + b1.vy * b1.vy);
                let speed2 = Math.sqrt(b2.vx * b2.vx + b2.vy * b2.vy);
                let direction1 = Math.atan2(b1.vy, b1.vx);
                let direction2 = Math.atan2(b2.vy, b2.vx);

                let vx1 = speed1 * Math.cos(direction1 - collisionAngle);
                let vy1 = speed1 * Math.sin(direction1 - collisionAngle);
                let vx2 = speed2 * Math.cos(direction2 - collisionAngle);
                let vy2 = speed2 * Math.sin(direction2 - collisionAngle);

                let final_vx1 = vx2;
                let final_vx2 = vx1;

                b1.vx = Math.cos(collisionAngle) * final_vx1 + Math.cos(collisionAngle + Math.PI / 2) * vy1;
                b1.vy = Math.sin(collisionAngle) * final_vx1 + Math.sin(collisionAngle + Math.PI / 2) * vy1;
                b2.vx = Math.cos(collisionAngle) * final_vx2 + Math.cos(collisionAngle + Math.PI / 2) * vy2;
                b2.vy = Math.sin(collisionAngle) * final_vx2 + Math.sin(collisionAngle + Math.PI / 2) * vy2;

                // 防止重疊
                let overlap = b1.radius + b2.radius - distance;
                b1.x -= Math.cos(collisionAngle) * (overlap / 2);
                b1.y -= Math.sin(collisionAngle) * (overlap / 2);
                b2.x += Math.cos(collisionAngle) * (overlap / 2);
                b2.y += Math.sin(collisionAngle) * (overlap / 2);
            }
        }
    }
}

// 檢查回合結束與勝負
function checkTurnSystem() {
    const activeLeopards = leopards.filter(l => l.vx !== 0 || l.vy !== 0);
    
    if (isProcessing && activeLeopards.length === 0) {
        isProcessing = false;
        
        // 移除死亡的豹豹
        leopards = leopards.filter(l => l.hp > 0);
        updateUI();

        // 檢查當前隊伍是否所有豹豹都動過了
        const teamMembers = leopards.filter(l => l.team === currentTurn);
        const allMoved = teamMembers.every(l => l.hasMoved);

        if (allMoved) {
            // 切換回合並重置移動標記
            currentTurn = currentTurn === 'blue' ? 'red' : 'blue';
            leopards.forEach(l => { if (l.team === currentTurn) l.hasMoved = false; });
            turnDisplay.innerText = `目前回合：${currentTurn === 'blue' ? '藍隊' : '紅隊'}`;
        }
    }
}

function updateUI() {
    blueCountEl.innerText = leopards.filter(l => l.team === 'blue').length;
    redCountEl.innerText = leopards.filter(l => l.team === 'red').length;
}

// 滑鼠監聽
canvas.addEventListener('mousedown', (e) => {
    if (isProcessing) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    leopards.forEach(l => {
        if (l.team === currentTurn && !l.hasMoved) {
            let dist = Math.sqrt((mouseX - l.x) ** 2 + (mouseY - l.y) ** 2);
            if (dist < l.radius) {
                selectedLeopard = l;
                isDragging = true;
            }
        }
    });
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    dragEndPos.x = e.clientX - rect.left;
    dragEndPos.y = e.clientY - rect.top;
});

canvas.addEventListener('mouseup', (e) => {
    if (!isDragging) return;

    const dx = selectedLeopard.x - dragEndPos.x;
    const dy = selectedLeopard.y - dragEndPos.y;

    selectedLeopard.vx = dx * LAUNCH_FORCE_MULT;
    selectedLeopard.vy = dy * LAUNCH_FORCE_MULT;
    selectedLeopard.hasMoved = true;

    isDragging = false;
    selectedLeopard = null;
    isProcessing = true;
});

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 繪製輔助線
    if (isDragging && selectedLeopard) {
        ctx.beginPath();
        ctx.moveTo(selectedLeopard.x, selectedLeopard.y);
        ctx.lineTo(dragEndPos.x, dragEndPos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 繪製反向預測箭頭
        const dx = selectedLeopard.x - dragEndPos.x;
        const dy = selectedLeopard.y - dragEndPos.y;
        ctx.beginPath();
        ctx.moveTo(selectedLeopard.x, selectedLeopard.y);
        ctx.lineTo(selectedLeopard.x + dx, selectedLeopard.y + dy);
        ctx.strokeStyle = 'yellow';
        ctx.stroke();
    }

    leopards.forEach(l => {
        l.update();
        l.draw();
    });

    resolveCollisions();
    checkTurnSystem();

    requestAnimationFrame(gameLoop);
}

initGame();
gameLoop();
