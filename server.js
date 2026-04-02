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

// 🔥 修改 server.js：管理房間列表與廣播
let rooms = {}; 

function broadcastRoomList() {
    const list = Object.keys(rooms).map(id => ({
        id: id,
        name: rooms[id].name,
        playerCount: rooms[id].players.length
    }));
    io.emit('roomListUpdate', list); // 廣播給所有人
}

io.on('connection', (socket) => {
    console.log('玩家連線:', socket.id);

    // 進入連線模式時獲取初始列表
    socket.on('getRooms', () => {
        broadcastRoomList();
    });

    // 1. 創建房間
    socket.on('createRoom', () => {
        const roomId = "room_" + socket.id; // 用 socket ID 作為唯一標識
        rooms[roomId] = {
            name: `豹豹戰隊 ${Math.floor(Math.random()*999)}`,
            players: [{ id: socket.id, team: 'blue', ready: false, config: null }],
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, team: 'blue' });
        broadcastRoomList(); // 更新清單
    });

    // 2. 加入房間
    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, team: 'red', ready: false, config: null });
            socket.join(roomId);
            socket.emit('roomJoined', { roomId, team: 'red' });
            io.to(roomId).emit('opponentJoined');
            broadcastRoomList(); // 更新清單
        } else {
            socket.emit('errorMsg', room ? '房間已滿' : '房間不存在');
        }
    });

    // 3. 確認配置
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

    // 4. 遊戲同步 (確保轉發到正確房間)
    socket.on('playerMove', (data) => {
        socket.to(data.roomId).emit('opponentMove', data);
    });

    socket.on('syncState', (data) => {
        socket.to(data.roomId).emit('updateClientState', data);
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
        }
        broadcastRoomList();
    });
});

// 使用環境變數提供的 Port 或預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
