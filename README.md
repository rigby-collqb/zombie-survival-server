# Zombie Survival Online — Servidor Fase 27

## Fase 27 — Combat Director

- `zombie-survival-server@27.0.0`;
- infectados ELITE: Frenético, Blindado e Praga;
- elite escala vida/velocidade/dano/recompensa sem substituir os tipos existentes;
- variantes de boss: Carcereiro, Carniceiro e Abominação;
- mutações de round: Febre Carmesim, Carne Blindada, Névoa Tóxica e Instabilidade;
- snapshot compacto transmite elite/classe/variante;
- raycast de tiro retorna dano real por raio para feedback visual no cliente;
- preserva regras de morte/respawn da Fase 26.

### Deploy Render
`npm install` e `npm start`; depois faça commit/push normalmente.

Não versionar `.env`, `data/accounts.json` ou chaves.
