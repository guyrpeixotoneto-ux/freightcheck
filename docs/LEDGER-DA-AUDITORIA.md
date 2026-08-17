# Ledger da auditoria de ingestão e propagação

> **O que este arquivo é.** O controle único da sequência de correções. Uma
> linha por PR, com objetivo, status, commit, testes e evidência. Ele existe
> porque rastreabilidade contada de memória não é rastreabilidade: sem um lugar
> só, "o PR-16 já foi absorvido pelo PR-10b" vira uma frase que alguém lembra ou
> não, e a contagem do que falta passa a depender de quem conta.
>
> **O que ele não é.** Não é o plano nem a análise. O plano está em
> `AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte I; a análise que o justifica, em
> `AUDITORIA-INGESTAO-PROPAGACAO.md`. Aqui só o estado.
>
> **Regra de encerramento.** Um PR só é `feito` com execução limpa dos testes
> relevantes — limpa quer dizer: nenhuma outra suíte rodando ao mesmo tempo
> contra o mesmo Postgres, e nenhuma edição em curso na árvore. Enquanto a
> execução não fechar, o status é `aguardando suíte`.

---

## Última execução limpa

Depois do PR-12 (`2232b1c`). Uma suíte por vez, árvore parada.

| Pacote | Arquivos | Testes |
|---|---|---|
| `@workspace/db` | 8 | 83 |
| `@workspace/availability` | 3 | 32 |
| `@workspace/ingest` | 16 | 292 |
| `@workspace/curation` | 3 | 45 |
| `@workspace/comparison` | 20 | 284 |
| `@workspace/composition` | 3 | 64 |
| `@workspace/coverage` | 3 | 73 |
| `@workspace/dre` | 6 | 75 |
| `@workspace/balance` | 2 | 16 |
| `api-server` | 20 | 279 |
| **Total** | **84** | **1.043** |

`pnpm run typecheck` do monorepo inteiro também passa.

Depois do PR-13 (`61f3a2d`), sobre os pacotes afetados: `comparison` 284,
`composition` 64, `coverage` 73, `dre` 75, `balance` 16, `api-server` **288**
(os 9 de `painel.test.ts`), `assistant` **209 passados e 119 pulados**.

Depois do PR-17 (`d5dbff1`), sobre os pacotes afetados: `comparison` 284,
`coverage` 73, `dre` 75, `composition` 64, `api-server` **296** (os 8 da
matriz). A promoção passou a disparar o backfill de comparações e nenhuma
suíte quebrou — as que promovem e depois leem `change_set` agora encontram o
estado que a produção terá.

Depois do PR-14 (`74fa562`): `freightaudit` **141** (eram 129 — os 8 de
`contexto.test.ts` e os 4 da fronteira do contexto), `api-server` 296
inalterado, que era o esperado num PR só de interface.

Depois do PR-15 (`c15db11`): `comparison` 284, `coverage` 73, `dre` 75,
`composition` 64, `balance` 16, `api-server` **306** (os 18 do contrato da
frota), `freightaudit` 141.

> **Os 119 pulados do `assistant` não são regressão desta sequência.** São
> `evals`, `fase1` e os dois de benchmark, que dependem de chave de API do
> modelo e se auto-pulam sem ela. Ficam registrados porque `assistant` entrou
> na verificação só a partir daqui — o PR-10b tocou `ferramentas.ts` e a suíte
> dele não tinha sido executada —, e um "209 passaram" sem a ressalva seria o
> tipo de número que esta auditoria existe para não deixar passar.

---

## Contagem

| | |
|---|---|
| **Feitos** | 16 (PR-1, 2, 4, 5, 6, 7, 8, 9, 10, 10b, 11, 12, 13, 14, 15, 17) |
| **Absorvidos** | 1 (PR-16, cumprido pelo PR-10b) |
| **Não existiu** | 1 (PR-3, dobrado no PR-4 — ver nota) |
| **Faltam** | **3**: PR-18 (aguardando suíte), 19, 20 |

> **Nota sobre PR-3.** O plano original tinha um PR-3 de caracterização da
> Análise de frota, separado do PR-4 que a mapeava. Os dois foram entregues como
> um: o teste de caracterização e o mapa de-para nasceram no mesmo commit
> porque um sem o outro não prova nada. Está registrado aqui para que a lacuna
> na numeração não vire dúvida depois.

---

## P1 — autoridade da série e da disponibilidade

| PR | Objetivo | Status | Commit | Testes | Evidência |
|---|---|---|---|---|---|
| **PR-1** | A porta paralela de `overview.ts` deixa de existir, e a regra das duas portas vira teste | **feito** | `b51175c` | `fronteira-de-ingestao.test.ts` (21) | Rota, superfície e tabela em três alturas. O caso de controle falhou primeiro e revelou que `pipeline.ts` não estava sendo visto pela varredura — foi ele que fez a rede ter malha |
| **PR-2** | Autoridade de escrita: a regra das duas portas conferida no driver | **feito** | `2c5c26e` | `autoridade.test.ts`, `autoridade-do-pipeline.test.ts` | Escrita fora de autoridade é recusada no choke point do pg; o pipeline real roda por conexão sem concessão |
| **PR-4** | O mapa da migração da Análise de frota, **sem** trocar a fonte | **feito** | `bf98aad` | `fleet-analysis-contrato.test.ts` (8) | De-para campo a campo, e quatro pontos de risco nomeados: `/12` à mão, soma entre unidades, `valorNfCompra` como magnitude, `Number(x)||0` |
| **PR-5** | A autoridade de disponibilidade, com contrato próprio. Nenhum consumidor migra | **feito** | `4377e91` | `disponibilidade.test.ts`, `export-real.test.ts` (31) | 15 cenários que o export real não tem, medidos contra Postgres |
| **PR-6** | Canal lido da coluna, não do rótulo | **feito** | `692eb58` | `propagacao-divergencias.test.ts` | `it.fails` de **D2** invertido, corpo intacto |
| **PR-7** | Contexto passa a ser `(canonical_scope, canal)` | **feito** | `468099c` | `propagacao-divergencias.test.ts`, `series-context.test.ts` | `it.fails` de **D1** invertido; `scope_hash` legado aceito por `resolveContext` (dívida com prazo no PR-14) |
| **PR-8** | `vigenciaAnterior` na autoridade; `findPreviousSnapshot` delega | **feito** | `e580a6e` | `disponibilidade.test.ts`, `consolidated.test.ts` | `null` mudo vira motivo nomeado. Guarda de `entity_type_set` mantida de propósito |
| **PR-9** | `entity_type_set` sai da série **e** comparação por componente | **feito** | `ee7ce52` | `propagacao-divergencias.test.ts` (+3), `comparison` (284) | `it.fails` de **D3** invertido. Export real idêntico: 3.202 alterações, +4/−11 na frota de abr→mai, zero coluna inventada |

## P2 — propagação

| PR | Objetivo | Status | Commit | Testes | Evidência |
|---|---|---|---|---|---|
| **PR-10** | Cobertura recorta pelo escopo canônico — dívida do §A.6 | **feito** | `1616b0f` | `coverage/cenarios.test.ts` (68) | Prova positiva: mesma unidade com CNPJ de duas grafias cai num recorte só. **Prova negativa**: com o recorte antigo, dois testes falham |
| **PR-10b** | "Vigência disponível" passa a ter dono | **feito** | `e5f8dc7` | `fronteira-da-disponibilidade.test.ts` (3) | 46 cópias de `status <> 'SUPERSEDED'` viram uma definição. **Prova negativa**: recopiar em `dre/apuracao.ts` faz a varredura apontar arquivo e linha |
| **PR-11** | O *antes* de um chamado vem da autoridade | **feito** | `d20014e` | `propagacao-chamados.test.ts` (5) | **Prova negativa**: com a consulta antiga, o chamado sobre placa de dois canais recebe `VIGENCIA` onde deve receber `AUSENTE`. Ressalva medida: o caso de cobertura **não** falha na versão antiga — lá o defeito era não-determinismo, e está dito no teste |
| **PR-12** | `janelaDosAtributos` exige o recorte, por assinatura | **feito** | `2232b1c` | `coverage/cenarios.test.ts` (73) | **Prova negativa**: com a janela antiga, os cinco casos falham vazando atributos de outros cenários |
| **PR-13** | `getOverview` filtra vivas e recorta por contexto | **feito** | `61f3a2d` | `painel.test.ts` (9) | Nove dos doze contadores liam o banco inteiro. **Prova negativa**: com os contadores antigos, três casos falham — 104 fatos contra 52 (o dobro exato, a revisão substituída), 3 vigências onde há 2 no recorte, e a data de janeiro de outra unidade vazando para Juiz de Fora. Mudança de significado declarada: os três contadores de dicionário passam a descrever as colunas **entregues** no recorte |
| **PR-14** | Um seletor de contexto na interface, e não quatro | **feito** | `74fa562` | `contexto.test.ts` (8), `fronteira-do-contexto.test.ts` (4) | A interface tinha **três** definições de contexto: `ContextBar` escrita e montada em lugar nenhum, o dropdown de Início e a barra de filtro de Parâmetros. Só Início sabia que trocar de unidade apaga a vigência. A regra virou função pura provada, a barra virou uma só, e uma varredura recusa a quarta. Três telas **não** montam a barra, com o motivo declarado no teste. A dívida do `scope_hash` legado foi **remarcada** para uma janela de calendário, não fechada |
| **PR-15** | Análise de frota passa a ler o canônico | **feito** | `c15db11` | `fleet-analysis-contrato.test.ts` (18) | A rota lia disco e devolvia **zero** — 657 linhas paradas no arquivo, medido antes de migrar. Não havia número a preservar, então tudo é bug comprovado, categoria (a); os quatro pontos do ADR têm um teste cada. **4.1 está ativo**: `cavalo.manutencao_ano` não tem periodicidade confirmada, e o campo vem `null` com motivo em vez de dividido por 12. **4.4 está armado e não exercitado**: `ausencias` veio vazio no export real. Ver ADR §6-bis |
| ~~**PR-16**~~ | Teste que impede `status <> 'SUPERSEDED'` à mão | **absorvido pelo PR-10b** | `e5f8dc7` | `fronteira-da-disponibilidade.test.ts` | Restou só a varredura por consultas paralelas remanescentes, que entra no PR-17 |
| **PR-17** | **A matriz de propagação por porta** | **feito** | `d5dbff1` | `matriz-de-propagacao.test.ts` (8) | 16 consumidores na porta 1 (14 RECEBEU, 2 NAO_APLICAVEL) e 7 na porta 2 (3 RECEBEU, 4 NAO_APLICAVEL). Diagnóstico de 6 elos para a DRE, com três cenários de quebra. **Achou uma quebra real**: `computeMissingChangeSets` nunca era chamado — a promoção não disparava o backfill, e Alterações · Planilha abria com "comparação ainda não calculada" em todas as séries. Corrigido no mesmo PR |

## P3 — semântica de estados vazios

| PR | Objetivo | Status | Commit | Testes | Evidência |
|---|---|---|---|---|---|
| **PR-18** | Vocabulário comum do vazio, e as quatro causas do Impacto | **aguardando suíte** | — | `vazio-do-impacto.test.ts` (5) | `Vazio` em `@workspace/availability`: `NAO_EXISTE`, `NAO_SE_APLICA`, `NAO_CALCULAVEL`, `FORA_DO_RECORTE` — a máquina de estados da Parte F, com a regra de ouro presa por asserção. `getQuinzenaMatrix` devolvia `null` nas quatro e a rota traduzia em `404 "Nenhuma vigência importada ainda."`. **Prova negativa**: com a frase única reinstalada, três casos falham, inclusive a regra de ouro |
| **PR-19** | `NOT_APPLICABLE` explícito em Composição e DRE | **a fazer** | — | — | — |
| **PR-20** | `import_decision` em Importações; `snapshot_merge` em Vigências | **a fazer** | — | — | — |

---

## O contrato do PR-17

Não são testes isolados. É uma **matriz**: para cada porta de entrada, o
caminho inteiro provado elo a elo —

```
entrada → ingestão → snapshot/fato canônico → resolução de contexto → módulo consumidor
```

Para cada módulo, o resultado tem de ser **um destes três**, e nunca "sem
dados" genérico:

| Veredito | Quando |
|---|---|
| `RECEBEU` | o módulo enxerga o dado que entrou |
| `AUSENTE COM CAUSA EXPLÍCITA` | não enxerga, e a causa está nomeada no próprio resultado |
| `NOT_APPLICABLE` | a pergunta não se aplica àquele módulo para aquele dado |

E pelo menos um cenário **ponta a ponta** que falhe se qualquer elo quebrar —
o cenário que originou esta auditoria: o dado importou corretamente e a DRE
Cavalo aparece vazia.

---

## A prova final consolidada

Ao fim da sequência, um documento que responda objetivamente, com teste ou
medição ao lado de cada resposta:

1. Quais são todas as portas de entrada?
2. Existe alguma terceira porta escondida?
3. Qual é a autoridade canônica?
4. Quais módulos consomem cada tipo de dado?
5. Como contexto, unidade, canal, vigência e série são resolvidos?
6. Como distinguimos ZERO, AUSENTE, NÃO APLICÁVEL e dado sem comparação?
7. Se um dado não aparecer na DRE Cavalo, qual teste ou diagnóstico mostra
   exatamente onde a propagação parou?
