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

// 🔥 修改 server.js 中的 io.on('connection') 部分
let players = {}; // 追蹤連線玩家狀態

// 🔥 修改 server.js：管理多房間邏輯
let rooms = {}; 

io.on('connection', (socket) => {
    console.log('玩家連線:', socket.id);

    // 1. 創建房間
    socket.on('createRoom', () => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            players: [{ id: socket.id, team: 'blue', ready: false, config: null }],
            status: 'waiting'
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, team: 'blue' });
    });

    // 2. 加入房間
    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, team: 'red', ready: false, config: null });
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, team: 'red' });
            // 告訴房主有人進來了
            io.to(roomId).emit('opponentJoined');
        } else {
            socket.emit('errorMsg', room ? '房間已滿' : '房間不存在');
        }
    });

    // 3. 確認配置
    socket.on('confirmSelection', (data) => {
        const { roomId, config, team } = data;
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.config = config;
            player.ready = true;
            
            // 通知同房間的對手
            socket.to(roomId).emit('opponentReady');

            // 檢查是否雙方皆準備完成
            if (room.players.length === 2 && room.players.every(p => p.ready)) {
                const blue = room.players.find(p => p.team === 'blue');
                const red = room.players.find(p => p.team === 'red');
                io.to(roomId).emit('allPlayersReady', {
                    blueConfig: blue.config,
                    redConfig: red.config
                });
            }
        }
    });

    // 4. 轉發遊戲動作
    socket.on('playerMove', (data) => {
        const { roomId } = data;
        socket.to(roomId).emit('opponentMove', data);
    });

    socket.on('syncState', (data) => {
        const { roomId } = data;
        socket.to(roomId).emit('updateClientState', data);
    });

    socket.on('disconnect', () => {
        // 清理房間
        for (const id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
        }
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
