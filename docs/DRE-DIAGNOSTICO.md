# DRE — Diagnóstico antes da implementação

> **Método:** banco real montado a partir de `attached_assets/Remuneração_Equipamento_Análise_FT.xlsx`
> pelo pipeline de produção (`receiveFile → captureRaw → stage → preview → promote`),
> taxonomia semeada e `CONFIRMED_SEMANTICS` aplicado. Todas as contagens e somas
> abaixo foram medidas nesse banco em 15/08/2026. Nenhum número deste documento
> foi estimado.
>
> **Universo medido:** 9 vigências (dez/2025 → ago/2026), 1 unidade (CAMAÇARI),
> 1 operador (OPERALOG), 1 canal (EMPURRADA), 62 cavalos + 71 carretas na última
> vigência, 138 atributos distintos, 82.241 fatos.

---

## A. O que já existe

### A.1 A infraestrutura da DRE já está construída — sob outro nome

O produto **já possui** quase toda a maquinaria que uma DRE por veículo exige.
Nada disto precisa ser criado:

| Necessidade da DRE | Onde já existe | Estado |
|---|---|---|
| Grão veículo × vigência | `fact (snapshot, entity, attribute)` | pronto |
| Vigência como eixo | `snapshot.effective_date` + identidade canônica | pronto |
| Rastreabilidade até a célula | `fact.raw_cell_id → raw_cell → raw_row → raw_sheet` | pronto |
| Ausência ≠ zero | `fact.is_null` + `null_reason`, com *check constraint* | pronto |
| Semântica versionada por data | `attribute_semantics` (unit, periodicity, aggregation, calculation_basis) | pronto |
| Portão financeiro | `semantics_status = CONFIRMED` exigido em `motivoDeExclusao` | pronto |
| Classificação em custo fixo/variável | `taxonomy_node.cost_class` + `attribute.taxonomy_node_id` | pronto |
| Antidupla contagem | `COMPOSITIONS` + `resolverRaizes` (`lib/comparison`, `lib/composition`) | pronto |
| Escopo cavalo × carreta × conjunto | `REGRAS.foraDoEscopo` (`lib/composition/src/regras.ts`) | pronto |
| Motor de alterações e impacto | `change_set`, `change`, `assessImpact` | pronto |
| Ponte alteração → total do veículo | `getAlteracoesDoEquipamento` (`explicado` / `naoAtribuido`) | pronto |
| Conversão de periodicidade auditável | `convertPeriodicity` (`lib/simulation`) | pronto |
| Consolidação por contexto | `resolveContext`, `contextFilter`, `getVisaoDeFrota` | pronto |

**Conclusão da auditoria de arquitetura: não existe justificativa para uma
arquitetura paralela.** A DRE é uma *releitura* do que `lib/composition` já
apura, organizada em seções contábeis, com normalização de periodicidade
declarada e uma métrica de cobertura. Ela não pode ter um segundo motor
financeiro — e, neste desenho, não tem: consome `comporDeFatos`.

### A.2 O que os dados sustentam hoje

17 atributos estão `CONFIRMED` (10 de carreta, 7 de cavalo). Todos monetários,
todos com periodicidade declarada, todos rastreáveis até a célula:

| Atributo | Unidade | Periodicidade | Ativos com valor (ago/26) | Soma (ago/26) |
|---|---|---|--:|--:|
| `carreta.custo_fixo` | BRL | MENSAL | 71 | 1.204.664,11 |
| `carreta.finame` | BRL | MENSAL | 71 | 1.122.608,83 |
| `carreta.finame_implemento` | BRL | MENSAL | 71 | 254.748,52 |
| `carreta.amortizacao_implemento` | BRL | MENSAL | 71 | 162.896,32 |
| `carreta.juros_finame_implemento` | BRL | MENSAL | 71 | 80.074,29 |
| `carreta.lucro_fixomodelo_novo_ciclo` | BRL | MENSAL | 71 | 82.055,25 |
| `cavalo.finame_cavalo` | BRL | MENSAL | 62 | 867.860,23 |
| `cavalo.amortizacao_cavalo` | BRL | MENSAL | 62 | 529.368,27 |
| `cavalo.juros_finame_cavalo` | BRL | MENSAL | 62 | 300.131,85 |
| `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | BRL | MENSAL | 62 | 38.359,95 |
| `cavalo.ipva_licenciamento` | BRL | **ANUAL** | 62 | 268.951,80 |
| `carreta.valor_nf_compra` | BRL | PONTUAL | 71 | 17.127.809,07 |
| `cavalo.valor_nf_compra` | BRL | PONTUAL | 62 | 41.382.628,64 |
| `carreta.valor_pis_cofins` | BRL | PONTUAL | 71 | 1.584.322,25 |
| `cavalo.valor_pis_cofins` | BRL | PONTUAL | 62 | 3.827.893,13 |
| `carreta.icms` | PERCENT | — | 46 | alíquota |
| `carreta.pis_cofins` | PERCENT | — | 47 | alíquota |

### A.3 A decomposição do conjunto fecha

Medido sobre os 558 pares cavalo–carreta das 9 vigências (`cavalo.placa_carreta`
liga os dois lados; 62 de 62 cavalos têm o vínculo preenchido em ago/26):

```
custo_fixo = amortizacao_cavalo + juros_finame_cavalo + lucro_fixo_cavalo
           + amortizacao_implemento + juros_finame_implemento + custo_aluguel
           + lucro_fixomodelo_novo_ciclo
```

fecha em **536 de 558 pares** com tolerância de R$ 0,02. Na última vigência, em
frota:

| Linha | ago/2026 |
|---|--:|
| `custo_fixo` do conjunto (62 conjuntos) | **1.160.433,77** |
| Amortização (cavalo + implemento) | 661.928,73 |
| Juros FINAME (cavalo + implemento) | 366.311,66 |
| Aluguel de implemento | 11.777,92 |
| Lucro fixo (cavalo + novo ciclo) | 120.415,20 |
| **Soma das parcelas** | **1.160.433,51** |
| **Divergência** | **0,26** |

Vinte e seis centavos em R$ 1,16 milhão. A decomposição é exaustiva e disjunta em
frota — é ela que autoriza uma DRE por conjunto sem dupla contagem.

---

## B. O que falta — e a descoberta que muda o desenho

### B.1 A descoberta central: **este export não é um demonstrativo de custos. É uma tarifa.**

O arquivo é `Remuneração_Equipamento`. A raiz da taxonomia é `Remuneração`. O
comentário que sustenta a exibição do valor divergente diz, literalmente, *"o
valor exibido continua sendo o da fonte, que é o que a Ambev paga"*.

Isso tem uma consequência que precisa estar escrita antes de qualquer linha de
código: **as colunas chamadas "custo" não são custo incorrido pelo transportador.
São as parcelas com que a tarifa foi construída.** `amortizacaoCavalo`,
`jurosFinameCavalo` e `ipvaLicenciamento` não dizem quanto o transportador
gastou — dizem quanto desses itens a Ambev reconheceu ao montar o preço.

Daí decorre o risco de circularidade. Como

```
custo_fixo = (parcelas de custo) + (lucro fixo)
```

subtrair as parcelas da receita devolve **exatamente as linhas de lucro**. O
resultado é uma identidade aritmética, não uma medição. Uma DRE que apresentasse
esse número como "resultado econômico do caminhão" estaria apresentando um
rearranjo da própria receita com cara de apuração.

**Isso não invalida a DRE — muda o que ela afirma.** O que se pode apurar hoje,
com integridade, é a **margem que o contrato embute em cada veículo**, e o
módulo tem de dizer isso na tela, não numa nota de rodapé.

### B.2 O que simplesmente não existe no dado

Medido coluna a coluna. Nada aqui foi inferido de nome:

| Linha pedida | Situação medida |
|---|---|
| Diesel | **Não existe.** Há `combustivelConsumoBenchmark` (km/l), `combustivelCapacidade` (litros do tanque) e `tipoCombustivel`. Não há litros consumidos, não há preço, não há km. |
| Arla | **Não existe.** Nenhuma coluna. |
| Pneus | **Coluna existe, dado não.** `carreta.valor_pneus` e `cavalo.valor_pneu` são **zero em 657/657 e 558/558 linhas**, valor distinto único. |
| Manutenção | **Só taxa.** `manutencaoReaisKm` (R$/km, média 0,26) e `manutencaoBid` (R$/km, média 0,38). Sem km, não viram montante. |
| Pedágio / lavagem / lubrificação / peças | **Não existem.** Nenhuma coluna. |
| Motorista / encargos | **Não existem.** Nenhuma coluna. |
| Seguro | **Parcial.** `carreta.seguro` existe (média 503,01) mas está `PRESUMED`; o cavalo não tem equivalente. |
| Rastreamento / telemetria | **Coluna existe, dado não.** `carreta.rastreador` é zero em 657/657. |
| Depreciação contábil | **Não existe.** `amortizacao*` é amortização do principal do FINAME — obrigação financeira, não depreciação. |
| ICMS / PIS-COFINS sobre a receita | **Não existem.** `valorIcms` é zero em 1.215/1.215. `valorPisCofins` é `PONTUAL`, incide sobre a **nota de compra do ativo**, não sobre a prestação. |
| Remuneração variável / por km / produtividade | **Insuficiente.** `lucroVariavelPrevisto` existe (média 4.150,22) mas está `PRESUMED`, sem periodicidade confirmada, e é **previsto** — não realizado. |
| km rodados, km produtivos/improdutivos | **Não existem.** `odometroEntrada` é o hodômetro **na entrada** — um estoque, não um fluxo do período. |
| Dias disponíveis / operados / utilização | **Não existem.** Nenhuma coluna. |

### B.3 Consequências diretas, sem rodeio

1. **Nenhum indicador por km é calculável.** Nem receita/km, nem custo/km, nem
   resultado/km, nem R$/km de qualquer natureza. Falta o denominador, e ele não
   está no export. Isso já estava registrado no produto como `BASE_QUE_FALTA`.
2. **Margem de contribuição é inapurável.** Ela é receita menos custo variável, e
   **zero linhas de custo variável têm dado**.
3. **EBITDA é inapurável.** Com diesel, pneus, manutenção e motorista ausentes, o
   "EBITDA" sairia em 97% da receita — um número tecnicamente produzível e
   inteiramente falso. Este módulo **recusa-se a exibi-lo** e diz por quê.
4. **Nenhum indicador de utilização é calculável.** Faltam dias e km.

O que **é** apurável, e com rastreabilidade total:

```
Receita contratada mensal        1.160.433,77
(−) Amortização FINAME             661.928,73
(−) Juros FINAME                   366.311,66
(−) Aluguel de implemento           11.777,92
(−) IPVA/licenciamento (anual÷12)   22.412,65   ← projeção linear, marcada
= Resultado econômico apurado       98.002,81   (8,45% da receita)
```

---

## C. Mapeamento linha a linha

Cobertura = ativos com valor observado ÷ ativos do escopo na última vigência.

| Linha da DRE | Origem | Atributos encontrados | Periodicidade | Cobertura |
|---|---|---|---|--:|
| Remuneração fixa mensal | export, confirmado | `carreta.custo_fixo` (conjunto) · `cavalo.finame_cavalo` · `carreta.finame_implemento` + `carreta.lucro_fixomodelo_novo_ciclo` | MENSAL | **100%** |
| Remuneração variável | export, presumido | `lucro_variavel_previsto*` | não confirmada | **0%** (bloqueado no portão) |
| Adicionais / produtividade | — | nenhum | — | **0%** |
| Deduções (ICMS, PIS/COFINS s/ receita) | — | `valor_icms` (zero em 100%) | — | **0%** |
| Diesel | — | nenhum | — | **0%** |
| Arla | — | nenhum | — | **0%** |
| Pneus | export, sem dado | `valor_pneus`, `valor_pneu` (zero em 100%) | — | **0%** |
| Manutenção | export, taxa | `manutencao_reais_km`, `manutencao_bid` (BRL/km) | — | **0%** (falta km) |
| Pedágio / lavagem / peças | — | nenhum | — | **0%** |
| Motorista e encargos | — | nenhum | — | **0%** |
| Seguro | export, presumido | `carreta.seguro` | não confirmada | **0%** (bloqueado no portão) |
| IPVA e licenciamento | export, confirmado | `cavalo.ipva_licenciamento` | **ANUAL** → ÷12 | **100%** (cavalo) |
| Aluguel de implemento | export, confirmado | `carreta.custo_aluguel` | MENSAL | **100%** |
| Rastreamento | export, sem dado | `carreta.rastreador` (zero em 100%) | — | **0%** |
| Amortização FINAME | export, confirmado | `amortizacao_cavalo`, `amortizacao_implemento` | MENSAL | **100%** |
| Juros FINAME | export, confirmado | `juros_finame_cavalo`, `juros_finame_implemento` | MENSAL | **100%** |
| Depreciação contábil | — | nenhum | — | **0%** |
| km rodados | — | nenhum (`odometro_entrada` é estoque) | — | **0%** |
| Dias operados / utilização | — | nenhum | — | **0%** |

**8 de 19 linhas têm dado. 11 não têm.** A cobertura ponderada por relevância
está no módulo, calculada — não estipulada.

---

## D. Modelo proposto

### D.1 Um pacote, uma autoridade

`lib/dre` — novo pacote, sem tabela nova, sem migration. Ele **lê**
`comporDeFatos` de `@workspace/composition` e reorganiza o resultado. A regra
de §30 fica estruturalmente garantida: a API, a tela e o Assistente chamam a
mesma função, e não há aritmética financeira em nenhum dos três.

```
fact ──► comporDeFatos ──► linhas + naoApurados   (motor de composição, já existe)
                                  │
                                  ▼
                        PLANO_DA_DRE  (registro declarativo: atributo → linha)
                                  │
                                  ▼
                normalizarPeriodicidade (@workspace/simulation)
                                  │
                                  ▼
                    ApuracaoDaDRE  ── cobertura, subtotais, rastro
                         │      │       │
                         │      │       └── ponte de alterações (change/impact)
                         │      └── consolidação (numerador/denominador)
                         └── API → tela → assistente
```

### D.2 O registro `PLANO_DA_DRE`

Cada componente declara, em código e com evidência revisável em pull request —
mesma disciplina de `CONFIRMED_SEMANTICS` e `COMPOSITIONS`:

- `secao` — RECEITA_BRUTA, DEDUCOES, CUSTO_VARIAVEL, CUSTO_FIXO, DEPRECIACAO_FINANCEIRO;
- `escopo` — **CAVALO | CARRETA | CONJUNTO | UNIDADE | FROTA** (§18);
- `fontes` — os atributos canônicos por tipo de equipamento;
- `ausencia` — quando não há fonte: o motivo, e **o que destravaria**;
- `evidencia` — a medição que sustenta a entrada.

Um componente sem fonte não é uma linha zerada: é uma linha `NAO_DISPONIVEL`,
com motivo nomeado, que entra na cobertura como lacuna.

### D.3 Quatro naturezas de valor (§4)

| Natureza | Significado | Entra em subtotal? |
|---|---|---|
| `OBSERVADO` | veio do export, semântica confirmada, sem transformação | sim |
| `CALCULADO` | derivado por regra declarada (soma de parcelas, conversão de periodicidade) | sim, com o rastro da transformação |
| `PRESUMIDO` | existe valor, mas a semântica não está confirmada | **não** — fica listado à parte |
| `NAO_DISPONIVEL` | não há dado | **não** — e o subtotal que dependia dele fica inconclusivo |

### D.4 Competência (§21)

O produto tem hoje quatro datas distintas, e elas nunca podem se misturar:
`import_run.created_at` (quando importamos), o rótulo do arquivo
(`EMPURRADA_1_8_2026`), `snapshot.effective_date` (derivado do rótulo por regra
testada) e `attribute_semantics.effective_from` (desde quando o significado vale).

**Autoridade única proposta:** a competência da DRE é
`snapshot.effective_date` da vigência ativa do contexto, e nada mais. É a única
das quatro que descreve *o negócio* e não *o processamento*, e é a que
`attribute_semantics` já usa como eixo — o que faz a semântica correta de cada
número ser a que valia na competência dele, sem join adicional. As outras três
aparecem no rastro de cada linha, nunca como eixo de agregação.

### D.5 Periodicidade (§20)

Nenhuma soma cruza periodicidade sem passar por `convertPeriodicity`, que já
existe e já classifica o resultado em `EXATA | PROJECAO_LINEAR |
PONTUAL_INTEGRAL`. O IPVA anual de um cavalo entra na DRE mensal como
`valor ÷ 12`, marcado `PROJECAO_LINEAR`, com o valor original preservado no
rastro. `PONTUAL` (valor da NF, PIS/COFINS de aquisição) **não converte** e
portanto **não entra na DRE de resultado** — aparece numa seção patrimonial
separada, exatamente como a gaveta `AQUISICAO` já faz na Composição.

### D.6 Alocação cavalo × carreta × conjunto (§18)

Regra explícita, derivada da medição de A.3:

| Componente | Escopo | Por quê |
|---|---|---|
| `carreta.custo_fixo`, `carreta.finame` | **CONJUNTO** | contêm o cavalo — medido em 558/558 |
| `cavalo.finame_cavalo` e parcelas | **CAVALO** | remuneram o cavalo |
| `carreta.finame_implemento` e parcelas | **CARRETA** | remuneram o implemento |
| `carreta.lucro_fixomodelo_novo_ciclo` | **CARRETA** | volta a ser raiz quando `custo_fixo` sai por escopo |
| `cavalo.ipva_licenciamento` | **CAVALO** | tributo do cavalo |

A DRE de **CONJUNTO** usa `carreta.custo_fixo` como receita e as parcelas dos dois
lados como custo. A de **CAVALO** e a de **CARRETA** usam as respectivas raízes.
Somar cavalo + carreta **não** é somar conjunto, e o módulo nunca faz as duas
coisas no mesmo total.

**Órfãos medidos:** das 71 carretas de ago/26, 62 são apontadas por um cavalo e
**9 não são**. Elas não somem e não são atribuídas a cavalo nenhum: entram na
consolidação como unidades econômicas próprias, contadas uma vez.

### D.7 Rateio (§19)

Nenhum rateio é implementado agora, porque **não há custo compartilhado no dado**
para ratear — nenhuma coluna de unidade, administração ou overhead existe. A
interface do registro já prevê `escopo: UNIDADE | FROTA` com regra de rateio
declarada; enquanto não houver dado, ela fica vazia. Criar um rateio de um custo
inexistente seria inventar o custo.

---

## E. Riscos

| Risco | Gravidade | Mitigação implementada |
|---|---|---|
| **Circularidade** — subtrair da receita as parcelas que a compõem devolve o lucro embutido, não um resultado apurado | **alta** | A tela nomeia a linha "Margem contratada embutida" e explica a identidade. O módulo calcula o resíduo e o confere contra as linhas de lucro declaradas, exibindo divergência quando discordam. |
| **Dupla contagem cavalo/carreta** | alta | `resolverRaizes` + `foraDoEscopo` (já testado em `composicao-real.test.ts`); testes novos de consolidação somando cavalo+carreta e comparando com conjunto. |
| **Dupla contagem total/parcela** | alta | `COMPOSITIONS`; parcela absorvida por total que entrou nunca soma. |
| **Periodicidade** — somar anual com mensal | alta | `convertPeriodicity`, com natureza marcada; PONTUAL recusa converter. |
| **Média enganosa** — média de percentuais | média | Percentuais consolidados são sempre recalculados de numerador e denominador consolidados. Teste dedicado. |
| **Ausência virando zero** | alta | `valor: number \| null`; subtotal com componente ausente vira `INCONCLUSIVO`, não um número menor. |
| **Cobertura inventada** | média | Cobertura é razão medida entre componentes com valor e componentes exigidos pelo plano — nunca uma constante. |
| **Órfãos** — 9 carretas sem cavalo | média | Entram como unidade própria; teste de consolidação confere a contagem. |
| **Semântica que muda no meio da série** | média | `loadAttributeClassificationsAt(data)` já resolve por competência; o alerta `SEMANTICA_MUDOU` já existe e é propagado. |

---

## F. UX proposta

**Duas telas, não quatro.** `/dre` (frota) e `/dre/:entityId` (veículo). Comparação e
composição são *estados* dessas telas, não abas próprias — a navegação do produto
já tem 18 itens, e a simplicidade pedida em §27 vale mais que a simetria.

### `/dre` — a frota
1. Filtros na mesma barra da Composição: unidade/canal, vigência, escopo (Cavalo | Carreta | Conjunto).
2. **Quatro indicadores.** Receita líquida e Resultado apurado com número. **EBITDA e Resultado/km aparecem apagados, com o motivo escrito** — não somem, porque a ausência é a informação.
3. A DRE consolidada, em cascata, com subtotais em negrito e percentuais recalculados.
4. Faixa de cobertura clicável: 8/19 componentes, com a lista ✅/⚠️.
5. Ranking ordenável e "Precisam de atenção", ambos derivados de regra sobre os dados.

### `/dre/:entityId` — o prontuário
Cabeçalho com os quatro números do veículo; DRE em cascata expansível
(*progressive disclosure*: só as seções, o detalhe sob clique); "O que alterou sua
DRE" com a ponte real de `change → impact → linha`; evolução por vigência;
origem de cada número até a célula da planilha.

**Gráficos:** apenas dois se ganham função — evolução do resultado por vigência
(linha) e ponte do resultado entre duas vigências (waterfall). Distribuição da
frota e "receita × custo × resultado" não entram: com uma linha de custo real, o
gráfico teria uma barra.

---

## G. Plano de implementação

| Arquivo | O quê |
|---|---|
| `lib/dre/src/plano.ts` | **novo** — registro declarativo dos componentes, seções, escopos e ausências, com evidência |
| `lib/dre/src/normalizacao.ts` | **novo** — periodicidade → competência da DRE, sobre `convertPeriodicity` |
| `lib/dre/src/motor.ts` | **novo** — DRE de um veículo/conjunto a partir de `comporDeFatos` |
| `lib/dre/src/conjunto.ts` | **novo** — pareamento cavalo↔carreta e órfãos |
| `lib/dre/src/consolidado.ts` | **novo** — consolidação, ranking, atenção, sem média de percentual |
| `lib/dre/src/ponte.ts` | **novo** — alteração → impacto → linha da DRE, sobre `getAlteracoesDoEquipamento` |
| `lib/dre/src/__tests__/` | **novo** — cálculo, periodicidade, escopo, consolidação, ausência, comparação, rastreio, e a bateria contra o export real |
| `artifacts/api-server/src/routes/dre.ts` | **novo** — 5 rotas |
| `artifacts/api-server/src/routes/index.ts` | +1 linha |
| `artifacts/freightaudit/src/pages/dre.tsx` | **novo** |
| `artifacts/freightaudit/src/pages/dre-veiculo.tsx` | **novo** |
| `artifacts/freightaudit/src/components/dre/` | **novo** — tipos, cascata, cobertura, ponte |
| `artifacts/freightaudit/src/App.tsx` | +2 rotas |
| `artifacts/freightaudit/src/components/layout/sidebar.tsx` | +1 item |
| `lib/assistant/src/ferramentas.ts` | +1 ferramenta, chamando o mesmo motor |

**Migrations: nenhuma.** A DRE não introduz tabela. É uma leitura do canônico.

---

## O que este módulo **não** entrega, e por quê

Escrito aqui para que não seja preciso descobrir na tela:

- **EBITDA** — inapurável sem custo operacional. Exibido como indisponível.
- **Margem de contribuição** — inapurável sem custo variável. Idem.
- **Qualquer indicador por km, por dia ou de utilização** — sem denominador no export.
- **Rateio de custo compartilhado** — não há custo compartilhado no dado.
- **Depreciação contábil** — o export traz amortização de financiamento, que é outra coisa.

Cada uma dessas linhas existe no plano, com o motivo e **com o que destravaria**.
É o que transforma a lacuna em pergunta para a Ambev em vez de um buraco na tela.
