<?php
/**
 * config.php
 * ------------------------------------------------------------
 * Configuração central do backend multiplayer (Fase 2).
 *
 * ÚNICO arquivo que precisa ser editado ao publicar no InfinityFree.
 * Nenhum outro arquivo PHP deve conter credenciais de banco —
 * todos leem as constantes definidas aqui.
 * ------------------------------------------------------------
 */

// ---------------------------------------------------------------
// BANCO DE DADOS (preencha com os dados do painel do InfinityFree)
// ---------------------------------------------------------------
// No InfinityFree o host normalmente é algo como "sqlXXX.infinityfree.com"
// e o nome do banco/usuário costumam vir prefixados (ex.: "epiz_12345678_zombie").
define('DB_HOST', 'SEU_HOST');
define('DB_NAME', 'SEU_BANCO');
define('DB_USER', 'SEU_USUARIO');
define('DB_PASSWORD', 'SUA_SENHA');
define('DB_CHARSET', 'utf8mb4');

// ---------------------------------------------------------------
// MUNDO / JOGO (precisa bater com os valores usados no cliente,
// veja WORLD_WIDTH / WORLD_HEIGHT / MAP_SEED em js/game.js)
// ---------------------------------------------------------------
define('WORLD_WIDTH', 4000);
define('WORLD_HEIGHT', 4000);

// Zona de spawn: um quadrado centrado no meio do mapa onde os
// jogadores aparecem, com um pequeno espalhamento para não
// nascerem todos exatamente no mesmo pixel.
define('SPAWN_CENTER_X', WORLD_WIDTH / 2);
define('SPAWN_CENTER_Y', WORLD_HEIGHT / 2);
define('SPAWN_RADIUS', 160);

// Velocidade do jogador em pixels/segundo (precisa bater com
// Player.speed em js/player.js) — usada na validação anti-teleporte.
define('PLAYER_SPEED', 220);

// Tolerância multiplicativa sobre a velocidade máxima permitida entre
// duas atualizações, para absorver lag de rede, variação do polling
// e celulares mais lentos, além de uma margem fixa em pixels.
define('SPEED_TOLERANCE_FACTOR', 1.8);
define('SPEED_TOLERANCE_PIXELS', 40);

// Tempo (segundos) sem atualização para considerar o jogador offline.
define('OFFLINE_TIMEOUT_SECONDS', 15);

// Limite de jogadores simultâneos (hospedagem compartilhada gratuita).
define('MAX_PLAYERS', 20);

// Tamanho máximo do nome do jogador (precisa bater com o
// maxlength="16" do input em index.html).
define('MAX_NAME_LENGTH', 16);
define('MIN_NAME_LENGTH', 1);

// ---------------------------------------------------------------
// FASE 3 — ZUMBIS / IA
// ---------------------------------------------------------------
define('MAX_ZOMBIES', 20);
define('ZOMBIE_SPEED', 70);            // pixels/s (mais lento que o jogador: 220)
define('ZOMBIE_HEALTH', 100);
define('DETECTION_RADIUS', 350);       // px — raio de detecção de jogadores
define('ATTACK_RANGE', 42);            // px — distância para começar a atacar
define('ZOMBIE_ATTACK_DAMAGE', 10);
define('ATTACK_COOLDOWN_MS', 1000);
define('ZOMBIE_RESPAWN_DELAY_SECONDS', 6); // tempo com state=dead antes de remover/repor
define('ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER', 500); // não nascer em cima da tela de ninguém
define('ZOMBIE_SPAWN_OBSTACLE_MARGIN', 24); // folga ao redor de obstáculos sólidos
define('ZOMBIE_WANDER_RADIUS', 140);
define('ZOMBIE_IDLE_MIN_SECONDS', 1.5);
define('ZOMBIE_IDLE_MAX_SECONDS', 4.0);
define('ZOMBIE_COLLISION_RADIUS', 14);  // usado para colisão com obstáculos e hitscan

// ---------------------------------------------------------------
// FASE 3 — COMBATE / ARMAS
// ---------------------------------------------------------------
define('PISTOL_DAMAGE', 25);
define('PISTOL_FIRE_RATE_MS', 350);
define('MAX_SHOOT_DISTANCE', 520); // px — alcance máximo da pistola (folga sobre DETECTION_RADIUS)
define('PLAYER_COLLISION_RADIUS', 14); // aproximação do corpo do jogador p/ hitscan

// ---------------------------------------------------------------
// Fuso horário do PHP (evita avisos e mantém timestamps consistentes)
// ---------------------------------------------------------------
date_default_timezone_set('UTC');
