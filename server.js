/**
 * server.js
 * ------------------------------------------------------------
 * Entrada do processo. Sobe um servidor HTTP mínimo (Render exige
 * uma porta HTTP respondendo para considerar o serviço "healthy")
 * e o Socket.IO por cima dele. Toda a lógica de jogo fica em
 * gameServer.js — este arquivo só faz o bootstrap.
 * ------------------------------------------------------------
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config');
const GameServer = require('./gameServer');

const app = express();
app.use(cors());

// Healthcheck simples (Render usa isso para saber que o serviço subiu).
app.get('/', (_req, res) => {
  res.status(200).send('Zombie Survival Online — servidor Node ativo.');
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const gameServer = new GameServer(io);

httpServer.listen(config.PORT, () => {
  console.log(`[server] ouvindo na porta ${config.PORT}`);
});

module.exports = { app, httpServer, io, gameServer };
