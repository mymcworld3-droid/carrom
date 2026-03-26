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
            //🔥 立即回傳狀態：讓前端知道伺服器正在處理
            socket.emit('aiStatus', '正在進行物理運算與策略規劃...');

            //🔥 檢查 API Key 是否存在
            if (!process.env.GEMINI_API_KEY) {
                throw new Error("伺服器遺失 GEMINI_API_KEY！請至 Render 後台設定 Environment Variables。");
            }

            //🔥 大幅強化的物理與規則 Prompt
            const prompt = `
            你是一個正在玩物理克朗棋 (Carrom) 的專業 AI。你是上方玩家 (Player 2)。
            你的目標是將【白棋】打進球洞。請以最快速度給出最佳打擊參數。

            【物理引擎與棋盤參數】
            - 棋盤大小：600x600，無重力俯視圖。
            - 邊界牆壁：彈性(restitution)=0.6，無摩擦力。
            - 球洞座標：左上(30,30)、右上(570,30)、左下(30,570)、右下(570,570)。進洞判定為與球洞中心距離 < 25。
            - 打擊子(Striker)：半徑=20，質量(mass)=15，彈性=0.6，空氣阻力=0.008，摩擦力=0.01。
            - 目標棋子(Puck)：半徑=12，質量(mass)=5，彈性=0.8，空氣阻力=0.004，摩擦力=0.01。
            *(注意：打擊子質量是棋子的3倍，撞擊後動能傳遞非常強烈)*

            【你的操作限制】
            1. 你的打擊子必須擺在發球線上 (Y=120)，可決定的 X 座標範圍為 120 到 480。
            2. 你往下方擊球，所以施力方向 forceY 必須大於 0。
            3. 總施力向量大小 sqrt(forceX^2 + forceY^2) 絕對不可超過 0.8。

            【嚴格比賽規則 (重要!)】
            1. 首要目標：把白棋打進任何一個球洞。
            2. 犯規避讓：若你還有白棋在場上，【絕對不能】把紅色的皇后(Queen)打進洞，否則視為犯規並罰球。
            3. 母球洗澡：【絕對不能】讓你的打擊子(Striker)掉進球洞，否則會喪失球權並罰球。
            
            【目前盤面狀態】
            - 剩餘白棋座標：${JSON.stringify(gameState.whitePucks)}
            - 黑棋座標 (障礙物)：${JSON.stringify(gameState.blackPucks)}
            - 皇后座標：${JSON.stringify(gameState.queen)}

            請運用幾何反射角與質量推算，找出最安全的進球路徑。請以最快的速度回傳，越快越好。
            嚴格只回傳 JSON 格式如下，不要包含 Markdown 標籤(\`\`\`json)或其他任何文字：
            {"strikerX": 300, "forceX": 0.05, "forceY": 0.5}
            `;

            //🔥 呼叫你擁有的 gemini-2.5-flash 模型
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash', //🔥 修改為你清單中有的 2.5 flash
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            //🔥 思考完畢，準備回傳動作
            socket.emit('aiStatus', '計算完成！準備出桿...');

            const move = JSON.parse(response.text);
            socket.emit('aiMove', move);
        } catch (error) {
            console.error("AI 錯誤，採用隨機打擊:", error);
            
            //🔥 將具體的錯誤訊息傳送給前端畫面
            socket.emit('aiError', `AI 發生錯誤: ${error.message}`);
            
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
