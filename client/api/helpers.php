<?php
/**
 * helpers.php
 * ------------------------------------------------------------
 * Utilitários compartilhados por todos os endpoints: leitura de
 * JSON do corpo da requisição, respostas padronizadas, validação
 * de nome e de números — para não repetir essa lógica em cada
 * arquivo e para nunca vazar detalhes internos (stack trace, SQL,
 * caminhos do servidor) para o cliente.
 * ------------------------------------------------------------
 */

/** Sempre responde em JSON, mesmo em erros. */
header('Content-Type: application/json; charset=utf-8');

// Mesmo domínio (jogo e API ficam no mesmo host no InfinityFree),
// então não há necessidade de CORS aberto. Se um dia o jogo for
// servido de outro domínio, adicione aqui uma origem específica —
// nunca "*".

/** Envia uma resposta JSON de sucesso e encerra a execução. */
function json_success(array $data = []): void {
  echo json_encode(array_merge(['success' => true], $data));
  exit;
}

/** Envia uma resposta JSON de erro (com HTTP status) e encerra. */
function json_error(string $code, int $httpStatus = 400): void {
  http_response_code($httpStatus);
  echo json_encode(['success' => false, 'error' => $code]);
  exit;
}

/**
 * Lê e decodifica o corpo da requisição como JSON.
 * Aceita também application/x-www-form-urlencoded / multipart (ex.:
 * navigator.sendBeacon envia texto simples) como fallback, tentando
 * decodificar $_POST['payload'] se o JSON bruto falhar.
 */
function read_json_body(): array {
  $raw = file_get_contents('php://input');

  if ($raw !== false && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
      return $decoded;
    }
  }

  // Fallback para sendBeacon com Blob de texto ou form-encoded.
  if (isset($_POST['payload'])) {
    $decoded = json_decode($_POST['payload'], true);
    if (is_array($decoded)) {
      return $decoded;
    }
  }

  if (!empty($_POST)) {
    return $_POST;
  }

  return [];
}

/** Extrai e valida (formato) o token de sessão de um array de input. */
function extract_token(array $input): ?string {
  $token = $input['token'] ?? null;
  if (!is_string($token)) return null;
  // O token é gerado com bin2hex(random_bytes(32)) => 64 chars hex.
  if (!preg_match('/^[a-f0-9]{64}$/', $token)) return null;
  return $token;
}

/**
 * Sanitiza o nome do jogador:
 *  - remove espaços nas pontas e colapsa espaços internos;
 *  - corta no tamanho máximo permitido;
 *  - remove caracteres de controle;
 *  - rejeita nome vazio (retorna null nesse caso).
 * Como o nome é sempre desenhado via ctx.fillText() (Canvas), não
 * há execução de HTML/JS mesmo sem essa sanitização, mas ainda assim
 * validamos tamanho/conteúdo no servidor por segurança e consistência.
 */
function sanitize_player_name($name): ?string {
  if (!is_string($name)) return null;

  // Remove caracteres de controle.
  $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
  $name = trim(preg_replace('/\s+/', ' ', $name));

  if ($name === '' || mb_strlen($name) < MIN_NAME_LENGTH) return null;
  if (mb_strlen($name) > MAX_NAME_LENGTH) {
    $name = mb_substr($name, 0, MAX_NAME_LENGTH);
  }

  return $name;
}

/** Valida que um valor é um número finito (rejeita NaN/Infinity/strings). */
function is_finite_number($value): bool {
  return is_numeric($value) && is_finite((float)$value);
}

/** Restringe um valor numérico a um intervalo [min, max]. */
function clamp_number(float $value, float $min, float $max): float {
  return max($min, min($max, $value));
}
