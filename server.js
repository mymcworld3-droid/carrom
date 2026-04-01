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

    // 🔥 更新 Socket.io 邏輯
io.on('connection', (socket) => {
    console.log('玩家連線:', socket.id);

    // 簡單的分隊邏輯：第一個進來藍隊，第二個紅隊
    const playerCount = io.engine.clientsCount;
    const team = playerCount % 2 === 1 ? 'blue' : 'red';
    socket.emit('initTeam', team);

    socket.on('playerMove', (data) => {
        // 將操作廣播給對手
        socket.broadcast.emit('opponentMove', data);
    });

    socket.on('disconnect', () => {
        console.log('玩家斷線');
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
