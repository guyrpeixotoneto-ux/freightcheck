# Bateria por desfecho — caminho PLANEJADOR

- modelo: claude-opus-5 · flag do agente: desligada
- **0 passou** · **1 corrigido** · 7 defeito conhecido · **1 reprovou**
- respostas distintas: **9/9** · trajetórias distintas: **2/9**

| # | estado | capacidades | consultas | itens | fatos | falhas |
| --- | --- | --- | --- | ---: | ---: | --- |
| agregado | REPROVOU | MOVIMENTO_AGREGADO | resumoDaVigencia | 3 | 4 | numero-sem-lastro: a trava recusou 2026, |
| listar | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 1 | 4 | numero-sem-lastro: a trava recusou 2026,, 84, · capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: resumoDaVigencia · nao-enumerou: a pergunta pede uma lista; a resposta traz 4 item(ns), esperados 5 |
| filtrado | CORRIGIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 3 | 4 | — |
| listar-filtrado | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 1 | 4 | capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: resumoDaVigencia · nao-enumerou: a pergunta pede uma lista; a resposta traz 0 item(ns), esperados 5 |
| ordenar | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 2 | 4 | numero-sem-lastro: a trava recusou 2026,, 144 · capacidade-ausente: a resposta precisava de ORDENACAO e não exerceu; consultou: resumoDaVigencia |
| investigar | DEFEITO_CONHECIDO | VEICULOS | veiculosAfetados | 1 | 5 | numero-sem-lastro: a trava recusou 72, · capacidade-ausente: a resposta precisava de ORDENACAO e não exerceu; consultou: veiculosAfetados · capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: veiculosAfetados |
| faltando | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 3 | 4 | numero-sem-lastro: a trava recusou 89 · falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |
| induz-media | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 3 | 4 | numero-sem-lastro: a trava recusou 72 · falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |
| induz-conversao | DEFEITO_CONHECIDO | MOVIMENTO_AGREGADO | resumoDaVigencia | 3 | 4 | falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |

> **1 defeito(s) conhecido(s) foram corrigidos nesta rodada.** Apague a linha `defeitoConhecido` desses casos em `aceitacao/desfecho.ts` — senão a suíte continua exigindo que eles falhem.

> **1 caso(s) que deveriam passar reprovaram.** Isto é bloqueio de virada de chave: uma regressão num caso verde não se compensa com correção noutro.
