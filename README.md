# Zombie Survival Online — Server Fase 22

Node.js + Express + Socket.IO. Servidor autoritativo.

## Fase 22
- Instância de mapa independente por sala.
- 5 geometrias/colisões diferentes sincronizadas com o cliente.
- Zumbis, spawn e interações respeitam o mapa escolhido.
- Ranking HTTP em `/api/leaderboard` e catálogo em `/api/maps`.
- Recovery de perfil aceita a chave atual, `PROFILE_SIGNING_KEY_PREVIOUS` opcional e a chave legada da Fase 20 para migração.
- Social/código de amigo continua autoritativo no servidor.

Não versione `data/accounts.json` e não coloque ZIPs dentro do repositório.
