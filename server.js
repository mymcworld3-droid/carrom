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
            socket.emit('aiStatus', '系統雷達掃描與策略規劃中...');

            //🔥 檢查 API Key 是否存在
            if (!process.env.GROQ_API_KEY) {
                throw new Error("伺服器遺失 GROQ_API_KEY！請至 Render 後台設定 Environment Variables。");
            }

            //🔥 新增：系統幾何雷達 (替 AI 預先算好基礎數學，解決語言模型缺乏空間幾何概念的問題)
            let mathHint = "目前無明顯建議";
            if (gameState.whitePucks.length > 0) {
                // 找出離底部兩個洞最近的白棋
                let target = gameState.whitePucks[0];
                let minDist = 9999;
                let targetPocketX = 30; // 預設瞄準左下洞
                for (let p of gameState.whitePucks) {
                    let dLeft = Math.sqrt(Math.pow(p.x - 30, 2) + Math.pow(p.y - 570, 2));
                    let dRight = Math.sqrt(Math.pow(p.x - 570, 2) + Math.pow(p.y - 570, 2));
                    if (dLeft < minDist) { minDist = dLeft; target = p; targetPocketX = 30; }
                    if (dRight < minDist) { minDist = dRight; target = p; targetPocketX = 570; }
                }
                
                // 簡單的物理反向瞄準推算 (撞擊反射角)
                let offset = target.x > targetPocketX ? 15 : -15; // 若洞在左邊，打擊子要偏右打切角
                let suggestedX = target.x + offset;
                suggestedX = Math.max(120, Math.min(480, suggestedX)); // 限制在合法發球區
                
                let suggestedForceX = targetPocketX === 30 ? -0.2 : 0.2; // 洞在左邊就往左打
                
                mathHint = `【系統雷達提示】最容易進洞的白棋在 (${target.x}, ${target.y})，目標是 ${targetPocketX === 30 ? '左下' : '右下'} 洞。建議 strikerX 擺在 ${Math.round(suggestedX)}，forceX 給 ${suggestedForceX}，forceY 給 0.5。`;
            }

            //🔥 將數學輔助結果餵給 Groq Prompt
            const prompt = `
            你是一個正在玩物理克朗棋 (Carrom) 的專業 AI。你是上方玩家 (Player 2)。
            你的目標是將【白棋】打進球洞。

            【物理引擎與限制】
            - 發球線限制：strikerX 必須在 120 到 480 之間。往下打 forceY 必須 > 0。
            
            ${mathHint}

            【目前盤面狀態】
            - 白棋：${JSON.stringify(gameState.whitePucks)}
            - 黑棋 (障礙物)：${JSON.stringify(gameState.blackPucks)}
            - 皇后：${JSON.stringify(gameState.queen)}

            【思考與決策】
            請先參考【系統雷達提示】，並檢查該瞄準路徑上是否有黑棋或皇后擋住。
            如果有阻擋，請微調 strikerX 或改打其他白棋。如果沒有，請直接採用系統建議。
            嚴格只回傳 JSON 格式如下：
            {
              "reasoning": "我決定採用系統建議，因為路徑無阻擋... / 我微調了位置，因為...",
              "strikerX": 250,
              "forceX": -0.2,
              "forceY": 0.5
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
                temperature: 0.4 // 稍微調低以保持精準度
            });

            //🔥 思考完畢，準備回傳動作
            socket.emit('aiStatus', '計算完成！準備出桿...');

            const move = JSON.parse(chatCompletion.choices[0].message.content);
            console.log("AI 思考邏輯:", move.reasoning); // 在後台印出 AI 的腦內思考
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
