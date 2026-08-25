<?php
/**
 * leave.php  (POST)
 * ------------------------------------------------------------
 * Remove o jogador imediatamente quando ele sai de forma "limpa"
 * (volta ao menu, fecha a aba corretamente). Chamado tanto por
 * fetch() normal quanto por navigator.sendBeacon() (que envia o
 * corpo como texto simples, por isso read_json_body() tem fallback).
 *
 * Isso é só uma otimização: se a requisição não chegar (aba fechada
 * à força, sem internet, app encerrado), o cleanup por inatividade
 * em cleanup.php garante que o jogador some em até
 * OFFLINE_TIMEOUT_SECONDS de qualquer forma.
 *
 * Sempre responde sucesso (idempotente) — não há problema em tentar
 * remover um jogador que já não existe mais.
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_error('method_not_allowed', 405);
}

$input = read_json_body();
$token = extract_token($input);

if ($token !== null) {
  $pdo = get_db();
  $stmt = $pdo->prepare('DELETE FROM online_players WHERE session_token = :token');
  $stmt->execute(['token' => $token]);
}

json_success();
