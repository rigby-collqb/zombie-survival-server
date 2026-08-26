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
const StorySystem = require('./story');
const { ACHIEVEMENTS } = require('./achievements');

const app = express();
app.use(cors());

// Healthcheck simples (Render usa isso para saber que o serviço subiu).
app.get('/', (_req, res) => {
  res.status(200).json(gameServer ? gameServer.status() : {online:true,version:'25.0.0'});
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const gameServer = new GameServer(io);

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.max(3, Math.min(50, Number(req.query.limit) || 20));
  res.status(200).json({ success:true, rows:gameServer.accounts.leaderboard(limit), version:'25.0.0' });
});

app.get('/api/maps', (_req, res) => {
  res.status(200).json({ success:true, maps:GameServer.MAPS, version:'25.0.0' });
});

app.get('/api/story', (_req, res) => {
  res.status(200).json({ success:true, chapters:StorySystem.CHAPTERS, achievements:Object.values(ACHIEVEMENTS), version:'25.0.0' });
});


httpServer.listen(config.PORT, () => {
  console.log(`[server] ouvindo na porta ${config.PORT}`);
});

module.exports = { app, httpServer, io, gameServer };
