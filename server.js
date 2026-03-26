const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config(); //🔥 載入環境變數

//🔥 初始化 Groq AI
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
            if (!process.env.GROQ_API_KEY) {
                throw new Error("伺服器遺失 GROQ_API_KEY！請至 Render 後台設定 Environment Variables。");
            }

            //🔥 大幅強化的 Prompt：加入思考步驟 (Chain of Thought)
            const prompt = `
            你是一個正在玩物理克朗棋 (Carrom) 的專業 AI。你是上方玩家 (Player 2)。
            你的目標是將【白棋】打進球洞。請分析盤面並給出最聰明的打擊參數。

            【物理引擎與棋盤參數】
            - 棋盤大小：600x600，無重力俯視圖。
            - 邊界牆壁：彈性(restitution)=0.6，無摩擦力。
            - 左下球洞：(30,570)，右下球洞：(570,570)。進洞判定為距離 < 25。
            - 打擊子(Striker)：被限制在發球線 Y=120，X可選範圍 120 到 480。最大總力道 0.8。往下打 forceY 必須 > 0。

            【嚴格比賽規則】
            1. 首要目標：把白棋打進任何一個球洞。
            2. 犯規避讓：若你還有白棋在場上，絕對不能把紅色的皇后(Queen)打進洞。
            3. 母球洗澡：絕對不能讓你的打擊子(Striker)掉進球洞。
            
            【目前盤面狀態】
            - 剩餘白棋座標：${JSON.stringify(gameState.whitePucks)}
            - 黑棋座標 (障礙物)：${JSON.stringify(gameState.blackPucks)}
            - 皇后座標：${JSON.stringify(gameState.queen)}

            【重要思考步驟】
            請你在回傳 JSON 前，先在 "reasoning" 欄位中進行以下思考：
            1. 挑選目標：哪一顆白棋離左下(30,570)或右下(570,570)最近且路徑沒有被黑棋擋住？
            2. 定位母球：打擊子(Striker)的 X 座標應該擺在哪裡，才能與目標白棋形成最佳撞擊角度？
            3. 力道計算：forceX (左右，可為正負值) 與 forceY (向下，必須大於0) 該給多少？如果目標在左邊，forceX為負；在右邊，forceX為正。

            嚴格只回傳 JSON 格式如下，必須是有效的 JSON object，不要有其他廢話：
            {
              "reasoning": "我觀察到座標(x,y)的白棋離左下角球洞最近，且無黑棋阻擋。我將打擊子擺在 X=...，並施加向左下方的力道。",
              "strikerX": 250,
              "forceX": -0.25,
              "forceY": 0.6
            }
            `;

            //🔥 呼叫 Groq API，開啟 json_object 模式確保格式正確
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "你是一個專業的物理運算 AI，請嚴格輸出包含 reasoning 的 JSON 格式。"
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" },
                temperature: 0.7 //🔥 提高溫度：讓 AI 變得更靈活、更願意嘗試不同角度的球
            });

            // 解析 AI 的回應
            const move = JSON.parse(chatCompletion.choices[0].message.content);
            
            //🔥 將 AI 的思考過程列印在伺服器端 (或者你也可以透過 emit 傳給前端看)
            console.log("AI 思考邏輯:", move.reasoning);

            //🔥 思考完畢，準備回傳動作
            socket.emit('aiStatus', '計算完成！準備出桿...');

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
