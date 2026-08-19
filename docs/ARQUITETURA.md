# FreightCheck — Proposta de Arquitetura (Fase 1)

> **Status:** aguardando validação. Nenhum código de produção escrito.
> **Base:** análise de `attached_assets/Remuneração_Equipamento_Análise_FT.xlsx` — 1.215 registros, 9 vigências, 99 atributos distintos, 144 placas.
> **Nomenclatura:** *Freightec* = sistema da Ambev (fonte). *FreightCheck* = este produto.

---

## 1. Auditoria do que já existe

A infraestrutura serve; o modelo de dados não. O schema atual foi desenhado
supondo que o Freightec exporta uma tabela de parâmetros de remuneração
("Diária de veículo = R$ 850"). O arquivo real mostra outra coisa (§2).

| Componente atual | Veredito | Motivo |
|---|---|---|
| monorepo, build, codegen | **manter** | Infra sólida. |
| `lib/db/src/schema` | **refazer** | Grão errado: `parameters` assume 1 linha por parâmetro global. |
| `routes/diffs.ts` | **reescrever** | Algoritmo certo em espírito, cego para o eixo entidade. |
| `routes/simulations.ts` | **descartar** | `baseMonthlyRevenue = 4830000` fixo no código. |
| `seed.ts` | **descartar** | Inventa parâmetros Ambev fictícios; temos dado real. |
| `routes/fleet-analysis.ts` | **absorver** | Lê Excel do disco, fora do Postgres, sem rastreabilidade. |
| Telas + shadcn/ui | **manter** | Passam a consumir o modelo novo. |
| Testes / migrations | **inexistentes** | Zero testes; só `drizzle push`. |

---

## 2. O que os dados reais dizem

**O Freightec não exporta regras. Exporta o cadastro remunerado da frota,
congelado por vigência.**

5 abas: `carretas` (657×65) e `cavalos` (558×77) são a fonte; `Quantidade`,
`Análise Carreta` e `Análise Cavalo` são tabelas dinâmicas derivadas.

- **Grão real:** `(Vigencia, Placa)`. Não existe "tabela de parâmetros".
- **Vigências:** `EMPURRADA_2_12_2025` … `EMPURRADA_1_8_2026`. Mensal, mas o dia
  varia (2, 2, … 1) — é rótulo da fonte, não data. Preservar literal + derivar data.
- **Escopo atual:** 1 unidade (CAMAÇARI), 1 operador (OPERALOG), 1 regional (Geo NE).

### O diff funciona — rodado nos dados reais

| Transição | Cavalos: células | Placas +/− | Carretas: células | Placas +/− |
|---|--:|--:|--:|--:|
| Dez/25 → Jan/26 | 347 | 0 / 0 | 213 | 0 / 0 |
| Jan/26 → Fev/26 | 294 | +2 / 0 | 52 | +2 / 0 |
| Fev/26 → Mar/26 | 286 | +2 / 0 | 111 | +1 / 0 |
| Mar/26 → Abr/26 | 345 | 0 / 0 | 57 | 0 / 0 |
| Abr/26 → Mai/26 | 303 | 0 / −2 | 65 | +4 / −9 |
| Mai/26 → Jun/26 | 240 | 0 / 0 | 29 | 0 / 0 |
| Jun/26 → Jul/26 | 431 | 0 / 0 | 162 | 0 / 0 |
| Jul/26 → Ago/26 | 244 | 0 / 0 | 23 | 0 / 0 |

**3.202 alterações reais** em 8 transições (~400/mês). Ruído baixo: 51 dos 77
atributos de cavalos nunca mudaram. Sinal concentrado em ~15 atributos.

### Achado crítico 1 — IPVA dos cavalos caiu 77%

Placa `QYQ6A80`, mesmo chassi, mesmo contrato, campo `ipvaLicenciamento`:

```
Dez/2025   R$ 11.089,38
Jan/2026   R$  4.096,31   (−63,1%)
Jul/2026   R$  2.513,19   (−38,6%)   → acumulado −77,3%
```

Agregado da frota: **R$ 989.844 → R$ 268.952** = −R$ 720.892 em duas mexidas,
oito meses, sem alarde.

### Achado crítico 2 — a nomenclatura dos campos não é confiável

Carretas têm `ipvaLicenciamento` e `ipvaLicenciamentoMensal`. Os valores
contradizem os nomes:

| Placa | Vigência | ipvaLicenciamento | …Mensal |
|---|---|--:|--:|
| QYN9E22 | Dez/2025 | 151,88 | 1.784,31 |
| QYN9E22 | Jan/2026 | 150,00 | 613,33 |
| QYN7B31 | Dez/2025 | 151,88 | 525,41 |

O "Mensal" é 4–12× **maior** que o suposto anual, com razão não constante.
Nenhum dos dois significa o que o nome diz.

### Outras armadilhas

| Achado | Exemplo | Consequência |
|---|---|---|
| Valores não somáveis | `Custo Variável Simulado = 3,66` (R$/km) | Somar 62 placas dá "R$ 258" — sem significado. |
| Rótulo colado no valor | `"Descricao: 6X2"`, `"Modelo: FH460 6x2T"` | Exige parsing; original tem de ser preservado. |
| Data como serial Excel | `dataFimContrato = 46935.5` | Tipagem por coluna é insuficiente. |
| Escopo cardinalidade 1 | Unidade = CAMAÇARI | Suportar multi-valor já, sem migration depois. |
| Sentinela numérica | `combustivelPercentualPerdaVida = −1` | Entra em média e destrói o resultado. |
| Zero = "sem informação" | `finameCavalo: 7.937,22 → 0 → 3.318,01` | O zero volta ao valor cheio — era ausência, não zero. |
| Booleano textual | `ativo = "PARADO"` | Não deve entrar no denominador de médias. |
| Chave técnica volátil | `_id` = UUID novo a cada export | Identidade é placa/chassi. |

---

## 3. Decisões que os dados forçam

| # | Decisão | Evidência |
|---|---|---|
| **D1** | Grão único `(snapshot, entidade, atributo) → valor`, formato longo tipado. Nunca coluna por variável. | 99 atributos hoje, sujeitos a mudar a cada export. |
| **D2** | Todo atributo carrega semântica declarada: tipo, unidade, periodicidade, agregação, classificação, e status *confirmada/presumida*. | Caso `ipvaLicenciamentoMensal`. |
| **D3** | Custo fixo × variável é curadoria, não importação. Taxonomia editável e versionada. | Nenhuma coluna do Freightec diz "custo fixo". |
| **D4** | Dois eixos de diff separados: entidade (placa entrou/saiu) e atributo (valor mudou). | Abr→Mai/26: −9 e +4 carretas *junto com* 65 células alteradas. |
| **D5** | "Impacto não calculável" é estado de primeira classe, com motivo gravado. | `Custo Variável Simulado` é R$/km; falta quilometragem. |
| **D6** | Normalização de nomes é assistida. Vínculo não confirmado não entra em cálculo. | `lucroVariavelPrevisto` vs `lucroVariavelPrevistoCarreta` coexistem e não são o mesmo. |

---

## 4. Modelo de domínio — quatro camadas

| Camada | Natureza | Entidades |
|---|---|---|
| **RAW** | imutável, nunca reprocessado | `source_file`, `import_run`, `raw_sheet`, `raw_row`, `raw_cell` |
| **STAGING** | tipado, validado, descartável | `staged_fact`, `validation_issue`, `column_mapping` |
| **CANÔNICO** | fonte da verdade, versionado | `snapshot`, `entity`, `attribute`, `fact`, `taxonomy_node`, `scope` |
| **ANALÍTICO** | derivado, reconstruível | `change_set`, `change`, `impact`, `alert`, `explanation` |

### Fluxo de importação

```
01 Upload      arquivo inteiro + SHA-256
02 Leitura     abas, cabeçalhos, células com coordenada
03 Reconhecer  layout conhecido? colunas novas?
04 Mapear      coluna → atributo   ← intervenção humana no ambíguo
05 Validar     tipo, sentinela, duplicidade
06 Preview     aceitos, rejeitados, desconhecidos   ← aceite explícito
07 Promover    snapshot fechado, em transação
08 Comparar    diff contra o snapshot anterior
09 Publicar    change set + impacto + alertas
```

Snapshot fechado é imutável. Correção gera novo snapshot referenciando o anterior.

---

## 5. Modelo de dados

Postgres + Drizzle, migrations versionadas (não `push`). Monetário em
`NUMERIC(18,6)` — `float`/`double precision` proibidos.

**Uma transação por migration, e não uma por deploy.** O migrator do drizzle
abre uma transação só e roda todas as pendentes dentro dela: a última decide o
destino de todas, e uma que falhe leva junto as anteriores, que estavam
corretas. Foi assim que a tabela do Book do Operador (`0008`) deixou de existir
num banco onde tudo o que veio antes existia — o servidor subia, as telas
antigas funcionavam, e só as rotas do Book respondiam 500. `lib/db/src/migrate.ts`
aplica uma por vez, para no primeiro erro e devolve o relatório; `/api/healthz`
publica quais faltam e em qual a tentativa parou (nome e SQLSTATE, nunca a
mensagem do driver, que carrega host e usuário).

### Tabela central

```
fact                              -- o grão do sistema
  id                bigserial
  snapshot_id       → snapshot    -- a vigência
  entity_id         → entity      -- a placa
  attribute_id      → attribute   -- a variável
  value_numeric     numeric(18,6)  ┐
  value_text        text           │ exatamente uma
  value_boolean     boolean        │ preenchida
  value_date        date          ┘
  value_hash        text          -- normalizado, diff barato
  is_null           boolean       -- ausência ≠ zero
  raw_cell_id       → raw_cell    -- rastreabilidade até a célula
  UNIQUE (snapshot_id, entity_id, attribute_id)
  CHECK (exatamente uma value_* preenchida OU is_null)
```

O `CHECK` impede a tabela de virar JSON sem estrutura. O `value_hash` permite
diff por `JOIN` em vez de comparação campo a campo.

### Dicionário — onde mora a semântica

```
attribute
  id, code                  -- "ipva_licenciamento_cavalo"
  source_name               -- "ipvaLicenciamento" (literal da fonte)
  display_name              -- "IPVA + Licenciamento"
  entity_type               -- CAVALO | CARRETA | ...
  data_type                 -- NUMERIC | TEXT | BOOLEAN | DATE
  unit                      -- BRL | BRL_KM | KM_L | PERCENT | MESES | UNIT
  periodicity               -- MENSAL | ANUAL | PONTUAL | DESCONHECIDA
  aggregation               -- SUM | AVG | WEIGHTED_AVG | NONE
  taxonomy_node_id          -- posição na hierarquia (CF/CV/grupo)
  semantics_status          -- CONFIRMADA | PRESUMIDA | DESCONHECIDA
  is_monetary, is_driver

attribute_alias             -- normalização sem perder a origem
  attribute_id, source_name, source_sheet, first_seen_import_id
  match_confidence, confirmed_by, confirmed_at
```

> **`semantics_status` protege o sistema inteiro.** Enquanto PRESUMIDA ou
> DESCONHECIDA, o atributo aparece nas telas de mudança — você vê que mudou —
> mas **não entra em nenhuma soma financeira**.

### Demais tabelas

| Tabela | Papel | Detalhe que importa |
|---|---|---|
| `source_file` | arquivo original | binário + SHA-256; mesmo hash não reimporta |
| `import_run` | execução | quem, quando, contagens; tentativa falha também fica; `reprocess_of_run_id` marca a releitura |
| `raw_cell` | célula como veio | aba, linha, coluna, valor textual, tipo detectado |
| `snapshot` | vigência fechada | `source_label` literal + `effective_date` derivada; imutável |
| `entity` | o ativo remunerado | placa + chassi; sobrevive a troca de placa |
| `scope` / `entity_scope` | unidade, operador, regional, CD | multi-valor já |
| `taxonomy_node` | hierarquia | auto-referente, profundidade livre, versionada |
| `change_set` / `change` | resultado do diff | derivado e recalculável (§6) |
| `impact` | impacto financeiro | confiança própria, recalculável sozinho (§7) |
| `formula` / `formula_dependency` | grafo de dependências | Fase 2; estrutura entra agora |
| `explanation` | texto gerado por IA | **tabela separada, sempre** (§7) |

### Volume

Hoje ~85 mil fatos por export completo. Com 20 unidades e 5 anos mensais:
ordem de 100 milhões de linhas em `fact`. Mitigação: particionar `fact` por
`snapshot_id`, índice composto `(snapshot_id, attribute_id, entity_id)`, diff
sempre entre duas partições. `raw_cell` vai para armazenamento frio após 12
meses — sem nunca ser apagado.

### Cobertura de dados (`0021`)

Duas tabelas, e o que decide as duas é uma medição: **`fact` é densa.** No
export real são 144 entidades × 138 atributos × 9 vigências = 124.632 fatos, com
`entidades × atributos = fatos` exatamente — toda célula entregue vira fato,
inclusive as vazias (9.360 `EMPTY`, 2.602 `VALUE_MISSING`). Isso torna os três
estados que a cobertura precisa distinguir legíveis sem nenhuma estrutura nova:

```
presente com valor   → fact.is_null = false
entregue e vazio     → fact.is_null = true  + null_reason
nunca entregue       → sem linha em snapshot_attribute
```

E `snapshot_attribute` — escrita na promoção, com `value_count` e `null_count`
por coluna — **já é o agregado de cobertura**: 1.809 linhas para aqueles 124.632
fatos, e ela cresce com (vigências × colunas), não com entidades.

O que não existia:

```
snapshot_entity_type              -- o denominador da matriz
  snapshot_id       → snapshot
  entity_type       text          -- CAVALO | CARRETA | …
  entity_count      int           -- entidades distintas do tipo na vigência
  attribute_count   int
  fact_count        int
  value_count       int           -- o numerador da cobertura observada
  null_count        int
  inherited_fact_count int         -- os que vieram da revisão anterior
  UNIQUE (snapshot_id, entity_type)

coverage_expectation              -- o esperado que alguém afirmou
  dataset_family, canal, scope_key, entity_type, attribute_code
  origin            text          -- CONTRATO | CURADORIA  (nunca inferência)
  status            text          -- CONFIRMADO | DISPENSADO
  criticality       text          -- CRITICO | RELEVANTE | INFORMATIVO
  effective_from/until date       -- alinhadas a snapshot.effective_date
  succeeded_by_attribute_code     -- renomeação confirmada
  rationale, evidence, actor      -- CHECK: motivo e ator nunca vazios
  UNIQUE NULLS NOT DISTINCT (identidade + effective_from)
```

**`snapshot_entity_type` é tabela e não coluna em `snapshot`** porque o gatilho
`snapshot_immutable` da `0001` congela a vigência quando ela fecha: o backfill
de uma coluna nova esbarraria nele para toda vigência já fechada, e desligá-lo
trocaria a garantia central do produto por uma leitura mais curta.

**`coverage_expectation` não tem valor `INFERIDO`, e isso é decisão de
projeto.** Um atributo presente nas oito vigências anteriores para as mesmas 144
entidades é evidência forte, e evidência forte não é declaração. O esperado
inferido é recalculado a cada leitura sobre o histórico de `snapshot_attribute`
e chega à tela marcado como inferência. Gravá-lo o tornaria, em uma migration ou
duas, indistinguível de contrato — que é como uma estatística vira verdade sem
que ninguém tenha decidido.

**A criticidade não é uma segunda lista.** Ela sai de `lib/dre/src/plano.ts`,
onde cada componente já declara as suas `fontes`, se é `essencial` e a
`evidencia` medida que sustenta a entrada. Um atributo é crítico na cobertura se
e somente se alimenta um componente essencial da DRE — o que impede a regra de
se espalhar pela aplicação e faz mudar a DRE mudar a cobertura crítica no mesmo
commit.

**Caminho de leitura.** Resumo e matriz saem de `snapshot_entity_type` +
`snapshot_attribute` + `coverage_expectation`, sem tocar em `fact`. A única
descida ao fato é a contagem de `NOT_APPLICABLE`, por um índice parcial
(`fact_nao_aplicavel_idx`) que só indexa as linhas com esse motivo — zero delas
no export real. `fact` só é lida no drill-down até a placa, por
`(snapshot_id, attribute_id)`, que é o começo de `fact_snapshot_attribute_idx`.

---

## 6. Motor de comparação

Seis passos determinísticos, zero IA:

1. **Parear entidades** por identidade estável (placa → chassi como desempate).
2. **Parear atributos** via `attribute_alias`. Coluna nova sem alias vira
   pendência de curadoria — não é tratada como atributo novo automaticamente.
3. **Comparar valores** pelo `value_hash`, com tolerância declarada por atributo.
4. **Classificar** em tipo e natureza.
5. **Calcular impacto** ou marcar não calculável com motivo (§7).
6. **Agregar** em `change_set`, ordenar por materialidade, disparar alertas.

### Naturezas de mudança

| Natureza | Detectada quando | Exemplo real |
|---|---|---|
| `VALOR` | só o número mudou | Custo Variável Simulado (RPH1H43) 3,11 → 3,71 R$/km |
| `ESCALA` | ordem de grandeza sem causa no ativo | ipvaLicenciamento (QYQ6A80) 11.089 → 4.096 (−63%) |
| `ZERAMENTO` | valor válido vira 0, às vezes volta | finameCavalo (QYQ6A80) 7.937,22 → 0 → 3.318,01 |
| `UNIDADE` | tipo ou unidade mudou | número → texto, R$ → R$/km |
| `CLASSIFICAÇÃO` | atributo mudou de nó na taxonomia | custo migra de CF para CV |
| `VÍNCULO` | relação entre entidades mudou | Placa Carreta: RZG4A80 → outra |
| `ESTADO` | campo de status mudou | ativo (RPH1H43) PARADO → ATIVO → PARADO |
| `ENTIDADE +` | placa em B, ausente em A | +4 carretas em Mai/26 |
| `ENTIDADE −` | placa em A, ausente em B | −9 carretas em Mai/26 |
| `ATRIBUTO NOVO` | coluna inédita | a Ambev cria uma variável |
| `ATRIBUTO SUMIU` | coluna deixou de vir | variável descontinuada |

> **Regra anti-falso-alarme:** quando uma placa sai, todos os ~70 atributos
> "mudam". `ENTIDADE −` é **uma** mudança e suprime os `VALOR` filhos. Foi o
> que fez Abr→Mai/26 render 65 mudanças em vez de ~700.

`change_set` é sempre reconstruível a partir do canônico. Se o algoritmo
melhorar, recalcula-se o histórico. O que **não** é recalculável é o dado
bruto — por isso ele nunca é tocado.

---

## 7. Impacto financeiro

**Regra única: um número financeiro só é exibido se puder ser reproduzido pela
fórmula e pelos dados de origem.**

| Nível | Condição | Na tela |
|---|---|---|
| `CALCULADO` | monetário, semântica CONFIRMADA, periodicidade e agregação conhecidas | valor em destaque, fórmula a um clique |
| `ESTIMADO` | depende de premissa externa declarada | marca visual + premissa nomeada |
| `NÃO CALCULÁVEL` | falta dado, unidade ou confirmação | "falta quilometragem mensal", com link para o que resolveria |

### Aplicado aos dados reais

| Mudança | Nível | Por quê |
|---|---|---|
| ipvaLicenciamento R$ 989.844 → R$ 268.952 | `CALCULADO` | somável, 62 placas nos dois snapshots → −R$ 720.892 (após confirmar mensal/anual) |
| Custo Variável Simulado 3,11 → 3,71 R$/km | `NÃO CALCULÁVEL` | falta quilometragem por placa |
| combustivelConsumoNeg 2,03 → 1,96 km/l | `ESTIMADO` | precisa km rodado + preço do diesel (premissas) |
| −9 carretas na frota | `CALCULADO` | soma do `custoFixo` das placas que saíram |

### Waterfall

A soma das barras **tem de bater** com a diferença total. O não atribuível
vira barra própria "não atribuído", com a lista das mudanças que caíram ali.
Decomposição que não fecha passa confiança falsa.

### Onde a IA entra

A IA **nunca** produz um número. Lê o número já calculado e escreve a
explicação em português; sugere vínculos de nomes para aprovação humana;
agrupa mudanças relacionadas; propõe severidade. Toda saída vive em
`explanation` com `change_id`, modelo e prompt registrados, e aparece com
marca visual distinta. Apagar a explicação não afeta o número.

---

## 8. Hierarquia da remuneração

Taxonomia construída por curadoria e versionada. Proposta inicial usando
**apenas atributos que existem no arquivo**:

```
REMUNERAÇÃO
├── CUSTO FIXO
│   ├── Frota — Cavalo
│   │   ├── amortizacaoCavalo          R$   529.368/vig  · SUM · CONFIRMADA
│   │   ├── finameCavalo               R$   867.860/vig  · SUM · CONFIRMADA
│   │   ├── jurosFinameCavalo          R$   300.132/vig  · SUM · CONFIRMADA
│   │   └── ipvaLicenciamento          R$   268.952/vig  · SUM · PRESUMIDA
│   ├── Frota — Carreta
│   │   ├── custoFixo                  R$ 1.204.664/vig  · SUM · CONFIRMADA
│   │   ├── finame                     R$ 1.122.609/vig  · SUM · CONFIRMADA
│   │   ├── seguro                     R$    36.569/vig  · SUM · CONFIRMADA
│   │   └── ipvaLicenciamentoMensal    R$    23.344/vig  · SUM · DESCONHECIDA
│   └── Remuneração de capital
│       ├── lucroFixomodeloNovoCiclo
│       └── lucroFixomodeloNovoCicloCavalo
└── CUSTO VARIÁVEL
    ├── Combustível
    │   ├── combustivelConsumoNeg      km/l   · WEIGHTED_AVG · não somável
    │   ├── combustivelCapacidade      litros · AVG
    │   └── tipoCombustivelEmpurrada   texto  · NONE
    ├── Manutenção
    │   ├── manutencaoBid              R$/km  · WEIGHTED_AVG
    │   ├── manutencaoReaisKm          R$/km  · WEIGHTED_AVG
    │   └── manutencaoVidaMeses        meses  · AVG
    ├── Pneus
    │   ├── valorPneu / valorPneus     R$     · SUM
    │   └── pneuMedidaEmpurrada        texto  · NONE
    └── Lucro variável
        ├── lucroVariavelPrevisto      R$ 290.740/vig · SUM
        └── Custo Variável Simulado    R$/km · WEIGHTED_AVG · não somável

não classificados: 51 atributos cadastrais (chassi, ano, modelo, montadora, …)
```

Um nó com filhos `DESCONHECIDA` exibe o total **e** o aviso de que há valor
fora da soma. O usuário nunca vê um total que finge estar completo.

---

## 9. Telas da Fase 1

| Tela | Responde | Elemento central |
|---|---|---|
| **O que mudou?** | A Ambev mexeu em algo? | contagem por tipo, impacto mensal/anual, top 5 por materialidade |
| **Central de Alterações** | todas as mudanças, filtráveis | "antes → depois" com delta, %, impacto, contexto |
| **Detalhe da Variável** | história completa do atributo | série nas 9 vigências, placas afetadas, origem |
| **Árvore da Remuneração** | onde na estrutura de custo | macro → folha, com valor, % do total, delta |
| **Comparar Vigências** | versão A × versão B | totais, +/−/alterados, drill-down até a célula |
| **Importação** | o que entrou e o que foi recusado | assistente de 9 passos, preview obrigatório |
| **Curadoria de Atributos** | o que o sistema não sabe interpretar | fila PRESUMIDA/DESCONHECIDA com valores à vista |
| **Rastreabilidade** | de onde veio este número | arquivo, aba, linha, coluna, valor original, transformação, usuário, data |

A tela de **Curadoria** não estava no briefing, mas os dados a tornam
obrigatória. Sem ela, o caso `ipvaLicenciamentoMensal` vira um número errado
numa tela executiva — o pior resultado possível para um sistema de auditoria.

---

## 10. Riscos

| Risco | Sev. | Evidência | Mitigação |
|---|---|---|---|
| Semântica errada de campo | Alta | "Mensal" 4–12× maior que o "anual" | `semantics_status` bloqueia soma |
| Agregação indevida | Alta | somar R$/km de 62 placas dá "R$ 258" | `aggregation` obrigatório; `NONE` nunca soma |
| Sentinela como número | Alta | `combustivelPercentualPerdaVida = −1` | catálogo de sentinelas → `is_null` com motivo |
| Precisão decimal | Alta | centavos × milhões de linhas | `NUMERIC(18,6)`; `float` proibido por lint |
| Identidade instável | Média | `_id` é UUID novo a cada export | placa + chassi, com histórico de troca |
| Renomeação de coluna | Média | `lucroVariavelPrevisto` vs `…Carreta` | `attribute_alias` com confirmação humana |
| Reimportação duplicando | Média | reenvios são rotina | SHA-256 + `UNIQUE` no grão de `fact` |
| Arquivo trancado pelo próprio SHA | Média | o leitor melhora depois que o arquivo entrou | reprocessamento: run novo sobre o mesmo `source_file`, com motivo |
| Falso alarme em massa | Média | placa removida "muda" 70 atributos | hierarquia: `ENTIDADE −` suprime filhos |
| Volume | Baixa hoje | 85 mil fatos/export, 1 unidade | partição por snapshot; escopos multi-valor |

**Risco não técnico:** este export tem uma unidade e um operador. O modelo foi
desenhado para muitos mas nunca exercitado com dado real de mais de um. A
primeira importação multi-unidade é o momento de maior chance de retrabalho.

---

## 11. Plano

| Etapa | Entrega | Critério de pronto |
|---|---|---|
| **F0 Fundação** | schema novo, migrations, testes do núcleo | reimportar o mesmo arquivo não duplica; histórico não sobrescrevível por construção |
| **F1 Ingestão** | upload → RAW → staging → snapshot, com preview | 9 vigências importadas e rastreáveis até a célula |
| **F2 Curadoria** | dicionário, taxonomia, tela de confirmação | ~20 atributos monetários com semântica confirmada |
| **F3 Comparação** | motor de diff, change sets, materialidade | reproduzir as 3.202 mudanças, dois eixos separados |
| **F4 Impacto** | níveis de confiança, waterfall | waterfall fecha com o total, resíduo explícito |
| **F5 Telas** | as 8 telas de §9 sobre o modelo novo | os 10 critérios de sucesso do briefing em < 1 minuto |
| **F6+** | alertas, explicações IA, grafo de fórmulas, busca NL | só depois de F5 estável |

### Decisões pendentes — preciso de você

1. **O IPVA caiu 77% de propósito?** Maior variação do arquivo (R$ 720 mil).
2. **Existe dicionário de campos do Freightec?** Resolveria o maior risco do projeto.
3. **Os valores são mensais ou anuais?** Por atributo, começando pelos ~20 monetários.
4. **Há export com quilometragem por placa?** Destrava o impacto em reais de tudo que é R$/km.
5. **Este arquivo é o formato definitivo?** Se há outros relatórios, quero ver antes de fechar.
6. **Um segundo export, de outra unidade.** É o teste que o modelo ainda não passou.

**Recomendação:** aprovada a arquitetura, começar por **F0 + F1** — schema com
migrations e testes, e ingestão real do arquivo que já temos. Ao final, as 9
vigências ficam no banco, versionadas e rastreáveis célula a célula, e as
perguntas 2–4 passam a ser respondidas dentro do FreightCheck em vez do Excel.
