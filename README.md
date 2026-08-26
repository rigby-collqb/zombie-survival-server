# Zombie Survival Online — Server Fase 25

Node.js + Express + Socket.IO. Simulação autoritativa no Render.

## Fase 25 — A Verdade
- Modo História autoritativo em 5 capítulos e 5 mapas.
- Objetivos em ordem, transição de capítulos e conclusão da campanha.
- Inventário de 2 armas, medkit, granada, perks, Caixa do Acaso e MK-II/MK-III.
- Armas especiais e tipos avançados de zumbi.
- Eventos aleatórios e dificuldades Casual / Normal / Difícil / Pesadelo.
- Conquistas, estatísticas, chat rápido e pós-partida.
- Pausa real quando há exatamente 1 jogador conectado na sala. Timers, rounds, zumbis, bleedout, reload e eventos deixam de avançar e são deslocados corretamente ao retomar.
- Em multiplayer a solicitação de pausa autoritativa é recusada e a partida continua.
- Geometrias dos 5 mapas sincronizadas byte a byte com o cliente; o mapa final é **Laboratório Ômega** (`industrial`).

Não versione `data/accounts.json`, segredos, `.env` ou arquivos ZIP dentro do repositório.
