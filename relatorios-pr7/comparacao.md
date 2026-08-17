# Virada de chave — o critério aplicado

- **antes**: PLANEJADOR · claude-opus-5 · 9 casos
- **depois**: AGENTE · claude-opus-5 · 9 casos

## Veredito

**NÃO PODE VIRAR.**

- regressões: **1** (qualquer uma bloqueia)
- correções: **0**
- casos que sumiram: **0** (contam como regressão)
- sem mudança de estado: 8
- respostas distintas: 6 → **6** · trajetórias distintas: 2 → **1**

## Regressões — o que bloqueia

### agregado — era `PASSOU`, virou `REPROVOU`

_o que mudou?_

- capacidade-ausente: a resposta precisava de MOVIMENTO_AGREGADO e não exerceu; consultou: nada

Consultou: `nada` · redigiu: DETERMINISTICA (ERRO)
