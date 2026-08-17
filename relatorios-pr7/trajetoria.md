# Trajetória de ferramentas — PR 2

- modelo: claude-opus-5
- flag `ASSISTENTE_AGENTE`: ligada
- ferramentas registradas: alteracoes, recortes, parametros, serie, comparar, ordenacao, veiculos, resultado, documentos, estado_do_dado

Este relatório mede **o que foi consultado**, não a qualidade do texto. A pergunta que ele responde é uma só: perguntas semanticamente diferentes produzem trajetórias diferentes?

## A. Caminho atual — o planejador determinístico

| pergunta | consultas | fatos entregues |
| --- | --- | ---: |
| o que mudou? | `resumoDaVigencia` | 4 |
| o que mudou nos cavalos? | `resumoDaVigencia` | 4 |
| liste as alterações dos cavalos | `resumoDaVigencia` | 4 |

Trajetórias distintas: **1 de 3**. Textos distintos: **2 de 3**.

> As três perguntas produzem a **mesma** trajetória. Nenhum modelo distingue três perguntas que recebem o mesmo material — é o limite que o PR 2 existe para tirar.

## B. Caminho do agente — o laço de tool use

### o que mudou?

1 rodada(s) · parou por `ERRO` · 11 tokens de entrada · 0 de saída · 200 ms · erro: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Ce7NBktrsavr8P3fcV1pk"}

**Trajetória.** `(nenhuma consulta)`

| # | ferramenta | argumentos | ok | ms | evidência que voltou | números |
| --- | --- | --- | --- | ---: | --- | ---: |

### o que mudou nos cavalos?

1 rodada(s) · parou por `ERRO` · 14 tokens de entrada · 0 de saída · 106 ms · erro: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Ce7NBmgjdzrRyHiMK3H6T"}

**Trajetória.** `(nenhuma consulta)`

| # | ferramenta | argumentos | ok | ms | evidência que voltou | números |
| --- | --- | --- | --- | ---: | --- | ---: |

### liste as alterações dos cavalos

1 rodada(s) · parou por `ERRO` · 16 tokens de entrada · 0 de saída · 101 ms · erro: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Ce7NBnR8rvkexZe1TC1Ro"}

**Trajetória.** `(nenhuma consulta)`

| # | ferramenta | argumentos | ok | ms | evidência que voltou | números |
| --- | --- | --- | --- | ---: | --- | ---: |

## C. Veredito

| pergunta | trajetória |
| --- | --- |
| o que mudou? | `` |
| o que mudou nos cavalos? | `` |
| liste as alterações dos cavalos | `` |

Trajetórias distintas: **1 de 3** (o caminho atual produz 1).

> **Não passou.** Duas ou mais perguntas produziram a mesma trajetória. Antes de mexer no prompt, olhe a coluna de argumentos: o padrão mais comum é o modelo chamar o nível certo e esquecer o filtro, e isso se corrige na descrição do campo, não na instrução do sistema.

## O que este relatório não mede

Qualidade de prosa, correção factual e utilidade da resposta. A coluna de texto está aqui para leitura, não para nota — a régua de qualidade é a bateria de aceitação, que roda em separado.