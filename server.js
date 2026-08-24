const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const players = {};

app.get("/", (req, res) => {
    res.json({
        online: true,
        game: "Zombie Survival Online",
        players: Object.keys(players).length
    });
});

io.on("connection", (socket) => {

    console.log("Jogador conectado:", socket.id);

    players[socket.id] = {
        id: socket.id,
        x: 2000,
        y: 2000
    };

    socket.emit("world:init", {
        id: socket.id,
        players
    });

    socket.broadcast.emit("player:join", players[socket.id]);

    socket.on("player:move", (data) => {

        const player = players[socket.id];

        if (!player) return;

        if (
            !Number.isFinite(data.x) ||
            !Number.isFinite(data.y)
        ) {
            return;
        }

        player.x = data.x;
        player.y = data.y;

        socket.broadcast.emit("player:move", player);
    });

    socket.on("disconnect", () => {

        console.log("Jogador desconectado:", socket.id);

        delete players[socket.id];

        io.emit("player:leave", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});