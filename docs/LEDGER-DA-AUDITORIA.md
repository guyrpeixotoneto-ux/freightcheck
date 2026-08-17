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

## Contagem

| | |
|---|---|
| **Feitos** | 12 (PR-1, 2, 4, 5, 6, 7, 8, 9, 10, 10b, 11, 12) |
| **Absorvidos** | 1 (PR-16, cumprido pelo PR-10b) |
| **Não existiu** | 1 (PR-3, dobrado no PR-4 — ver nota) |
| **Faltam** | **7**: PR-13, 14, 15, 17, 18, 19, 20 |

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
| **PR-13** | `getOverview` filtra vivas e recorta por contexto | **a fazer** | — | — | A auditoria mediu: cinco contadores do Painel somam revisões substituídas |
| **PR-14** | `ContextBar` nas telas que recortam por contexto | **a fazer** | — | — | Encerra a dívida do `scope_hash` legado em `resolveContext` |
| **PR-15** | Fleet Analysis passa a ler o canônico | **a fazer** | — | — | Executa o mapa do PR-4. **Regra**: toda diferença numérica classificada como bug antigo, diferença de modelagem ou decisão de negócio pendente — nunca resolvida em silêncio |
| ~~**PR-16**~~ | Teste que impede `status <> 'SUPERSEDED'` à mão | **absorvido pelo PR-10b** | `e5f8dc7` | `fronteira-da-disponibilidade.test.ts` | Restou só a varredura por consultas paralelas remanescentes, que entra no PR-17 |
| **PR-17** | **A matriz de propagação por porta** | **a fazer** | — | — | O segundo grande objetivo da auditoria. Ver contrato abaixo |

## P3 — semântica de estados vazios

| PR | Objetivo | Status | Commit | Testes | Evidência |
|---|---|---|---|---|---|
| **PR-18** | Separar as quatro causas de vazio do Impacto | **a fazer** | — | — | — |
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
