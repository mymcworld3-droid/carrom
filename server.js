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
