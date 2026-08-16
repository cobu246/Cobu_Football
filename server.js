const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/* =========================================================
   XƏRİTƏLƏR
========================================================= */

const MAPS = {
    '1vs1': { key: '1vs1', width: 1000, height: 600 },
    '3vs3': { key: '3vs3', width: 1200, height: 700 },
    '5vs5': { key: '5vs5', width: 1400, height: 800 },
    '8vs8': { key: '8vs8', width: 1600, height: 900 },
    '11vs11': { key: '11vs11', width: 1800, height: 1000 }
};

const ADMIN_PASSWORD = "admin";

/* =========================================================
   OTAQ SİSTEMİ
========================================================= */

const rooms = {};

const MAX_ROOMS = 10;

let playerNumberCounter = 1;

function generateRoomId() {
    let id;

    do {
        id = Math.random()
            .toString(36)
            .substring(2, 8);

    } while (rooms[id]);

    return id;
}

/* =========================================================
   YENİ OTAQ ÜÇÜN OYUN STATE
========================================================= */

function createGameState() {

    const map = MAPS['5vs5'];

    return {
        players: {},

        ball: {
            x: map.width / 2,
            y: map.height / 2,
            vx: 0,
            vy: 0,
            radius: 10
        },

        score: {
            red: 0,
            blue: 0
        },

        targetScore: 3,
        scoreLimit: 3,

        isPaused: false,

        map: map
    };
}

/* =========================================================
   OTAQ SİYAHISI
========================================================= */

function getRoomList() {

    return Object.values(rooms).map(room => ({

        id: room.id,
        name: room.name,

        hasPassword: !!room.password,

        maxPlayers: room.maxPlayers,

        players: room.players.size

    }));
}

function sendRoomList() {
    io.emit('roomList', getRoomList());
}

/* =========================================================
   OTAQDAN OYUNÇUNU ÇIXAR
========================================================= */

function removePlayerFromRoom(socket) {

    const roomId = socket.roomId;

    if (!roomId || !rooms[roomId]) {

        socket.roomId = null;

        return;
    }

    const room = rooms[roomId];

    room.players.delete(socket.id);

    socket.leave(roomId);

    socket.roomId = null;

    if (room.gameState.players[socket.id]) {

        delete room.gameState.players[socket.id];
    }

    /*
     * Otaq boşdursa sil
     */

    if (room.players.size === 0) {

        delete rooms[roomId];

        console.log(
            `Otaq silindi: ${roomId}`
        );
    }

    sendRoomList();
}

/* =========================================================
   OYUNÇU SPAWN
========================================================= */

function spawnPlayer(player, room) {

    const map = room.gameState.map;

    /*
     * Hər oyunçu otağın öz meydançasının
     * içində spawn olur.
     */

    if (player.team === 'red') {

        player.x =
            Math.max(
                100,
                map.width * 0.25
            );

    } else if (player.team === 'blue') {

        player.x =
            Math.min(
                map.width - 100,
                map.width * 0.75
            );

    } else {

        player.x =
            map.width / 2;
    }

    player.y =
        map.height / 2;

    player.vx = 0;
    player.vy = 0;
}

/* =========================================================
   TOPU RESET
========================================================= */

function resetRoomBall(room) {

    const gameState = room.gameState;

    gameState.ball.x =
        gameState.map.width / 2;

    gameState.ball.y =
        gameState.map.height / 2;

    gameState.ball.vx = 0;
    gameState.ball.vy = 0;

    Object.values(gameState.players)
        .forEach(player => {

            if (player.team !== null) {

                spawnPlayer(player, room);
            }
        });
}

/* =========================================================
   OTAĞIN STATE-İ YALNIZ ÖZ OTAĞINA GÖNDƏR
========================================================= */

function sendRoomState(room) {

    io.to(room.id).emit('state', {

        players: room.gameState.players,

        ball: room.gameState.ball,

        score: room.gameState.score,

        targetScore:
            room.gameState.targetScore,

        scoreLimit:
            room.gameState.scoreLimit,

        isPaused:
            room.gameState.isPaused,

        map:
            room.gameState.map
    });
}

/* =========================================================
   SOCKET
========================================================= */

io.on('connection', (socket) => {

    console.log(
        `Oyunçu qoşuldu: ${socket.id}`
    );

    socket.roomId = null;

    socket.playerNumber =
        playerNumberCounter++;

    socket.emit('welcome', {
        id: socket.id,
        team: null
    });

    /* =====================================================
       NICK
    ===================================================== */

    socket.on('setNick', (name) => {

        name =
            String(name || '')
                .trim();

        if (!name) {

            name = "Oyunçu";
        }

        name =
            name.slice(0, 15);

        socket.nick = name;

        /*
         * Oyunçu artıq otaqdadırsa
         * nick-i dəyiş.
         */

        if (
            socket.roomId &&
            rooms[socket.roomId]
        ) {

            const room =
                rooms[socket.roomId];

            const player =
                room.gameState.players[socket.id];

            if (player) {

                player.name = name;
            }
        }
    });

    /* =====================================================
       OTAQLARI GƏTİR
    ===================================================== */

    socket.on('getRooms', () => {

        socket.emit(
            'roomList',
            getRoomList()
        );
    });

    /* =====================================================
       OTAQ YARAT
    ===================================================== */

    socket.on('createRoom', (data) => {

        data = data || {};

        /*
         * MAX 10 OTAQ
         */

        if (
            Object.keys(rooms).length >=
            MAX_ROOMS
        ) {

            socket.emit(
                'roomError',
                'Maksimum 10 otaq yaradıla bilər.'
            );

            return;
        }

        let name =
            String(data.name || '')
                .trim();

        let password =
            String(data.password || '');

        let maxPlayers =
            Number(data.maxPlayers);

        if (!name) {

            socket.emit(
                'roomError',
                'Otaq adı boş ola bilməz.'
            );

            return;
        }

        name =
            name.slice(0, 25);

        const allowedMaxPlayers = [
            2,
            4,
            6,
            8,
            10,
            12,
            16,
            22
        ];

        if (
            !allowedMaxPlayers.includes(
                maxPlayers
            )
        ) {

            maxPlayers = 22;
        }

        /*
         * Əvvəlki otaqdan çıx
         */

        if (socket.roomId) {

            removePlayerFromRoom(socket);
        }

        const roomId =
            generateRoomId();

        /*
         * OTAĞIN ÖZ OYUN STATE-İ
         */

        rooms[roomId] = {

            id: roomId,

            name: name,

            password: password,

            maxPlayers: maxPlayers,

            players: new Set(),

            gameState:
                createGameState(),

            adminId: null
        };

        const room =
            rooms[roomId];

        room.players.add(
            socket.id
        );

        socket.roomId =
            roomId;

        socket.join(roomId);

        /*
         * OTAĞIN İLK OYUNÇUSU
         * OTAĞIN ADMINI OLUR
         */

        room.adminId =
            socket.id;

        room.gameState.players[
            socket.id
        ] = {

            id: socket.id,

            name:
                socket.nick ||
                "Oyunçu",

            number:
                socket.playerNumber,

            team: null,

            roomId: roomId,

            x:
                room.gameState.map.width /
                2,

            y:
                room.gameState.map.height /
                2,

            vx: 0,
            vy: 0,

            radius: 20,

            speed: 3.5,

            keys: {
                w: false,
                a: false,
                s: false,
                d: false
            },

            isAdmin: true
        };

        socket.emit(
            'roomCreated',
            {
                roomId: roomId,
                password: password
            }
        );

        socket.emit(
            'chatMessage',
            {
                id: 'system-admin',
                name: 'Sistem',
                team: null,
                text: 'Bu otağın admini sənsən.'
            }
        );

        console.log(
            `Yeni otaq: ${name} | ${roomId}`
        );

        sendRoomList();

        sendRoomState(room);
    });

    /* =====================================================
       OTAĞA QOŞUL
    ===================================================== */

    socket.on('joinRoom', (data) => {

        data = data || {};

        const roomId =
            String(data.roomId || '');

        const password =
            String(data.password || '');

        const room =
            rooms[roomId];

        if (!room) {

            socket.emit(
                'roomError',
                'Bu otaq artıq mövcud deyil.'
            );

            return;
        }

        /*
         * DOLULUQ
         */

        if (
            room.players.size >=
            room.maxPlayers
        ) {

            socket.emit(
                'roomError',
                'Bu otaq artıq doludur.'
            );

            return;
        }

        /*
         * ŞİFRƏ
         */

        if (
            room.password !==
            password
        ) {

            socket.emit(
                'roomError',
                'Otaq şifrəsi yanlışdır.'
            );

            return;
        }

        /*
         * BAŞQA OTAQDADIRSA ÇIXAR
         */

        if (
            socket.roomId &&
            socket.roomId !== roomId
        ) {

            removePlayerFromRoom(socket);
        }

        room.players.add(
            socket.id
        );

        socket.roomId =
            roomId;

        socket.join(roomId);

        /*
         * OYUNÇUNU YALNIZ BU OTAĞIN
         * STATE-İNƏ ƏLAVƏ ET
         */

        room.gameState.players[
            socket.id
        ] = {

            id: socket.id,

            name:
                socket.nick ||
                "Oyunçu",

            number:
                socket.playerNumber,

            team: null,

            roomId: roomId,

            x:
                room.gameState.map.width /
                2,

            y:
                room.gameState.map.height /
                2,

            vx: 0,
            vy: 0,

            radius: 20,

            speed: 3.5,

            keys: {
                w: false,
                a: false,
                s: false,
                d: false
            },

            isAdmin:
                room.adminId ===
                socket.id
        };

        socket.emit(
    'joinedRoom',
    {
        roomId: roomId,
        roomName: room.name,
        players: room.players.size,
        maxPlayers: room.maxPlayers,

        // Otağı yaradan şəxs üçün true
        isAdmin: room.adminId === socket.id
    }
);

        console.log(
            `${socket.nick || 'Oyunçu'} ` +
            `"${room.name}" otağına qoşuldu ` +
            `(${room.players.size}/${room.maxPlayers})`
        );

        sendRoomList();

        sendRoomState(room);
    });

    /* =====================================================
       KOMANDA DƏYİŞ
    ===================================================== */

    socket.on('changeTeam', (team) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (!player) return;

        if (
            team !== 'red' &&
            team !== 'blue' &&
            team !== null
        ) return;

        player.team =
            team;

        spawnPlayer(
            player,
            room
        );

        sendRoomState(room);
    });

    /* =====================================================
       KLAVİATURA
    ===================================================== */

    socket.on('keys', (keys) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (!player) return;

        player.keys = {

            w: !!keys?.w,
            a: !!keys?.a,
            s: !!keys?.s,
            d: !!keys?.d

        };
    });

    /* =====================================================
       ZƏRBƏ
    ===================================================== */

    socket.on('kick', (data) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const gameState =
            room.gameState;

        const player =
            gameState.players[
                socket.id
            ];

        if (
            !player ||
            player.team === null ||
            gameState.isPaused
        ) return;

        const ball =
            gameState.ball;

        const dx =
            ball.x - player.x;

        const dy =
            ball.y - player.y;

        const dist =
            Math.hypot(dx, dy);

        if (
            dist <
            player.radius +
            ball.radius +
            22
        ) {

            let charge =
                data &&
                data.charge !== undefined
                    ? Number(data.charge)
                    : 0.5;

            charge =
                Math.max(
                    0,
                    Math.min(
                        1,
                        charge
                    )
                );

            const power =
                15 +
                charge * 35;

            const angle =
                Math.atan2(
                    dy,
                    dx
                );

            ball.vx =
                Math.cos(angle) *
                power +
                player.vx *
                0.8;

            ball.vy =
                Math.sin(angle) *
                power +
                player.vy *
                0.8;
        }
    });

    /* =====================================================
       CHAT
    ===================================================== */

    socket.on('chatMessage', (text) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (!player) return;

        text =
            String(text || '')
                .slice(0, 60);

        /*
         * YALNIZ BU OTAĞA GÖNDƏR
         */

        io.to(room.id).emit(
            'chatMessage',
            {
                id: socket.id,

                name:
                    player.name ||
                    "Oyunçu",

                team:
                    player.team,

                text: text
            }
        );
    });

    /* =====================================================
       ADMIN
    ===================================================== */

    socket.on('claimAdmin', (data) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (!player) return;

        /*
         * Otağın yaradıcısı artıq admindir.
         */

        if (
            room.adminId ===
            socket.id
        ) {

            player.isAdmin = true;

            socket.emit(
                'adminResult',
                {
                    success: true,
                    message:
                        'Sən artıq bu otağın adminisən!'
                }
            );

            return;
        }

        /*
         * İkinci admin olmaq üçün
         * admin şifrəsi
         */

        if (
            data &&
            data.password ===
            ADMIN_PASSWORD
        ) {

            player.isAdmin = true;

            socket.emit(
                'adminResult',
                {
                    success: true,
                    message:
                        'Admin hüququ verildi!'
                }
            );

        } else {

            socket.emit(
                'adminResult',
                {
                    success: false,
                    message:
                        'Yanlış şifrə!'
                }
            );
        }
    });

    /* =====================================================
       ADMIN PAUSE
    ===================================================== */

    socket.on('adminTogglePause', () => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (
            player?.isAdmin
        ) {

            room.gameState.isPaused =
                !room.gameState.isPaused;

            sendRoomState(room);
        }
    });

    /* =====================================================
       ADMIN MAP
    ===================================================== */

    socket.on('adminSelectMap', (mapKey) => {

        if (
            !socket.roomId ||
            !rooms[socket.roomId]
        ) return;

        const room =
            rooms[socket.roomId];

        const player =
            room.gameState.players[
                socket.id
            ];

        if (
            !player?.isAdmin
        ) return;

        if (!MAPS[mapKey]) return;

        /*
         * YALNIZ BU OTAĞIN MAP-I DƏYİŞİR
         */

        room.gameState.map =
            MAPS[mapKey];

        resetRoomBall(room);

        sendRoomState(room);
    });

    /* =====================================================
       SCORE LIMIT
    ===================================================== */

    socket.on(
        'adminChangeScoreLimit',
        (amount) => {

            if (
                !socket.roomId ||
                !rooms[socket.roomId]
            ) return;

            const room =
                rooms[socket.roomId];

            const player =
                room.gameState.players[
                    socket.id
                ];

            if (
                !player?.isAdmin
            ) return;

            room.gameState.targetScore =
                Math.max(
                    1,
                    room.gameState.targetScore +
                    Number(amount || 0)
                );

            room.gameState.scoreLimit =
                room.gameState.targetScore;

            sendRoomState(room);
        }
    );

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on('disconnect', () => {

        console.log(
            `Oyunçu ayrıldı: ${socket.id}`
        );

        removePlayerFromRoom(socket);
    });
});

/* =========================================================
   OYUN LOOP
   HƏR OTAQ AYRI İŞLƏYİR
========================================================= */

setInterval(() => {

    Object.values(rooms)
        .forEach(room => {

            updateRoom(room);

        });

}, 1000 / 60);

/* =========================================================
   OTAĞIN OYUNU
========================================================= */

function updateRoom(room) {

    const gameState =
        room.gameState;

    if (
        gameState.isPaused
    ) {

        sendRoomState(room);

        return;
    }

    const map =
        gameState.map;

    const players =
        Object.values(
            gameState.players
        );

    /* =====================================================
       1. OYUNÇU HƏRƏKƏTİ
    ===================================================== */

    players.forEach(p => {

        if (p.team === null)
            return;

        let dx = 0;
        let dy = 0;

        if (p.keys.w)
            dy -= 1;

        if (p.keys.s)
            dy += 1;

        if (p.keys.a)
            dx -= 1;

        if (p.keys.d)
            dx += 1;

        if (
            dx !== 0 &&
            dy !== 0
        ) {

            dx *= 0.7071;
            dy *= 0.7071;
        }

        const acceleration =
            0.6;

        const friction =
            0.950;

        if (
            dx !== 0 ||
            dy !== 0
        ) {

            p.vx +=
                dx *
                acceleration;

            p.vy +=
                dy *
                acceleration;
        }

        p.vx *= friction;
        p.vy *= friction;

        const currentSpeed =
            Math.hypot(
                p.vx,
                p.vy
            );

        if (
            currentSpeed >
            p.speed
        ) {

            p.vx =
                (p.vx /
                    currentSpeed) *
                p.speed;

            p.vy =
                (p.vy /
                    currentSpeed) *
                p.speed;
        }

        p.x += p.vx;
        p.y += p.vy;

        p.x =
            Math.max(
                p.radius + 20,
                Math.min(
                    map.width -
                    p.radius -
                    20,
                    p.x
                )
            );

        p.y =
            Math.max(
                p.radius + 20,
                Math.min(
                    map.height -
                    p.radius -
                    20,
                    p.y
                )
            );
    });

    /* =====================================================
       2. OYUNÇU TOQQUŞMASI
    ===================================================== */

    const activePlayers =
        players.filter(
            p => p.team !== null
        );

    for (
        let i = 0;
        i < activePlayers.length;
        i++
    ) {

        for (
            let j = i + 1;
            j < activePlayers.length;
            j++
        ) {

            const p1 =
                activePlayers[i];

            const p2 =
                activePlayers[j];

            const dx =
                p2.x - p1.x;

            const dy =
                p2.y - p1.y;

            const dist =
                Math.hypot(
                    dx,
                    dy
                );

            const minDist =
                p1.radius +
                p2.radius;

            if (
                dist < minDist &&
                dist > 0
            ) {

                const overlap =
                    minDist -
                    dist;

                const angle =
                    Math.atan2(
                        dy,
                        dx
                    );

                p1.x -=
                    Math.cos(angle) *
                    (overlap / 2);

                p1.y -=
                    Math.sin(angle) *
                    (overlap / 2);

                p2.x +=
                    Math.cos(angle) *
                    (overlap / 2);

                p2.y +=
                    Math.sin(angle) *
                    (overlap / 2);
            }
        }
    }

    /* =====================================================
       3. TOP
    ===================================================== */

    const b =
        gameState.ball;

    b.x += b.vx;
    b.y += b.vy;

    b.vx *= 0.950;
    b.vy *= 0.950;

    /* =====================================================
       SOL QAPI
    ===================================================== */

    if (
        b.x -
        b.radius <
        20
    ) {

        if (
            b.y >
            map.height / 2 - 90 &&
            b.y <
            map.height / 2 + 90
        ) {

            gameState.score.blue++;

            if (
                gameState.score.blue >=
                gameState.targetScore
            ) {

                io.to(room.id).emit(
                    'gameOver',
                    {
                        winner: 'blue'
                    }
                );

                gameState.score = {
                    red: 0,
                    blue: 0
                };

            } else {

                io.to(room.id).emit(
                    'goal',
                    {
                        scorer: 'blue'
                    }
                );
            }

            resetRoomBall(room);

        } else {

            b.x =
                20 +
                b.radius;

            b.vx *= -0.7;
        }
    }

    /* =====================================================
       SAĞ QAPI
    ===================================================== */

    if (
        b.x +
        b.radius >
        map.width - 20
    ) {

        if (
            b.y >
            map.height / 2 - 90 &&
            b.y <
            map.height / 2 + 90
        ) {

            gameState.score.red++;

            if (
                gameState.score.red >=
                gameState.targetScore
            ) {

                io.to(room.id).emit(
                    'gameOver',
                    {
                        winner: 'red'
                    }
                );

                gameState.score = {
                    red: 0,
                    blue: 0
                };

            } else {

                io.to(room.id).emit(
                    'goal',
                    {
                        scorer: 'red'
                    }
                );
            }

            resetRoomBall(room);

        } else {

            b.x =
                map.width -
                20 -
                b.radius;

            b.vx *= -0.7;
        }
    }

    /* =====================================================
       YUXARI / AŞAĞI DIVAR
    ===================================================== */

    if (
        b.y -
        b.radius <
        20
    ) {

        b.y =
            20 +
            b.radius;

        b.vy *= -0.7;
    }

    if (
        b.y +
        b.radius >
        map.height - 20
    ) {

        b.y =
            map.height -
            20 -
            b.radius;

        b.vy *= -0.7;
    }

    /* =====================================================
       4. OYUNÇU - TOP
    ===================================================== */

    activePlayers.forEach(p => {

        const dist =
            Math.hypot(
                b.x - p.x,
                b.y - p.y
            );

        if (
            dist <
            p.radius +
            b.radius
        ) {

            const angle =
                Math.atan2(
                    b.y - p.y,
                    b.x - p.x
                );

            const overlap =
                p.radius +
                b.radius -
                dist;

            b.x +=
                Math.cos(angle) *
                overlap;

            b.y +=
                Math.sin(angle) *
                overlap;

            b.vx =
                b.vx * 0.4 +
                p.vx * 0.5 +
                Math.cos(angle);

            b.vy =
                b.vy * 0.4 +
                p.vy * 0.5 +
                Math.sin(angle);
        }
    });

    /*
     * YALNIZ BU OTAĞA STATE
     */

    sendRoomState(room);
}

/* =========================================================
   SERVER
========================================================= */

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {

        console.log(
            `Server işləyir: http://localhost:${PORT}`
        );

    }
);