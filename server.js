const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 初始化 Socket.io 並允許跨域請求
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 指定靜態檔案目錄（存放 index.html, style.css, script.js 的地方）
app.use(express.static(path.join(__dirname, 'public')));
// 🔥 核心邏輯：管理房間與即時同步
let rooms = {}; 

function broadcastRoomList(io) {
    const list = Object.keys(rooms).map(id => ({
        id: id,
        name: rooms[id].name,
        playerCount: rooms[id].players.length
    }));
    io.emit('roomListUpdate', list);
}

io.on('connection', (socket) => {
    socket.on('getRooms', () => broadcastRoomList(io));

    // 創建房間：自動將創建者設為藍隊並加入
    socket.on('createRoom', () => {
        const roomId = "room_" + socket.id;
        rooms[roomId] = {
            name: `豹豹戰隊 ${Math.floor(100 + Math.random() * 899)}`,
            players: [{ id: socket.id, team: 'blue', ready: false, config: [] }],
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, team: 'blue' });
        broadcastRoomList(io);
    });

    // 加入房間：修復加入後的配置校準
    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, team: 'red', ready: false, config: [] });
            socket.join(roomId);
            
            // 找出對手的配置
            const opponent = room.players.find(p => p.id !== socket.id);
            
            socket.emit('roomJoined', { 
                roomId, 
                team: 'red', 
                opponentConfig: opponent ? opponent.config : [] 
            });
            
            // 告知房主有對手加入
            socket.to(roomId).emit('opponentJoined', { team: 'red' });
            broadcastRoomList(io);
        } else {
            socket.emit('errorMsg', room ? '房間已滿' : '房間不存在');
        }
    });

    // 即時更新選擇狀態
    socket.on('updateSelection', (data) => {
        const { roomId, config } = data;
        const room = rooms[roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) player.config = config;
            socket.to(roomId).emit('opponentSelectionUpdate', { config });
        }
    });

    socket.on('confirmSelection', (data) => {
        const { roomId, config } = data;
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.config = config;
            player.ready = true;
            socket.to(roomId).emit('opponentReady');
            if (room.players.length === 2 && room.players.every(p => p.ready)) {
                const blue = room.players.find(p => p.team === 'blue');
                const red = room.players.find(p => p.team === 'red');
                io.to(roomId).emit('allPlayersReady', { blueConfig: blue.config, redConfig: red.config });
            }
        }
    });

    // 🔥 監聽玩家彈射動作並轉發給同房間的對手
    socket.on('playerMove', (data) => {
        // data 包含 roomId, id (豹豹ID), vx, vy
        socket.to(data.roomId).emit('opponentMove', data);
    });

    // 🔥 監聽回合結束後的狀態同步，並更新給對手
    socket.on('syncState', (data) => {
        // data 包含所有的豹豹位置、血量以及目前的擊殺數、輪數等
    // 🔥 在 initOnlineMode 函式中修改此監聽器
    socket.on('updateClientState', (data) => {
        data.leopards.forEach(remoteL => {
            const localL = leopards.find(l => l.id === remoteL.id);
            if (localL) {
                localL.x = remoteL.x; 
                localL.y = remoteL.y;
                localL.hp = remoteL.hp; 
                localL.atk = remoteL.atk;
                // 強制歸零速度，防止兩邊物理模擬差異導致卡住
                localL.vx = 0;
                localL.vy = 0;
            }
        });
    
        // 強制重置狀態鎖
        isProcessing = false;
        activeStriker = null;
    
        blueKills = data.blueKills; 
        redKills = data.redKills;
        totalDamageDealt = data.totalDamage; 
        roundCount = data.round;
        firstTeam = data.firstTeam; 
        currentTurn = data.nextTurn;
    
        updateExternalUI(); 
        updateTurnDisplay();
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const index = rooms[id].players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                rooms[id].players.splice(index, 1);
                if (rooms[id].players.length === 0) delete rooms[id];
                else io.to(id).emit('opponentLeft');
            }
        }
        broadcastRoomList(io);
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
