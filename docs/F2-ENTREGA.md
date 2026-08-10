# FreightCheck — Entrega F2 (Curadoria)

> Escopo: dicionário de atributos, taxonomia da remuneração e tela de
> confirmação. Motor financeiro, waterfall, IA, alertas, fórmulas, motor de
> comparação (F3) e as demais telas (F5) **não** foram implementados.
>
> Confirmado por você: `entity_type_set` como componente da chave de negócio.

---

## 1. A regra que governa tudo em F2

**O motor propõe. Só uma pessoa confirma. O banco decide o que pode ser confirmado.**

Isso não é política de código — são duas constraints:

```sql
-- Nenhum CONFIRMED sem responsável identificado.
CHECK (semantics_status <> 'CONFIRMED'
       OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))

-- Nenhum monetário CONFIRMED sem saber o que seus números significam.
CHECK (semantics_status <> 'CONFIRMED'
       OR is_monetary IS NOT TRUE
       OR (unit IS NOT NULL AND periodicity IS NOT NULL AND aggregation IS NOT NULL))
```

Qualquer coisa que escreva na tabela — o pipeline de importação, um script
solto, uma futura camada de IA — esbarra nelas. Como o motor financeiro de F4
só vai ler atributos `CONFIRMED`, essas duas linhas são o que protege todo
número que o produto vai exibir.

---

## 2. Schema — migration `0002_curation_layer`

| Tabela | Papel |
|---|---|
| `taxonomy_node` | Hierarquia da remuneração. Auto-referente, profundidade livre, `path` materializado. `cost_class` declarado na classe e herdado pelos descendentes |
| `curation_event` | **Toda** alteração nossa, como `CURATION_CHANGE`: quem, quando, campo, antes, depois, por quê |

Colunas novas em `attribute`: `taxonomy_node_id`, `semantics_rationale`,
`confirmed_by`, `confirmed_at`.

### Por que não existe tabela temporal de classificação

A §7 da arquitetura pedia taxonomia versionada. O histórico vive em
`curation_event`, que já registra antes e depois de cada reclassificação — a
alternativa (duplicar nós a cada mudança) guardaria a mesma informação duas
vezes. Segue o ajuste 9: nada criado por precaução.

---

## 3. Categorias de mudança (ajuste 6) — agora concreto

`curation_event.change_category` existe e hoje só recebe `CURATION_CHANGE`.
F3 escreverá `SOURCE_CHANGE` e `FLEET_CHANGE` em tabelas próprias.

A separação é estrutural, não convencional: **nada em F2 escreve em `fact`.**
Taxonomia, unidade, agregação e semântica moram em `attribute` (nosso lado);
valor e layout moram em `fact` e `snapshot_attribute` (lado da Ambev). Um teste
tira o `md5` de todos os 83.241 `value_hash` antes e depois de rodar o passe de
proposta e uma confirmação, e exige que sejam idênticos.

---

## 4. O motor de proposta

Roda sobre todos os atributos não confirmados e deriva unidade, agregação,
classificação e materialidade **da evidência**, gravando a justificativa.

### Três recusas deliberadas

**1. Periodicidade nunca é proposta.** É o único campo que o motor se recusa a
preencher, porque é justamente onde os nomes deste export mentem.

**2. Conflito de periodicidade bloqueia os dois lados.** Quando existem `X` e
`X_mensal` e o "mensal" não é aproximadamente 1/12 do outro, ambos voltam para
`UNKNOWN` com a explicação. Nos dados reais:

```
"ipvaLicenciamentoMensal" soma 23.343,88 enquanto "ipvaLicenciamento"
soma 10.875,69 — razão de 2,15×. Um valor mensal deveria ser cerca de
1/12 do anual. A nomenclatura não descreve o conteúdo.
```

`cavalo.ipva_licenciamento` **não** é bloqueado — não tem par conflitante. O
bloqueio é dirigido pela evidência, não pelo nome.

**3. Magnitude tem que concordar com o nome.** Um atributo com cara de dinheiro
cujo maior valor é pequeno demais para um ativo desta frota não recebe
proposta de `SUM`. Isso pegou erros reais que teriam produzido somas erradas:

| Atributo | Maior valor | O que realmente é |
|---|--:|---|
| `cavalo.custo_variavel_simulado` | ~5 | R$/km, não montante |
| `carreta.icms` | 12 | alíquota de 12%, não valor (o valor é `valorIcms`) |
| `carreta.pis_cofins` | 9,3 | alíquota, não valor (o valor é `valorPisCofins`) |
| `periodo_finame` | 60 | prazo em meses, não reais |

---

## 5. Resultado sobre os dados reais

```
TAXONOMIA ............ 22 nós
Atributos examinados . 138
  PRESUMED ........... 110  (26 monetários)
  UNKNOWN ............  28  ( 0 monetários)
Fora da taxonomia ....   3
Conflitos ............   1  (par ipvaLicenciamento)
```

Fila ordenada por materialidade — os monetários primeiro, por magnitude:

| # | Atributo | Unid. | Agreg. | Magnitude* |
|--:|---|---|---|--:|
| 1 | `cavalo.valor_nf_compra` | BRL | SUM | 41.382.629 |
| 2 | `carreta.valor_nf_compra` | BRL | SUM | 17.127.809 |
| 3 | `cavalo.valor_pis_cofins` | BRL | SUM | 3.827.893 |
| 4 | `carreta.valor_pis_cofins` | BRL | SUM | 1.584.322 |
| 5 | `carreta.custo_fixo` | BRL | SUM | 1.204.664 |
| 6 | `carreta.finame` | BRL | SUM | 1.122.609 |
| 7 | `cavalo.finame_cavalo` | BRL | SUM | 867.860 |
| 8 | `cavalo.amortizacao_cavalo` | BRL | SUM | 529.368 |

\* soma bruta não auditada da última vigência. Serve **só** para priorizar — é
exatamente o que a curadoria vai tornar confiável. A tela diz isso com todas as
letras.

---

## 6. Tela `/curadoria`

Fila à esquerda (filtro, pendentes × todos), painel à direita com:

- a proposta do sistema e sua justificativa — conflito em vermelho;
- **valores reais com origem**: vigência, valor canônico, aba · linha · coluna,
  valor original e tipo original da célula;
- formulário de confirmação com responsável e justificativa **obrigatórios**;
- bloqueio visual quando é monetário e falta unidade, periodicidade ou agregação;
- histórico de curadoria do atributo.

## 7. API

| Método | Rota |
|---|---|
| GET | `/api/curation/summary` |
| GET | `/api/curation/queue?includeConfirmed=` |
| GET | `/api/curation/attributes/:code` |
| POST | `/api/curation/attributes/:code/confirm` |
| GET | `/api/curation/taxonomy?flat=` |
| POST | `/api/curation/proposal-pass` |

Recusas voltam `422` com mensagem escrita para ser lida pelo curador:

```
"carreta.custo_fixo" é monetário: unidade, periodicidade e forma de
agregação precisam estar definidas antes de confirmar. Sem isso, somar
este atributo é adivinhação.
```

---

## 8. Testes — 37 em F2 (100 no total)

`pnpm --filter @workspace/curation run test`

| Arquivo | Testes | Cobre |
|---|--:|---|
| `semantics.test.ts` | 13 | Periodicidade nunca inferida, razões não agregáveis, ano ≠ quantidade, coluna MIXED, detecção de conflito, checagem de magnitude, mapeamento da taxonomia |
| `confirmations.test.ts` | 8 | Registro atribuído a pessoa com base declarada, alíquota nunca monetária, aplicação idempotente, fatos intactos, atributo ausente reportado |
| `curation.test.ts` | 16 | Passe não confirma nada, é idempotente, grava rationale; conflito real bloqueia os dois lados; banco recusa CONFIRMED sem responsável e monetário incompleto (SQL cru); confirmação registra quem e por quê; **fatos intactos** (md5 antes/depois); ordenação da fila |

---

## 9. Estado do repositório

| Item | Situação |
|---|---|
| Migrations | `0000`, `0001`, `0002` — versionadas |
| `typecheck:libs` | limpo |
| `api-server` typecheck | limpo |
| `freightaudit` typecheck | os mesmos **11 erros pré-existentes** de `origin/main`; `curadoria.tsx` não adiciona nenhum |
| Telas do menu | `Dashboard`, `Snapshots`, `Alterações`, `Comparar Modelos`, `Simulação`, `Importações` continuam **sem backend** — serão religadas em F5. `Análise de Frota` e `Curadoria` funcionam |
| `vite.config.ts` | ganhou proxy `/api` opcional via `API_PROXY_TARGET`, para rodar fora do Replit. Sem a variável, nada muda |

---

## 10. Confirmações registradas

Decisões suas viram artefato versionado em
`lib/curation/src/confirmations.ts` — diffável, atribuída e replicável em
qualquer banco novo. Aplicar o registro passa pelas mesmas guardas da tela;
adicionar uma linha lá **é** o ato humano, revisável num pull request.

| Atributo | Semântica | Base |
|---|---|---|
| `carreta.custo_fixo` | BRL · MENSAL · SUM · monetário | Confirmado por você em 10/08/2026 |
| `carreta.icms` | PERCENT · sem periodicidade · NONE · não monetário | Alíquota, não valor — o montante é `valorIcms` |
| `carreta.pis_cofins` | PERCENT · sem periodicidade · NONE · não monetário | Alíquota, não valor — o montante é `valorPisCofins` |

Estado após aplicar: **3 CONFIRMED · 109 PRESUMED · 26 UNKNOWN.**

`icms` e `pis_cofins` saíram de "montante presumido" para alíquota, então nunca
mais entram numa soma. Alíquota não tem periodicidade: não é um valor que se
acumula no tempo.

### Dois achados que apareceram ao registrar isso

**1. `valorIcms` é zero em 100% das linhas.** Todas as 657 carretas e 558
cavalos, nas 9 vigências. Existe alíquota de ICMS (7% ou 12%), mas o montante
correspondente nunca é preenchido no export. Ou o ICMS não é repassado na
remuneração, ou a coluna simplesmente não é alimentada — vale perguntar à
Ambev, porque a diferença entre as duas hipóteses é dinheiro.

**2. A alíquota de ICMS de uma carreta subiu de 7% para 12% em Fev/2026.**

| Vigência | alíq. 0 | alíq. 7 | alíq. 12 |
|---|--:|--:|--:|
| Dez/2025 | 24 | 24 | 0 |
| Jan/2026 | 24 | 24 | 0 |
| **Fev/2026** | 24 | 24 | **1** |
| … | | | 1 |
| Ago/2026 | 21 | 24 | 1 |

Uma placa, uma vigência, +5 pontos de alíquota. É exatamente o tipo de mudança
silenciosa que o F3 vai passar a apontar sozinho. Note também que `carreta`
carrega **duas** colunas de alíquota ICMS com valores diferentes: `icms`
(0 / 7 / 12) e `percentualIcms` (constante 18). Não sei o que distingue as duas
— fica na fila de curadoria.

---

## 11. Decisões pendentes

1. **Periodicidade dos 25 monetários restantes.** O motor não vai propor, por
   desenho. Precisa de você — ou do dicionário de campos do Freightec. É o que
   separa F2 de "concluído".
2. **O par `ipvaLicenciamento` / `ipvaLicenciamentoMensal`.** Bloqueado pelo
   conflito; nenhum dos dois entra em cálculo até você dizer o que cada um é.
3. **`valorIcms` sempre zero** — ICMS não repassado, ou coluna não alimentada?
4. **`icms` (0/7/12) × `percentualIcms` (18)** — duas alíquotas ICMS em
   carretas, com valores diferentes. O que distingue as duas?
5. **Bloquear promoção com ERROR** (herdado de F1): os 18 conflitos de chassi
   surgem durante a promoção e hoje não a impedem.
