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
    // 進入連線大廳時獲取清單
    socket.on('getRooms', () => {
        broadcastRoomList(io);
    });

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

    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length < 2) {
            room.players.push({ id: socket.id, team: 'red', ready: false, config: [] });
            socket.join(roomId);
            socket.emit('roomJoined', { 
                roomId, 
                team: 'red', 
                opponentConfig: room.players[0].config 
            });
            // 告知房主對手加入了，並把目前的配置傳給房主
            socket.to(roomId).emit('opponentJoined', { team: 'red' });
            broadcastRoomList(io);
        } else {
            socket.emit('errorMsg', room ? '房間已滿' : '房間不存在');
        }
    });

    // 🔥 新增：即時同步選擇狀態
    socket.on('updateSelection', (data) => {
        const { roomId, config } = data;
        const room = rooms[roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) player.config = config;
            // 廣播給房間內其他人
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

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const index = rooms[id].players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                rooms[id].players.splice(index, 1);
                if (rooms[id].players.length === 0) {
                    delete rooms[id];
                } else {
                    io.to(id).emit('opponentLeft');
                }
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
