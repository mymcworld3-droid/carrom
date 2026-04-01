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
let currentTurn = 'blue'; 
let isDragging = false;
let selectedLeopard = null;
let dragEndPos = { x: 0, y: 0 };
let isProcessing = false; 

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
        
        ctx.strokeStyle = this.hasMoved ? '#555' : 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.closePath();

        ctx.fillStyle = 'red';
        ctx.fillRect(this.x - 20, this.y - this.radius - 10, 40, 5);
        ctx.fillStyle = 'green';
        ctx.fillRect(this.x - 20, this.y - this.radius - 10, (this.hp / 100) * 40, 5);
        
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
    leopards = [
        new Leopard(150, 200, 25, '#3498db', 'blue', 1),
        new Leopard(150, 300, 25, '#3498db', 'blue', 2),
        new Leopard(150, 400, 25, '#3498db', 'blue', 3),
        new Leopard(650, 200, 25, '#e74c3c', 'red', 4),
        new Leopard(650, 300, 25, '#e74c3c', 'red', 5),
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
                if (b1.team !== b2.team) {
                    b1.hp -= 0.5;
                    b2.hp -= 0.5;
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
    const activeLeopards = leopards.filter(l => Math.abs(l.vx) > 0 || Math.abs(l.vy) > 0);
    
    if (isProcessing && activeLeopards.length === 0) {
        isProcessing = false;
        leopards = leopards.filter(l => l.hp > 0);
        updateUI();

        const teamMembers = leopards.filter(l => l.team === currentTurn);
        const allMoved = teamMembers.every(l => l.hasMoved);

        if (allMoved) {
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
    
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
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
    
    // 🔥 關鍵：攔截事件，防止瀏覽器觸發雙擊或長按
    if (isDragging) {
        if (e.cancelable) e.preventDefault();
    }
}

function handleMove(e) {
    if (!isDragging) return;
    const pos = getPointerPos(e);
    dragEndPos.x = pos.x;
    dragEndPos.y = pos.y;
    // 🔥 關鍵：防止拖動豹豹時網頁跟著跑
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

    if (isDragging && selectedLeopard) {
        ctx.beginPath();
        ctx.moveTo(selectedLeopard.x, selectedLeopard.y);
        ctx.lineTo(dragEndPos.x, dragEndPos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        
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
