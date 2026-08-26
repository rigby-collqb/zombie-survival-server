<?php

/**
 * zombie_engine.php
 * ------------------------------------------------------------
 * Simulação "lazy" dos zumbis.
 *
 * Como o InfinityFree não permite um processo PHP contínuo,
 * os zumbis são atualizados sempre que algum jogador chama sync.php.
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/world_map.php';


/**
 * Remove zumbis mortos depois do tempo configurado.
 *
 * IMPORTANTE:
 * Não usamos ":delay" dentro de INTERVAL porque isso pode causar
 * problemas com prepared statements em algumas configurações MySQL/PDO.
 */
function cleanup_dead_zombies(PDO $pdo): void
{
    $delay = max(1, (int) ZOMBIE_RESPAWN_DELAY_SECONDS);

    $stmt = $pdo->prepare(
        "DELETE FROM zombies
         WHERE state = 'dead'
         AND last_update < DATE_SUB(NOW(3), INTERVAL {$delay} SECOND)"
    );

    $stmt->execute();
}


/**
 * Escolhe uma posição válida para spawn de zumbi.
 */
function pick_zombie_spawn_point(
    array $obstacles,
    array $alivePlayers
): ?array {

    $margin = 80;

    for ($attempt = 0; $attempt < 25; $attempt++) {

        $x =
            $margin +
            (mt_rand() / mt_getrandmax()) *
            (WORLD_WIDTH - ($margin * 2));

        $y =
            $margin +
            (mt_rand() / mt_getrandmax()) *
            (WORLD_HEIGHT - ($margin * 2));


        /*
         * Não deixa nascer dentro de:
         * árvores
         * casas
         * pedras
         * paredes
         * etc.
         */
        if (
            circle_hits_any_obstacle(
                $x,
                $y,
                ZOMBIE_COLLISION_RADIUS +
                ZOMBIE_SPAWN_OBSTACLE_MARGIN,
                $obstacles
            )
        ) {
            continue;
        }


        /*
         * Não nascer muito perto de jogadores.
         */
        $tooClose = false;

        foreach ($alivePlayers as $player) {

            $distance = hypot(
                $x - (float)$player['x'],
                $y - (float)$player['y']
            );

            if (
                $distance <
                ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER
            ) {
                $tooClose = true;
                break;
            }
        }


        if ($tooClose) {
            continue;
        }


        return [
            'x' => $x,
            'y' => $y
        ];
    }


    return null;
}


/**
 * Mantém a população de zumbis até MAX_ZOMBIES.
 *
 * Cria no máximo 3 por sincronização para evitar sobrecarregar
 * o InfinityFree/MySQL.
 */
function ensure_zombie_population(
    PDO $pdo,
    array $obstacles,
    array $alivePlayers
): void {

    $countStmt = $pdo->query(
        'SELECT COUNT(*) AS total FROM zombies'
    );

    $row = $countStmt->fetch();

    $total = (int)($row['total'] ?? 0);


    $missing = MAX_ZOMBIES - $total;


    if ($missing <= 0) {
        return;
    }


    /*
     * Máximo de 3 novos zumbis por sync.
     */
    $toSpawnNow = min($missing, 3);


    /*
     * IMPORTANTE:
     *
     * Cada placeholder tem nome ÚNICO.
     *
     * Antes havia:
     *
     * :health usado duas vezes
     *
     * Isso poderia causar:
     *
     * SQLSTATE[HY093]: Invalid parameter number
     */
    $insert = $pdo->prepare(
        "INSERT INTO zombies (
            x,
            y,
            health,
            max_health,
            speed,
            state,
            direction_x,
            direction_y,
            state_timer,
            spawn_x,
            spawn_y,
            last_update
        )
        VALUES (
            :x,
            :y,
            :health,
            :max_health,
            :speed,
            'idle',
            0,
            1,
            :timer,
            :spawn_x,
            :spawn_y,
            NOW(3)
        )"
    );


    for ($i = 0; $i < $toSpawnNow; $i++) {

        $spot = pick_zombie_spawn_point(
            $obstacles,
            $alivePlayers
        );


        /*
         * Não encontrou lugar válido agora.
         * Na próxima sync tenta novamente.
         */
        if ($spot === null) {
            break;
        }


        $random =
            mt_rand() /
            mt_getrandmax();


        $idleTimer =
            ZOMBIE_IDLE_MIN_SECONDS +
            $random *
            (
                ZOMBIE_IDLE_MAX_SECONDS -
                ZOMBIE_IDLE_MIN_SECONDS
            );


        $insert->execute([
            'x' => $spot['x'],
            'y' => $spot['y'],

            'health' => ZOMBIE_HEALTH,
            'max_health' => ZOMBIE_HEALTH,

            'speed' => ZOMBIE_SPEED,

            'timer' => $idleTimer,

            'spawn_x' => $spot['x'],
            'spawn_y' => $spot['y']
        ]);
    }
}


/**
 * Retorna vetor normalizado de A até B.
 */
function _normalized_direction(
    float $fromX,
    float $fromY,
    float $toX,
    float $toY
): array {

    $dx = $toX - $fromX;
    $dy = $toY - $fromY;

    $dist = hypot($dx, $dy);


    if ($dist < 0.0001) {

        return [
            'x' => 0.0,
            'y' => 0.0,
            'dist' => 0.0
        ];
    }


    return [
        'x' => $dx / $dist,
        'y' => $dy / $dist,
        'dist' => $dist
    ];
}


/**
 * Simula todos os zumbis.
 */
function simulate_zombies(
    PDO $pdo,
    array $obstacles,
    array $alivePlayers
): array {

    /*
     * Remove mortos antigos.
     */
    cleanup_dead_zombies($pdo);


    /*
     * Repõe população.
     */
    ensure_zombie_population(
        $pdo,
        $obstacles,
        $alivePlayers
    );


    /*
     * Busca todos.
     */
    $zombies = $pdo
        ->query(
            'SELECT * FROM zombies ORDER BY id ASC'
        )
        ->fetchAll();


    /*
     * UPDATE de cada zumbi.
     *
     * last_update é usado como controle simples de concorrência:
     * se duas syncs tentarem atualizar o mesmo zumbi, apenas a que
     * estiver com o last_update esperado vence.
     */
    $updateStmt = $pdo->prepare(
        "UPDATE zombies
         SET
            x = :x,
            y = :y,
            health = :health,
            state = :state,
            target_player_id = :target,
            direction_x = :dx,
            direction_y = :dy,
            wander_target_x = :wtx,
            wander_target_y = :wty,
            state_timer = :timer,
            last_attack_at = :latk,
            last_update = NOW(3)
         WHERE
            id = :id
            AND last_update = :expected"
    );


    /*
     * Dano causado por zumbi.
     */
    $damagePlayerStmt = $pdo->prepare(
        "UPDATE online_players
         SET health = GREATEST(
             0,
             health - :dmg
         )
         WHERE
            id = :pid
            AND alive = 1"
    );


    /*
     * Marca player como morto quando HP <= 0.
     */
    $markPlayerDeadStmt = $pdo->prepare(
        "UPDATE online_players
         SET alive = 0
         WHERE
            id = :pid
            AND health <= 0"
    );


    $result = [];


    foreach ($zombies as $zombie) {

        /*
         * Zumbi morto.
         */
        if ($zombie['state'] === 'dead') {

            $result[] =
                _zombie_to_snapshot($zombie);

            continue;
        }


        /*
         * Calcula tempo desde última atualização.
         */
        $lastUpdate = $zombie['last_update'];


        $lastTimestamp = strtotime(
            $lastUpdate . ' UTC'
        );


        if ($lastTimestamp === false) {
            $dt = 0.5;
        } else {

            $dt =
                microtime(true) -
                $lastTimestamp;
        }


        /*
         * Evita valores absurdos.
         */
        $dt = max(
            0.05,
            min($dt, 2.0)
        );


        /*
         * Estado atual.
         */
        $x = (float)$zombie['x'];
        $y = (float)$zombie['y'];

        $state = $zombie['state'];

        $targetId =
            $zombie['target_player_id'];

        $dirX =
            (float)$zombie['direction_x'];

        $dirY =
            (float)$zombie['direction_y'];


        $wanderX =
            $zombie['wander_target_x'] !== null
            ? (float)$zombie['wander_target_x']
            : null;


        $wanderY =
            $zombie['wander_target_y'] !== null
            ? (float)$zombie['wander_target_y']
            : null;


        $timer =
            (float)$zombie['state_timer'];


        $lastAttackAt =
            $zombie['last_attack_at'];


        /*
         * ---------------------------------------------------------
         * PROCURA PLAYER VIVO MAIS PRÓXIMO
         * ---------------------------------------------------------
         */

        $nearest = null;

        $nearestDist =
            DETECTION_RADIUS;


        foreach ($alivePlayers as $player) {

            $distance = hypot(
                (float)$player['x'] - $x,
                (float)$player['y'] - $y
            );


            if ($distance <= $nearestDist) {

                $nearestDist = $distance;

                $nearest = $player;
            }
        }


        /*
         * ---------------------------------------------------------
         * TEM PLAYER POR PERTO
         * ---------------------------------------------------------
         */

        if ($nearest !== null) {

            $targetId =
                (int)$nearest['id'];


            /*
             * Está perto o suficiente para atacar.
             */
            if (
                $nearestDist <=
                ATTACK_RANGE
            ) {

                $state = 'attack';


                $direction =
                    _normalized_direction(
                        $x,
                        $y,
                        (float)$nearest['x'],
                        (float)$nearest['y']
                    );


                if (
                    $direction['dist'] >
                    0.0001
                ) {

                    $dirX =
                        $direction['x'];

                    $dirY =
                        $direction['y'];
                }


                /*
                 * Verifica cooldown.
                 */
                $canAttack = false;


                if ($lastAttackAt === null) {

                    $canAttack = true;

                } else {

                    $lastAttackTimestamp =
                        strtotime(
                            $lastAttackAt .
                            ' UTC'
                        );


                    if (
                        $lastAttackTimestamp ===
                        false
                    ) {

                        $canAttack = true;

                    } else {

                        $elapsedAttackMs =
                            (
                                microtime(true) -
                                $lastAttackTimestamp
                            ) * 1000;


                        if (
                            $elapsedAttackMs >=
                            ATTACK_COOLDOWN_MS
                        ) {
                            $canAttack = true;
                        }
                    }
                }


                /*
                 * Ataca.
                 */
                if ($canAttack) {

                    $damagePlayerStmt->execute([
                        'dmg' =>
                            ZOMBIE_ATTACK_DAMAGE,

                        'pid' =>
                            (int)$nearest['id']
                    ]);


                    $markPlayerDeadStmt->execute([
                        'pid' =>
                            (int)$nearest['id']
                    ]);


                    /*
                     * DATETIME(3)
                     */
                    $milliseconds =
                        (int)(
                            (
                                microtime(true) -
                                floor(
                                    microtime(true)
                                )
                            ) * 1000
                        );


                    $lastAttackAt =
                        gmdate(
                            'Y-m-d H:i:s'
                        )
                        .
                        '.'
                        .
                        str_pad(
                            (string)$milliseconds,
                            3,
                            '0',
                            STR_PAD_LEFT
                        );
                }

            } else {

                /*
                 * -------------------------------------------------
                 * CHASE
                 * -------------------------------------------------
                 */

                $state = 'chase';


                $direction =
                    _normalized_direction(
                        $x,
                        $y,
                        (float)$nearest['x'],
                        (float)$nearest['y']
                    );


                $dirX =
                    $direction['x'];

                $dirY =
                    $direction['y'];


                $nextX =
                    $x +
                    $dirX *
                    ZOMBIE_SPEED *
                    $dt;


                $nextY =
                    $y +
                    $dirY *
                    ZOMBIE_SPEED *
                    $dt;


                /*
                 * Colisão.
                 */
                $moved =
                    resolve_circle_movement(
                        $x,
                        $y,
                        $nextX,
                        $nextY,
                        ZOMBIE_COLLISION_RADIUS,
                        $obstacles
                    );


                $x =
                    $moved['x'];

                $y =
                    $moved['y'];
            }

        } else {

            /*
             * -----------------------------------------------------
             * NÃO TEM PLAYER PERTO
             * -----------------------------------------------------
             */

            $targetId = null;


            /*
             * Saiu de chase/attack.
             */
            if (
                $state === 'attack' ||
                $state === 'chase'
            ) {

                $state = 'idle';


                $timer =
                    ZOMBIE_IDLE_MIN_SECONDS +
                    (
                        mt_rand() /
                        mt_getrandmax()
                    )
                    *
                    (
                        ZOMBIE_IDLE_MAX_SECONDS -
                        ZOMBIE_IDLE_MIN_SECONDS
                    );


            /*
             * IDLE
             */
            } elseif (
                $state === 'idle'
            ) {

                $timer -= $dt;


                if ($timer <= 0) {

                    $angle =
                        (
                            mt_rand() /
                            mt_getrandmax()
                        )
                        *
                        2 *
                        M_PI;


                    $radius =
                        (
                            mt_rand() /
                            mt_getrandmax()
                        )
                        *
                        ZOMBIE_WANDER_RADIUS;


                    $wanderX =
                        $x +
                        cos($angle) *
                        $radius;


                    $wanderY =
                        $y +
                        sin($angle) *
                        $radius;


                    /*
                     * Limites do mapa.
                     */
                    $wanderX =
                        max(
                            20,
                            min(
                                WORLD_WIDTH - 20,
                                $wanderX
                            )
                        );


                    $wanderY =
                        max(
                            20,
                            min(
                                WORLD_HEIGHT - 20,
                                $wanderY
                            )
                        );


                    $state = 'wander';
                }


            /*
             * WANDER
             */
            } elseif (
                $state === 'wander'
            ) {

                /*
                 * Sem alvo válido.
                 */
                if (
                    $wanderX === null ||
                    $wanderY === null
                ) {

                    $state = 'idle';

                    $timer =
                        ZOMBIE_IDLE_MIN_SECONDS;

                } else {

                    $direction =
                        _normalized_direction(
                            $x,
                            $y,
                            $wanderX,
                            $wanderY
                        );


                    /*
                     * Chegou ao destino.
                     */
                    if (
                        $direction['dist'] < 6
                    ) {

                        $state = 'idle';


                        $timer =
                            ZOMBIE_IDLE_MIN_SECONDS +
                            (
                                mt_rand() /
                                mt_getrandmax()
                            )
                            *
                            (
                                ZOMBIE_IDLE_MAX_SECONDS -
                                ZOMBIE_IDLE_MIN_SECONDS
                            );

                    } else {

                        $dirX =
                            $direction['x'];

                        $dirY =
                            $direction['y'];


                        /*
                         * Wander é mais lento.
                         */
                        $wanderSpeed =
                            ZOMBIE_SPEED * 0.5;


                        $nextX =
                            $x +
                            $dirX *
                            $wanderSpeed *
                            $dt;


                        $nextY =
                            $y +
                            $dirY *
                            $wanderSpeed *
                            $dt;


                        /*
                         * Colisão.
                         */
                        $moved =
                            resolve_circle_movement(
                                $x,
                                $y,
                                $nextX,
                                $nextY,
                                ZOMBIE_COLLISION_RADIUS,
                                $obstacles
                            );


                        $x =
                            $moved['x'];

                        $y =
                            $moved['y'];
                    }
                }
            }
        }


        /*
         * ---------------------------------------------------------
         * LIMITES DO MAPA
         * ---------------------------------------------------------
         */

        $x =
            max(
                20,
                min(
                    WORLD_WIDTH - 20,
                    $x
                )
            );


        $y =
            max(
                20,
                min(
                    WORLD_HEIGHT - 20,
                    $y
                )
            );


        /*
         * ---------------------------------------------------------
         * SALVA O NOVO ESTADO
         * ---------------------------------------------------------
         */

        $updateStmt->execute([
            'x' => $x,
            'y' => $y,

            'health' =>
                (int)$zombie['health'],

            'state' =>
                $state,

            'target' =>
                $targetId,

            'dx' =>
                $dirX,

            'dy' =>
                $dirY,

            'wtx' =>
                $wanderX,

            'wty' =>
                $wanderY,

            'timer' =>
                $timer,

            'latk' =>
                $lastAttackAt,

            'id' =>
                (int)$zombie['id'],

            'expected' =>
                $lastUpdate
        ]);


        /*
         * Snapshot para cliente.
         */
        $result[] = [

            'id' =>
                (int)$zombie['id'],

            'x' =>
                $x,

            'y' =>
                $y,

            'health' =>
                (int)$zombie['health'],

            'maxHealth' =>
                (int)$zombie['max_health'],

            'state' =>
                $state,

            'directionX' =>
                $dirX,

            'directionY' =>
                $dirY
        ];
    }


    return $result;
}


/**
 * Converte linha do banco em snapshot enviado ao cliente.
 */
function _zombie_to_snapshot(
    array $zombie
): array {

    return [

        'id' =>
            (int)$zombie['id'],

        'x' =>
            (float)$zombie['x'],

        'y' =>
            (float)$zombie['y'],

        'health' =>
            (int)$zombie['health'],

        'maxHealth' =>
            (int)$zombie['max_health'],

        'state' =>
            $zombie['state'],

        'directionX' =>
            (float)$zombie['direction_x'],

        'directionY' =>
            (float)$zombie['direction_y']
    ];
}