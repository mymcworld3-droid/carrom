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

// 🔥 將 server.js 的 io.on('connection', ...) 區塊完整替換為以下邏輯
let rooms = {}; 

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        id: id,
        name: rooms[id].name,
        playerCount: rooms[id].players.length
    }));
    io.emit('roomListUpdate', list);
}

io.on('connection', (socket) => {
    console.log('玩家連線:', socket.id);

    socket.on('getRooms', () => {
        broadcastRoomList();
    });

    socket.on('createRoom', () => {
        const roomId = "room_" + socket.id;
        rooms[roomId] = {
            name: `豹豹戰隊 ${Math.floor(100 + Math.random() * 899)}`,
            players: [{ id: socket.id, team: 'blue', ready: false, config: null }],
            status: 'waiting'
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, team: 'blue' });
        broadcastRoomList();
    });

    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, team: 'red', ready: false, config: null });
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, team: 'red' });
            io.to(roomId).emit('opponentJoined');
            broadcastRoomList();
        } else {
            socket.emit('errorMsg', room ? '房間已滿' : '房間不存在');
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

    socket.on('playerMove', (data) => {
        if (data.roomId) socket.to(data.roomId).emit('opponentMove', data);
    });

    socket.on('syncState', (data) => {
        if (data.roomId) socket.to(data.roomId).emit('updateClientState', data);
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) {
                delete rooms[id];
            } else {
                io.to(id).emit('opponentLeft');
            }
        }
        broadcastRoomList();
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
