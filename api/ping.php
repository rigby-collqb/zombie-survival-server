<?php
/**
 * ping.php  (GET)
 * ------------------------------------------------------------
 * Endpoint mínimo usado apenas para medir latência (RTT) no HUD
 * ("Ping: 120ms"). Propositalmente não toca no banco de dados —
 * é só uma resposta HTTP pequena e rápida, medida com
 * performance.now() no cliente antes/depois do fetch.
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers.php';

json_success(['serverTime' => round(microtime(true) * 1000)]);
