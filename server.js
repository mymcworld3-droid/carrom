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

io.on('connection', (socket) => {
    console.log('玩家連線:', socket.id);

    // 分派隊伍
    const assignedTeam = io.engine.clientsCount % 2 === 1 ? 'blue' : 'red';
    players[socket.id] = { team: assignedTeam, ready: false, config: null };
    
    socket.emit('initTeam', assignedTeam);

    // 處理隊伍配置確認
    socket.on('confirmSelection', (data) => {
        if (players[socket.id]) {
            players[socket.id].config = data.config;
            players[socket.id].ready = true;
            
            // 告訴對手：我選好了
            socket.broadcast.emit('opponentReady', { team: data.team, config: data.config });
            
            // 檢查是否雙方都準備好
            const allReady = Object.values(players).filter(p => p.ready).length >= 2;
            if (allReady) {
                io.emit('allPlayersReady');
            }
        }
    });

    // 轉發動作
    socket.on('playerMove', (data) => {
        socket.broadcast.emit('opponentMove', data);
    });

    // 轉發物理狀態同步（由目前行動者發出，強制校準對手畫面）
    socket.on('syncState', (data) => {
        socket.broadcast.emit('updateClientState', data);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        console.log('玩家斷線');
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
