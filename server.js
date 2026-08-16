const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAPS = {
    '1vs1': { key: '1vs1', width: 1000, height: 600 },
    '3vs3': { key: '3vs3', width: 1200, height: 700 },
    '5vs5': { key: '5vs5', width: 1400, height: 800 },
    '8vs8': { key: '8vs8', width: 1600, height: 900 },
    '11vs11': { key: '11vs11', width: 1800, height: 1000 }
};

let currentMapKey = '5vs5';
let activeMap = MAPS[currentMapKey];

let gameState = {
    players: {},
    ball: {
        x: activeMap.width / 2,
        y: activeMap.height / 2,
        vx: 0,
        vy: 0,
        radius: 10
    },
    score: { red: 0, blue: 0 },
    targetScore: 3, // Qələbə üçün lazım olan qol sayı (varsayılan: 3)
    scoreLimit: 3,  // Frontend ilə tam uyğunluq üçün
    isPaused: false,
    map: activeMap
};

let playerNumberCounter = 1;
const ADMIN_PASSWORD = "admin";

io.on('connection', (socket) => {
    console.log(`Oyunçu qoşuldu: ${socket.id}`);

    gameState.players[socket.id] = {
        id: socket.id,
        name: "Oyunçu",
        number: playerNumberCounter++,
        team: null, // Əvvəlcə izləyici kimi qoşulur
        x: activeMap.width / 2,
        y: activeMap.height / 2,
        vx: 0,
        vy: 0,
        radius: 20,
        speed: 3.5,
        keys: { w: false, a: false, s: false, d: false },
        isAdmin: false
    };

    socket.emit('welcome', { id: socket.id, team: null });

    // Nick (Ad) qəbul edilməsi
    socket.on('setNick', (name) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.name = name.slice(0, 15); // Maksimum 15 simvol
        }
    });

    socket.on('changeTeam', (team) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        player.team = team; // 'red', 'blue' və ya null (izləyici)
        player.x = activeMap.width / 2;
        player.y = activeMap.height / 2;
        player.vx = 0;
        player.vy = 0;
    });

    socket.on('keys', (keys) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.keys = keys;
        }
    });

    socket.on('kick', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.team === null || gameState.isPaused) return;

        const dx = gameState.ball.x - player.x;
        const dy = gameState.ball.y - player.y;
        const dist = Math.hypot(dx, dy);

        if (dist < player.radius + gameState.ball.radius + 22) {
            let charge = data.charge !== undefined ? data.charge : 0.5;
            const power = 15 + (charge * 35); 

            const angle = Math.atan2(dy, dx);
            gameState.ball.vx = Math.cos(angle) * power + (player.vx * 0.8);
            gameState.ball.vy = Math.sin(angle) * power + (player.vy * 0.8);
        }
    });

    socket.on('chatMessage', (text) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        io.emit('chatMessage', {
            id: socket.id,
            name: player.name || "Oyunçu",
            team: player.team,
            text: text.slice(0, 60)
        });
    });

    socket.on('claimAdmin', (data) => {
        if (data.password === ADMIN_PASSWORD) {
            gameState.players[socket.id].isAdmin = true;
            socket.emit('adminResult', { success: true, message: 'Admin hüququ verildi!' });
        } else {
            socket.emit('adminResult', { success: false, message: 'Yanlış şifrə!' });
        }
    });

    socket.on('adminTogglePause', () => {
        if (gameState.players[socket.id]?.isAdmin) {
            gameState.isPaused = !gameState.isPaused;
        }
    });

    socket.on('adminSelectMap', (mapKey) => {
        if (gameState.players[socket.id]?.isAdmin && MAPS[mapKey]) {
            currentMapKey = mapKey;
            activeMap = MAPS[mapKey];
            gameState.map = activeMap;
            resetBallAndPlayers();
        }
    });

    socket.on('adminChangeTargetScore', (amount) => {
        if (gameState.players[socket.id]?.isAdmin) {
            gameState.targetScore = Math.max(1, gameState.targetScore + amount);
            gameState.scoreLimit = gameState.targetScore;
        }
    });

    socket.on('adminChangeScoreLimit', (amount) => {
        if (gameState.players[socket.id]?.isAdmin) {
            gameState.targetScore = Math.max(1, (gameState.targetScore || 3) + amount);
            gameState.scoreLimit = gameState.targetScore;
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        console.log(`Oyunçu ayrıldı: ${socket.id}`);
    });
});

function resetBallAndPlayers() {
    gameState.ball.x = activeMap.width / 2;
    gameState.ball.y = activeMap.height / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;

    Object.values(gameState.players).forEach(p => {
        if (p.team !== null) {
            p.x = activeMap.width / 2;
            p.y = activeMap.height / 2;
            p.vx = 0;
            p.vy = 0;
        }
    });
}

setInterval(() => {
    if (!gameState.isPaused) {
        // 1. Oyunçuların hərəkəti, sürətlənməsi və sürtünməsi
        Object.values(gameState.players).forEach(p => {
            if (p.team !== null) {
                let dx = 0, dy = 0;
                if (p.keys.w) dy -= 1;
                if (p.keys.s) dy += 1;
                if (p.keys.a) dx -= 1;
                if (p.keys.d) dx += 1;

                if (dx !== 0 && dy !== 0) {
                    dx *= 0.7071;
                    dy *= 0.7071;
                }

                const acceleration = 0.6;
                const friction = 0.950;

                if (dx !== 0 || dy !== 0) {
                    p.vx += dx * acceleration;
                    p.vy += dy * acceleration;
                }

                p.vx *= friction;
                p.vy *= friction;

                let currentSpeed = Math.hypot(p.vx, p.vy);
                if (currentSpeed > p.speed) {
                    p.vx = (p.vx / currentSpeed) * p.speed;
                    p.vy = (p.vy / currentSpeed) * p.speed;
                }

                p.x += p.vx;
                p.y += p.vy;

                p.x = Math.max(p.radius + 20, Math.min(activeMap.width - p.radius - 20, p.x));
                p.y = Math.max(p.radius + 20, Math.min(activeMap.height - p.radius - 20, p.y));
            }
        });

        // 2. OYUNÇULARIN İÇ-İÇƏ GİRMƏMƏSİ VƏ ÇƏTİN İTƏLƏNMƏ MƏNTİQİ
        const activePlayers = Object.values(gameState.players).filter(p => p.team !== null);
        for (let i = 0; i < activePlayers.length; i++) {
            for (let j = i + 1; j < activePlayers.length; j++) {
                const p1 = activePlayers[i];
                const p2 = activePlayers[j];

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.hypot(dx, dy);
                const minDist = p1.radius + p2.radius;

                if (dist < minDist && dist > 0) {
                    const overlap = minDist - dist;
                    const angle = Math.atan2(dy, dx);

                    p1.x -= Math.cos(angle) * (overlap / 2);
                    p1.y -= Math.sin(angle) * (overlap / 2);
                    p2.x += Math.cos(angle) * (overlap / 2);
                    p2.y += Math.sin(angle) * (overlap / 2);

                    const pushStrength = 0.03; 
                    const tempVx = p1.vx;
                    const tempVy = p1.vy;
                    p1.vx = p1.vx * (1 - pushStrength) + p2.vx * pushStrength;
                    p1.vy = p1.vy * (1 - pushStrength) + p2.vy * pushStrength;
                    p2.vx = p2.vx * (1 - pushStrength) + tempVx * pushStrength;
                    p2.vy = p2.vy * (1 - pushStrength) + tempVy * pushStrength;
                }
            }
        }

        // 3. Topun hərəkəti və divarlarla toqquşması
        gameState.ball.x += gameState.ball.vx;
        gameState.ball.y += gameState.ball.vy;
        gameState.ball.vx *= 0.950; 
        gameState.ball.vy *= 0.950;

        const b = gameState.ball;
        if (b.x - b.radius < 20) {
            if (b.y > activeMap.height / 2 - 90 && b.y < activeMap.height / 2 + 90) {
                gameState.score.blue++;
                
                if (gameState.score.blue >= gameState.targetScore) {
                    io.emit('gameOver', { winner: 'blue' });
                    gameState.score = { red: 0, blue: 0 };
                } else {
                    io.emit('goal', { scorer: 'blue' });
                }
                resetBallAndPlayers();
            } else {
                b.x = 20 + b.radius;
                b.vx *= -0.7;
            }
        }
        if (b.x + b.radius > activeMap.width - 20) {
            if (b.y > activeMap.height / 2 - 90 && b.y < activeMap.height / 2 + 90) {
                gameState.score.red++;
                
                if (gameState.score.red >= gameState.targetScore) {
                    io.emit('gameOver', { winner: 'red' });
                    gameState.score = { red: 0, blue: 0 };
                } else {
                    io.emit('goal', { scorer: 'red' });
                }
                resetBallAndPlayers();
            } else {
                b.x = activeMap.width - 20 - b.radius;
                b.vx *= -0.7;
            }
        }
        if (b.y - b.radius < 20) { b.y = 20 + b.radius; b.vy *= -0.7; }
        if (b.y + b.radius > activeMap.height - 20) { b.y = activeMap.height - 20 - b.radius; b.vy *= -0.7; }

        // 4. Oyunçu ilə topun toqquşması
        Object.values(gameState.players).forEach(p => {
            if (p.team === null) return;
            const dist = Math.hypot(b.x - p.x, b.y - p.y);
            if (dist < p.radius + b.radius) {
                const angle = Math.atan2(b.y - p.y, b.x - p.x);
                const overlap = (p.radius + b.radius) - dist;
                
                b.x += Math.cos(angle) * overlap;
                b.y += Math.sin(angle) * overlap;

                const pushFactor = 0.5;
                b.vx = b.vx * 0.4 + p.vx * pushFactor + Math.cos(angle) * 1;
                b.vy = b.vy * 0.4 + p.vy * pushFactor + Math.sin(angle) * 1;
            }
        });
    }

    io.emit('state', {
        players: gameState.players,
        ball: gameState.ball,
        score: gameState.score,
        targetScore: gameState.targetScore,
        scoreLimit: gameState.scoreLimit,
        isPaused: gameState.isPaused,
        map: gameState.map
    });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server işləyir: http://localhost:${PORT}`);
});
