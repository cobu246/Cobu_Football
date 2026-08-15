const http = require("http");
const fs = require("fs");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const WIDTH = 1400;
const HEIGHT = 800;

const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 3.8;
const BALL_RADIUS = 11;

const BALL_DISTANCE =
    PLAYER_RADIUS +
    BALL_RADIUS +
    6;

const KICK_POWER = 40;
const MIN_KICK_POWER = 10;

const MAX_PLAYERS_PER_TEAM = 11;

const players = {};

const teams = {
    red: [],
    blue: []
};

const sockets = {};

let score = {
    red: 0,
    blue: 0
};

let scoreResetTimer = null;

let ball = {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: 0,
    vy: 0,
    owner: null,
    radius: BALL_RADIUS,

    lastHitPlayer: null,
    lastHitTime: 0
};


// ========================================
// SERVER
// ========================================

const server = http.createServer((req, res) => {

    if (
        req.url === "/" ||
        req.url === "/index.html"
    ) {

        const html = fs.readFileSync(
            "index.html",
            "utf8"
        );

        res.writeHead(200, {
            "Content-Type":
                "text/html; charset=UTF-8"
        });

        res.end(html);

        return;
    }

    res.writeHead(404);
    res.end("404");
});

const io = new Server(server);


// ========================================
// FORMASİYA
// ========================================

const formation = [

    {
        role: "GK",
        x: 80,
        y: 400
    },

    {
        role: "DF",
        x: 280,
        y: 150
    },

    {
        role: "DF",
        x: 280,
        y: 365
    },

    {
        role: "DF",
        x: 280,
        y: 585
    },

    {
        role: "DF",
        x: 280,
        y: 650
    },

    {
        role: "MF",
        x: 520,
        y: 150
    },

    {
        role: "MF",
        x: 520,
        y: 365
    },

    {
        role: "MF",
        x: 520,
        y: 585
    },

    {
        role: "MF",
        x: 520,
        y: 650
    },

    {
        role: "ST",
        x: 760,
        y: 300
    },

    {
        role: "ST",
        x: 760,
        y: 500
    }
];


// ========================================
// OYUNU TAM SIFIRLA
// ========================================

function fullResetGame() {

    score.red = 0;
    score.blue = 0;

    ball.x = WIDTH / 2;
    ball.y = HEIGHT / 2;

    ball.vx = 0;
    ball.vy = 0;

    ball.owner = null;

    ball.lastHitPlayer = null;
    ball.lastHitTime = 0;

    for (const id in players) {

        const player =
            players[id];

        player.x =
            player.homeX;

        player.y =
            player.homeY;

        player.keys = {
            w: false,
            a: false,
            s: false,
            d: false
        };

        player.kick = false;
    }
}


// ========================================
// OYUNÇU YARAT
// ========================================

function createPlayer(socketId, team) {

    if (
        teams[team].length >=
        MAX_PLAYERS_PER_TEAM
    ) {
        return null;
    }

    const index =
        teams[team].length;

    const f =
        formation[index];

    let x = f.x;

    if (team === "blue") {

        x =
            WIDTH -
            f.x;
    }

    const id = socketId;

    players[id] = {

        id: id,

        socketId: socketId,

        team: team,

        role: f.role,

        number: index + 1,

        x: x,

        y: f.y,

        homeX: x,

        homeY: f.y,

        radius: PLAYER_RADIUS,

        mouseX: x,

        mouseY: f.y,

        keys: {
            w: false,
            a: false,
            s: false,
            d: false
        },

        kick: false
    };

    teams[team].push(id);

    return players[id];
}


// ========================================
// OYUNÇU SİL
// ========================================

function removePlayer(socketId) {

    const player =
        players[socketId];

    if (!player)
        return;

    if (
        ball.owner ===
        player.id
    ) {

        ball.owner = null;
    }

    teams[player.team] =
        teams[player.team].filter(
            id =>
                id !== socketId
        );

    delete players[socketId];
}


// ========================================
// TOPU OYUNÇUYA VER
// ========================================

function giveBallToPlayer(player) {

    if (!player)
        return;

    ball.owner =
        player.id;

    ball.vx = 0;
    ball.vy = 0;

    ball.lastHitPlayer = null;
    ball.lastHitTime = 0;

    updateBallPosition();
}


// ========================================
// TOPUN YERİ
// ========================================

function updateBallPosition() {

    if (!ball.owner)
        return;

    const player =
        players[ball.owner];

    if (!player) {

        ball.owner = null;

        return;
    }

    let dx =
        player.mouseX -
        player.x;

    let dy =
        player.mouseY -
        player.y;

    const d =
        Math.sqrt(
            dx * dx +
            dy * dy
        );

    if (d > 0.1) {

        dx /= d;
        dy /= d;

    } else {

        dx = 1;
        dy = 0;
    }

    ball.x =
        player.x +
        dx *
        BALL_DISTANCE;

    ball.y =
        player.y +
        dy *
        BALL_DISTANCE;
}


// ========================================
// MAUS İSTİQAMƏTİ
// ========================================

function mouseDirection(player) {

    let dx =
        player.mouseX -
        player.x;

    let dy =
        player.mouseY -
        player.y;

    const d =
        Math.sqrt(
            dx * dx +
            dy * dy
        );

    if (d < 0.1) {

        return {
            x: 1,
            y: 0
        };
    }

    return {
        x: dx / d,
        y: dy / d
    };
}


// ========================================
// ZƏRBƏ
// ========================================

function kickBall(
    player,
    charge = 1
) {

    if (
        ball.owner !==
        player.id
    ) {
        return;
    }

    const direction =
        mouseDirection(player);

    charge =
        Math.max(
            0,
            Math.min(
                1,
                Number(charge) || 0
            )
        );

    const power =
        MIN_KICK_POWER +
        (
            KICK_POWER -
            MIN_KICK_POWER
        ) *
        charge;

    ball.owner = null;

    const safeDistance =
        player.radius +
        ball.radius +
        4;

    ball.x =
        player.x +
        direction.x *
        safeDistance;

    ball.y =
        player.y +
        direction.y *
        safeDistance;

    ball.vx =
        direction.x *
        power;

    ball.vy =
        direction.y *
        power;

    ball.lastHitPlayer = null;
    ball.lastHitTime = 0;

    player.kick = false;
}


// ========================================
// OYUNÇU HƏRƏKƏTİ
// ========================================

function movePlayer(player) {

    let dx = 0;
    let dy = 0;

    if (player.keys.w)
        dy -= 1;

    if (player.keys.s)
        dy += 1;

    if (player.keys.a)
        dx -= 1;

    if (player.keys.d)
        dx += 1;

    if (
        dx === 0 &&
        dy === 0
    ) {
        return;
    }

    const d =
        Math.sqrt(
            dx * dx +
            dy * dy
        );

    dx /= d;
    dy /= d;

    player.x +=
        dx *
        PLAYER_SPEED;

    player.y +=
        dy *
        PLAYER_SPEED;

    player.x =
        Math.max(
            player.radius,
            Math.min(
                WIDTH -
                player.radius,
                player.x
            )
        );

    player.y =
        Math.max(
            player.radius,
            Math.min(
                HEIGHT -
                player.radius,
                player.y
            )
        );
}


// ========================================
// TOP HƏRƏKƏTİ
// ========================================

function moveBall() {

    if (ball.owner) {

        updateBallPosition();

        return;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    ball.vx *= 0.965;
    ball.vy *= 0.965;

    if (
        Math.abs(ball.vx) < 0.04
    ) {
        ball.vx = 0;
    }

    if (
        Math.abs(ball.vy) < 0.04
    ) {
        ball.vy = 0;
    }

    if (
        ball.y -
        ball.radius < 0
    ) {

        ball.y =
            ball.radius;

        ball.vy *= -0.7;
    }

    if (
        ball.y +
        ball.radius >
        HEIGHT
    ) {

        ball.y =
            HEIGHT -
            ball.radius;

        ball.vy *= -0.7;
    }

    // SOL QAPI
    if (
        ball.x -
        ball.radius < 0
    ) {

        if (
            ball.y >
                HEIGHT / 2 - 90 &&
            ball.y <
                HEIGHT / 2 + 90
        ) {

            score.blue++;

            io.emit(
                "goal",
                {
                    scorer: "blue",
                    score: score
                }
            );

            resetGame();

            return;
        }

        ball.x =
            ball.radius;

        ball.vx *= -0.7;
    }

    // SAĞ QAPI
    if (
        ball.x +
        ball.radius >
        WIDTH
    ) {

        if (
            ball.y >
                HEIGHT / 2 - 90 &&
            ball.y <
                HEIGHT / 2 + 90
        ) {

            score.red++;

            io.emit(
                "goal",
                {
                    scorer: "red",
                    score: score
                }
            );

            resetGame();

            return;
        }

        ball.x =
            WIDTH -
            ball.radius;

        ball.vx *= -0.7;
    }
}


// ========================================
// TOP - OYUNÇU TOXUNMASI
// ========================================

function ballPlayerCollision(
    previousX,
    previousY
) {

    if (ball.owner)
        return;

    const speed =
        Math.sqrt(
            ball.vx * ball.vx +
            ball.vy * ball.vy
        );

    if (speed < 0.5)
        return;

    const now =
        Date.now();

    let hitPlayer = null;
    let hitDistance = Infinity;

    for (
        const id in players
    ) {

        const player =
            players[id];

        if (!player)
            continue;

        const segmentX =
            ball.x -
            previousX;

        const segmentY =
            ball.y -
            previousY;

        const segmentLengthSquared =
            segmentX * segmentX +
            segmentY * segmentY;

        let t = 0;

        if (
            segmentLengthSquared > 0
        ) {

            t =
                (
                    (
                        player.x -
                        previousX
                    ) *
                    segmentX
                    +
                    (
                        player.y -
                        previousY
                    ) *
                    segmentY
                )
                /
                segmentLengthSquared;

            t =
                Math.max(
                    0,
                    Math.min(
                        1,
                        t
                    )
                );
        }

        const closestX =
            previousX +
            segmentX * t;

        const closestY =
            previousY +
            segmentY * t;

        const dx =
            player.x -
            closestX;

        const dy =
            player.y -
            closestY;

        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        const collisionDistance =
            player.radius +
            ball.radius;

        if (
            distance <=
            collisionDistance
        ) {

            if (
                ball.lastHitPlayer ===
                    player.id &&
                now -
                    ball.lastHitTime <
                    120
            ) {
                continue;
            }

            if (
                distance <
                hitDistance
            ) {

                hitDistance =
                    distance;

                hitPlayer =
                    player;
            }
        }
    }

    if (!hitPlayer)
        return;


    // ====================================
    // TOP OYUNÇUYA DƏYƏNDƏ SƏKMƏ
    // ====================================

    let ballSpeed =
        Math.sqrt(
            ball.vx * ball.vx +
            ball.vy * ball.vy
        );

    if (ballSpeed > 0.01) {

        const hitDirX =
            hitPlayer.x -
            ball.x;

        const hitDirY =
            hitPlayer.y -
            ball.y;

        const hitDistance =
            Math.sqrt(
                hitDirX * hitDirX +
                hitDirY * hitDirY
            );

        if (hitDistance > 0.01) {

            const nx =
                hitDirX /
                hitDistance;

            const ny =
                hitDirY /
                hitDistance;

            const dot =
                ball.vx * nx +
                ball.vy * ny;

            const bounce =
                0.20;

            const newVx =
                (
                    ball.vx -
                    2 * dot * nx
                ) *
                bounce;

            const newVy =
                (
                    ball.vy -
                    2 * dot * ny
                ) *
                bounce;

            ball.vx =
                newVx;

            ball.vy =
                newVy;


            // ====================================
            // OYUNÇUNU AZCA GERİ İTƏLƏ
            // ====================================

            const playerPush =
                10.0;

            hitPlayer.x -=
                nx *
                playerPush;

            hitPlayer.y -=
                ny *
                playerPush;

            hitPlayer.x =
                Math.max(
                    hitPlayer.radius,
                    Math.min(
                        WIDTH -
                        hitPlayer.radius,
                        hitPlayer.x
                    )
                );

            hitPlayer.y =
                Math.max(
                    hitPlayer.radius,
                    Math.min(
                        HEIGHT -
                        hitPlayer.radius,
                        hitPlayer.y
                    )
                );
        }
    }


    // ====================================
    // TOPU OYUNÇUNUN İÇİNDƏN ÇIXAR
    // ====================================

    let nx =
        ball.x -
        hitPlayer.x;

    let ny =
        ball.y -
        hitPlayer.y;

    let distance =
        Math.sqrt(
            nx * nx +
            ny * ny
        );

    if (distance < 0.01) {

        nx =
            ball.vx;

        ny =
            ball.vy;

        distance =
            Math.sqrt(
                nx * nx +
                ny * ny
            );

        if (distance < 0.01) {

            nx = 1;
            ny = 0;
            distance = 1;
        }
    }

    nx /= distance;
    ny /= distance;

    const safeDistance =
        hitPlayer.radius +
        ball.radius +
        2;

    ball.x =
        hitPlayer.x +
        nx *
        safeDistance;

    ball.y =
        hitPlayer.y +
        nx *
        safeDistance;

    ball.lastHitPlayer =
        hitPlayer.id;

    ball.lastHitTime =
        now;
}


// ========================================
// TOPU ALMA
// ========================================

function checkBallPickup() {

    if (!ball.owner) {

        if (
            Math.abs(ball.vx) > 3 ||
            Math.abs(ball.vy) > 3
        ) {
            return;
        }

        let nearest = null;

        let nearestDistance =
            Infinity;

        for (
            const id in players
        ) {

            const player =
                players[id];

            const dx =
                player.x -
                ball.x;

            const dy =
                player.y -
                ball.y;

            const d =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            const pickupDistance =
                player.radius +
                ball.radius +
                12;

            if (
                d <
                pickupDistance &&
                d <
                nearestDistance
            ) {

                nearestDistance = d;
                nearest = player;
            }
        }

        if (nearest) {

            giveBallToPlayer(
                nearest
            );
        }

        return;
    }

    const owner =
        players[ball.owner];

    if (!owner) {

        ball.owner = null;

        return;
    }

    for (
        const id in players
    ) {

        const opponent =
            players[id];

        if (!opponent)
            continue;

        if (
            opponent.id ===
            owner.id
        ) {
            continue;
        }

        if (
            opponent.team ===
            owner.team
        ) {
            continue;
        }

        const dx =
            opponent.x -
            ball.x;

        const dy =
            opponent.y -
            ball.y;

        const distanceToBall =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        const ballTouchDistance =
            opponent.radius +
            ball.radius +
            4;

        if (
            distanceToBall <=
            ballTouchDistance
        ) {

            giveBallToPlayer(
                opponent
            );

            break;
        }
    }
}


// ========================================
// TOQQUŞMA
// ========================================

function playerCollision() {

    if (!ball.owner) {

        for (
            const id in players
        ) {

            const player =
                players[id];

            const dx =
                ball.x -
                player.x;

            const dy =
                ball.y -
                player.y;

            let d =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            const minDistance =
                player.radius +
                ball.radius;

            if (
                d <
                minDistance
            ) {

                if (d === 0)
                    d = 0.01;

                const nx =
                    dx / d;

                const ny =
                    dy / d;

                ball.x =
                    player.x +
                    nx *
                    (minDistance + 1);

                ball.y =
                    player.y +
                    ny *
                    (minDistance + 1);
            }
        }
    }


    // ====================================
    // OYUNÇU - OYUNÇU
    // ====================================

    const ids =
        Object.keys(players);

    for (
        let i = 0;
        i < ids.length;
        i++
    ) {

        const a =
            players[ids[i]];

        if (!a)
            continue;

        for (
            let j = i + 1;
            j < ids.length;
            j++
        ) {

            const b =
                players[ids[j]];

            if (!b)
                continue;

            const dx =
                b.x -
                a.x;

            const dy =
                b.y -
                a.y;

            let d =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            const minDistance =
                a.radius +
                b.radius;

            if (
                d >=
                minDistance
            ) {
                continue;
            }

            if (d === 0)
                d = 0.01;

            const nx =
                dx / d;

            const ny =
                dy / d;

            const overlap =
                minDistance -
                d;

            a.x -=
                nx *
                (overlap / 2);

            a.y -=
                ny *
                (overlap / 2);

            b.x +=
                nx *
                (overlap / 2);

            b.y +=
                ny *
                (overlap / 2);

            const push = 1.8;

            a.x -=
                nx *
                push;

            a.y -=
                ny *
                push;

            b.x +=
                nx *
                push;

            b.y +=
                ny *
                push;

            a.x =
                Math.max(
                    a.radius,
                    Math.min(
                        WIDTH -
                        a.radius,
                        a.x
                    )
                );

            a.y =
                Math.max(
                    a.radius,
                    Math.min(
                        HEIGHT -
                        a.radius,
                        a.y
                    )
                );

            b.x =
                Math.max(
                    b.radius,
                    Math.min(
                        WIDTH -
                        b.radius,
                        b.x
                    )
                );

            b.y =
                Math.max(
                    b.radius,
                    Math.min(
                        HEIGHT -
                        b.radius,
                        b.y
                    )
                );
        }
    }
}


// ========================================
// RESET - SKORU SAXLAYIR
// ========================================

function resetGame() {

    ball.x =
        WIDTH / 2;

    ball.y =
        HEIGHT / 2;

    ball.vx = 0;
    ball.vy = 0;
    ball.owner = null;

    ball.lastHitPlayer = null;
    ball.lastHitTime = 0;

    for (
        const id in players
    ) {

        const player =
            players[id];

        player.x =
            player.homeX;

        player.y =
            player.homeY;

        player.keys = {
            w: false,
            a: false,
            s: false,
            d: false
        };

        player.kick = false;
    }
}


// ========================================
// SOCKET
// ========================================

io.on(
    "connection",
    socket => {

        console.log(
            "Qoşuldu:",
            socket.id
        );

        sockets[socket.id] =
            socket;


        // ==================================
        // BOŞ SERVERDƏ YENİ OYUN
        // ==================================

        if (
            Object.keys(players).length === 0
        ) {

            if (scoreResetTimer) {

                clearTimeout(
                    scoreResetTimer
                );

                scoreResetTimer = null;
            }

            score.red = 0;
            score.blue = 0;

            ball.x =
                WIDTH / 2;

            ball.y =
                HEIGHT / 2;

            ball.vx = 0;
            ball.vy = 0;
            ball.owner = null;
        }


        // ==================================
        // KOMANDA SEÇİMİ
        // ==================================

        socket.on(
            "chooseTeam",
            team => {

                if (
                    team !== "red" &&
                    team !== "blue"
                ) {
                    return;
                }

                if (
                    players[socket.id]
                ) {
                    return;
                }

                if (
                    teams[team].length >=
                    MAX_PLAYERS_PER_TEAM
                ) {

                    socket.emit(
                        "teamFull",
                        {
                            team: team
                        }
                    );

                    return;
                }

                const player =
                    createPlayer(
                        socket.id,
                        team
                    );

                if (!player)
                    return;

                socket.emit(
                    "welcome",
                    {
                        id: socket.id,
                        team: player.team
                    }
                );

                console.log(
                    `${socket.id} ${team} komandasını seçdi`
                );
            }
        );


        // ==================================
        // KOMANDA DƏYİŞ
        // ==================================

        socket.on(
            "changeTeam",
            newTeam => {

                if (
                    newTeam !== "red" &&
                    newTeam !== "blue"
                ) {
                    return;
                }

                const oldPlayer =
                    players[socket.id];

                if (!oldPlayer)
                    return;

                if (
                    oldPlayer.team ===
                    newTeam
                ) {

                    socket.emit(
                        "welcome",
                        {
                            id: socket.id,
                            team: oldPlayer.team
                        }
                    );

                    return;
                }

                removePlayer(socket.id);

                const newPlayer =
                    createPlayer(
                        socket.id,
                        newTeam
                    );

                if (!newPlayer) {

                    socket.emit(
                        "teamFull",
                        {
                            team: newTeam
                        }
                    );

                    return;
                }

                socket.emit(
                    "welcome",
                    {
                        id: socket.id,
                        team: newPlayer.team
                    }
                );

                console.log(
                    `${socket.id} ${newTeam} komandasına keçdi`
                );
            }
        );


        // ==================================
        // İDARƏETMƏ İNFOSU (DƏKLƏR)
        // ==================================

        socket.on(
            "keys",
            keys => {

                const player =
                    players[socket.id];

                if (!player)
                    return;

                player.keys = {
                    w: Boolean(keys.w),
                    a: Boolean(keys.a),
                    s: Boolean(keys.s),
                    d: Boolean(keys.d)
                };
            }
        );

        socket.on(
            "mouse",
            data => {

                const player =
                    players[socket.id];

                if (!player)
                    return;

                if (
                    typeof data.x === "number" &&
                    typeof data.y === "number"
                ) {

                    player.mouseX = data.x;
                    player.mouseY = data.y;
                }
            }
        );

        socket.on(
            "kick",
            data => {

                const player =
                    players[socket.id];

                if (!player)
                    return;

                kickBall(
                    player,
                    data ? data.charge : 1
                );
            }
        );


        // ==================================
        // BAĞLANMANIN KƏSİLMƏSİ
        // ==================================

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Ayrıldı:",
                    socket.id
                );

                removePlayer(socket.id);

                delete sockets[socket.id];

                if (
                    Object.keys(players).length === 0
                ) {

                    scoreResetTimer =
                        setTimeout(
                            () => {

                                fullResetGame();

                            },
                            10000
                        );
                }
            }
        );
    }
);


// ========================================
// OYUN DÖVRÜ (60 FPS)
// ========================================

setInterval(() => {

    const prevBallX = ball.x;
    const prevBallY = ball.y;

    for (const id in players) {

        movePlayer(players[id]);
    }

    moveBall();

    playerCollision();

    ballPlayerCollision(
        prevBallX,
        prevBallY
    );

    checkBallPickup();

    io.emit("state", {
        players: players,
        ball: ball,
        score: score
    });

}, 1000 / 60);


// ========================================
// SERVERİ BAŞLAT
// ========================================

server.listen(PORT, () => {

    console.log(
        `Server ${PORT} portunda işləyir...`
    );
});