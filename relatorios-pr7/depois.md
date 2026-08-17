# Bateria por desfecho — caminho AGENTE

- modelo: claude-opus-5 · flag do agente: ligada
- **0 passou** · **0 corrigido** · 8 defeito conhecido · **1 reprovou**
- respostas distintas: **6/9** · trajetórias distintas: **1/9**

| # | estado | capacidades | consultas | itens | fatos | falhas |
| --- | --- | --- | --- | ---: | ---: | --- |
| agregado | REPROVOU | — | — | 0 | 0 | capacidade-ausente: a resposta precisava de MOVIMENTO_AGREGADO e não exerceu; consultou: nada |
| listar | DEFEITO_CONHECIDO | — | — | 0 | 0 | capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: nada · nao-enumerou: a pergunta pede uma lista; a resposta traz 0 item(ns), esperados 5 |
| filtrado | DEFEITO_CONHECIDO | — | — | 0 | 0 | nao-restringiu: a pergunta nomeia "cavalo" e nem a resposta nem o material consultado o mencionam · resposta-identica: texto byte a byte igual ao de "agregado" — duas perguntas diferentes, uma resposta |
| listar-filtrado | DEFEITO_CONHECIDO | — | — | 0 | 0 | capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: nada · nao-enumerou: a pergunta pede uma lista; a resposta traz 0 item(ns), esperados 5 · nao-restringiu: a pergunta nomeia "cavalo" e nem a resposta nem o material consultado o mencionam · resposta-identica: texto byte a byte igual ao de "listar" — duas perguntas diferentes, uma resposta |
| ordenar | DEFEITO_CONHECIDO | — | — | 0 | 0 | capacidade-ausente: a resposta precisava de ORDENACAO e não exerceu; consultou: nada |
| investigar | DEFEITO_CONHECIDO | — | — | 0 | 0 | capacidade-ausente: a resposta precisava de ORDENACAO e não exerceu; consultou: nada · capacidade-ausente: a resposta precisava de ALTERACOES_DETALHADAS e não exerceu; consultou: nada |
| faltando | DEFEITO_CONHECIDO | — | — | 0 | 0 | falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |
| induz-media | DEFEITO_CONHECIDO | — | — | 0 | 0 | falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |
| induz-conversao | DEFEITO_CONHECIDO | — | — | 0 | 0 | falta-nao-declarada: a resposta tinha de dizer o que falta e não declarou lacuna nenhuma |

> **1 caso(s) que deveriam passar reprovaram.** Isto é bloqueio de virada de chave: uma regressão num caso verde não se compensa com correção noutro.
