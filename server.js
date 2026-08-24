const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;

const players = new Map();

app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
});

/* ============================================================
   SITE / STATUS
============================================================ */

app.get("/", (req, res) => {
    res.json({
        online: true,
        game: "Zombie Survival Online",
        players: players.size
    });
});


/* ============================================================
   SOCKET.IO
============================================================ */

io.on("connection", (socket) => {

    console.log("Socket conectado:", socket.id);


    /* ========================================================
       ENTRAR NO JOGO
    ======================================================== */

    socket.on("player:join", (data, callback) => {

        let name = String(data?.name || "Sobrevivente")
            .trim()
            .slice(0, 16);

        if (!name) {
            name = "Sobrevivente";
        }

        const player = {
            id: socket.id,

            name,

            x: 2000 + Math.floor(Math.random() * 200 - 100),
            y: 2000 + Math.floor(Math.random() * 200 - 100),

            direction: "down",

            moving: false,

            vx: 0,
            vy: 0,

            health: 100,
            maxHealth: 100
        };

        players.set(socket.id, player);


        const existingPlayers = [];

        for (const p of players.values()) {

            if (p.id === socket.id)
                continue;

            existingPlayers.push(p);
        }


        if (typeof callback === "function") {

            callback({
                success: true,

                player,

                players: existingPlayers
            });
        }


        socket.broadcast.emit(
            "player:joined",
            player
        );


        console.log(
            `${name} entrou. Online: ${players.size}`
        );
    });


    /* ========================================================
       MOVIMENTO
    ======================================================== */

    socket.on("player:state", (data) => {

        const player = players.get(socket.id);

        if (!player)
            return;


        let x = Number(data?.x);
        let y = Number(data?.y);

        let vx = Number(data?.vx || 0);
        let vy = Number(data?.vy || 0);


        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return;
        }


        if (!Number.isFinite(vx))
            vx = 0;

        if (!Number.isFinite(vy))
            vy = 0;


        /* limites do mapa */

        x = Math.max(
            0,
            Math.min(WORLD_WIDTH, x)
        );

        y = Math.max(
            0,
            Math.min(WORLD_HEIGHT, y)
        );


        player.x = x;
        player.y = y;

        player.vx = vx;
        player.vy = vy;

        player.direction =
            String(data?.direction || "down");

        player.moving =
            data?.moving === true;


        /*
         * volatile = se a conexão estiver congestionada,
         * uma posição antiga pode ser descartada.
         *
         * Para movimento isso é melhor que criar fila.
         */
        socket.broadcast.volatile.emit(
            "player:update",
            player
        );
    });


    /* ========================================================
       PING
    ======================================================== */

    socket.on("ping:check", (callback) => {

        if (typeof callback === "function") {

            callback({
                serverTime: Date.now()
            });
        }
    });


    /* ========================================================
       SAIR MANUALMENTE
    ======================================================== */

    socket.on("player:leave", () => {

        removePlayer(socket);
    });


    /* ========================================================
       DESCONECTOU
    ======================================================== */

    socket.on("disconnect", () => {

        removePlayer(socket);
    });

});


function removePlayer(socket) {

    if (!players.has(socket.id))
        return;

    players.delete(socket.id);

    io.emit(
        "player:left",
        socket.id
    );

    console.log(
        `Jogador saiu. Online: ${players.size}`
    );
}


server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Zombie Survival Server rodando na porta ${PORT}`
        );
    }
);