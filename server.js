const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config(); //🔥 載入環境變數

//🔥 初始化 Gemini AI
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
const server = http.createServer(app);

// 允許跨域請求 (Render 部署需要)
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// 指定靜態檔案目錄
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('玩家已連線:', socket.id);

    // 簡單的房間管理
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        console.log(`玩家 ${socket.id} 加入了房間 ${roomId}`);
    });

    // 接收擊球數據並廣播
    socket.on('strike', (data) => {
        socket.broadcast.emit('opponentStrike', data);
    });

    // 接收狀態同步數據並廣播給其他人
    socket.on('syncState', (state) => {
        socket.broadcast.emit('syncState', state);
    });

    //🔥 接收前端請求 AI 進行回合
    socket.on('requestAIMove', async (gameState) => {
        try {
            const prompt = `
            你是一個正在玩克朗棋 (Carrom) 的對手。你是上方玩家 (Player 2)。你的目標是把【白棋】打進球洞。
            棋盤大小是 600x600。
            球洞座標在四個角落：(30,30), (570,30), (30,570), (570,570)。
            你的發球線(Striker)被固定在 Y=120。你可以決定的 X 座標範圍是 120 到 480。
            你的打擊力度最大不可超過 0.8。因為你往下方打，所以 forceY 必須大於 0。
            
            目前盤面狀態：
            目標白棋座標：${JSON.stringify(gameState.whitePucks)}
            障礙黑棋座標：${JSON.stringify(gameState.blackPucks)}
            皇后座標：${JSON.stringify(gameState.queen)}
            
            請計算出最佳的打擊方式，並嚴格只回傳 JSON 格式如下，不要有任何多餘文字：
            {"strikerX": 300, "forceX": 0.05, "forceY": 0.5}
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            const move = JSON.parse(response.text);
            socket.emit('aiMove', move);
        } catch (error) {
            console.error("AI 錯誤，採用隨機打擊:", error);
            // 發生錯誤時的隨機備用動作
            socket.emit('aiMove', { 
                strikerX: 300, 
                forceX: (Math.random() - 0.5) * 0.2, 
                forceY: 0.5 
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('玩家已斷線:', socket.id);
    });
});

// 使用 Render 提供的 PORT，若無則預設 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器執行於 Port: ${PORT}`);
});
