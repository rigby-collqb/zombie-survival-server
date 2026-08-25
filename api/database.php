<?php
/**
 * database.php
 * ------------------------------------------------------------
 * Ponto único de conexão com o MySQL via PDO.
 * Todos os endpoints devem incluir este arquivo e chamar get_db().
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';

/**
 * Retorna uma instância PDO reaproveitável (uma por requisição).
 * Em caso de falha de conexão, responde com JSON de erro (500) e
 * encerra a execução — nunca expõe detalhes internos do banco
 * (host, usuário, mensagem do driver) ao cliente.
 */
function get_db(): PDO {
  static $pdo = null;

  if ($pdo !== null) {
    return $pdo;
  }

  $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;

  try {
    $pdo = new PDO($dsn, DB_USER, DB_PASSWORD, [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
  } catch (PDOException $e) {
    // Nunca vazar mensagem de erro do PDO (pode conter host/usuário).
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'database_unavailable']);
    exit;
  }

  return $pdo;
}
