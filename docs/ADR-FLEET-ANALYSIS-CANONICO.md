# ADR — Análise de frota passa a ler o canônico

> **Status:** aceito, não executado. Este documento é o mapa; a troca de fonte é
> o PR-15.
> **Contexto:** `docs/AUDITORIA-INGESTAO-PROPAGACAO.md` (`PARALELA-1`) e
> `docs/AUDITORIA-COMPLEMENTO-BASELINE.md` (Parte A.4).
> **Guarda executável:** `fleet-analysis-contrato.test.ts`, onde mora o de-para.

---

## 1. A decisão

`GET /fleet-analysis/*` continua existindo, com a mesma tela e as mesmas
perguntas. O que muda é **de onde ela lê**: sai o `.xlsx` do disco do servidor,
entra o canônico, pela autoridade de disponibilidade.

**A funcionalidade não é negociável.** "Análise de frota" responde quatro
perguntas que nenhuma outra tela responde — evolução da remuneração por
vigência, mix de modelos, status de financiamento e status de ativo —, e o
defeito nunca foi a análise. Foi a origem.

### O que se ganha, e não é cosmético

| Hoje | Depois |
|---|---|
| lê um arquivo do disco, escolhido por ordem de `readdir` | lê o que foi importado |
| ignora as importações — reimportar não muda a tela | reflete a última promoção |
| nenhum rastro: um número não aponta para célula nenhuma | `fato → vigência → importação → arquivo → linha/célula` |
| soma todas as unidades e canais sem dizer que somou | recorta por contexto, como o resto do produto |
| parser próprio com `EMPURRADA_` fixo no código | a mesma derivação de vigência de todo mundo |
| `_cache` de módulo que nada invalida | sem cache próprio |

---

## 2. Por que a tela está vazia hoje

Não é hipótese; está medido e preso por teste.

```
findExcelFile() → primeiro .xlsx de attached_assets/ na ordem de readdir
                → "Modelo_Carreta.xlsx"
abas do arquivo → [ "Modelo_Carreta" ]
wb.Sheets["carretas"] → undefined
sheet_to_json(undefined) → []          ← sem erro
```

A rota procura abas com os nomes literais `carretas` e `cavalos`. Elas existiam
no export combinado antigo; desde que a Ambev passou a entregar **um arquivo por
equipamento**, não existem mais. A rota devolve zero linhas sem levantar nada, e
a primeira seção do menu diz que não há dado enquanto o banco tem nove vigências
e 124 mil fatos.

É o caso mais literal da auditoria — dado que existe e um módulo não enxerga —, e
é também o motivo de a migração não poder ser "quando sobrar tempo": a tela já
está quebrada, e a correção e a migração são a mesma obra.

---

## 3. O contrato a preservar

Três endpoints, e o que a tela consome de cada um. **A lista canônica está em
`fleet-analysis-contrato.test.ts`** — aqui ela é reproduzida para leitura, e é o
teste que impede as duas de divergirem.

### 3.1 `GET /fleet-analysis/summary`

```
{ vigencias: string[],                       // rótulos, em ordem cronológica
  vigenciaLabels: Record<string, string>,    // "EMPURRADA_2_12_2025" → "Dez/2025"
  summary: SummaryRow[],
  financiamentoByVigencia: Record<string, unknown>[],
  modelosByVigencia:       Record<string, unknown>[],
  ativoStatusByVigencia:   Record<string, unknown>[] }
```

`SummaryRow`, campo a campo, com a fonte canônica de cada um:

| Campo | Hoje | Fonte canônica | Observação |
|---|---|---|---|
| `vigencia` | rótulo da planilha | `snapshot.source_label` | |
| `label` | regex `EMPURRADA_` própria | `periodoDe(effective_date)` (`coverage/matriz.ts`) | some o canal fixo no código |
| `totalCarretas` | `filter().length` | `snapshot_entity_type.entity_count` (`CARRETA`) | sem tocar `fact` |
| `totalCavalos` | idem | `snapshot_entity_type.entity_count` (`CAVALO`) | |
| `custoFixoCarretas` | `sum(custoFixo)` | Σ `carreta.custo_fixo` | |
| `finameCarretas` | `sum(finameImplemento)` | Σ `carreta.finame_implemento` | |
| `finameCavalos` | `sum(finameCavalo)` | Σ `cavalo.finame_cavalo` | |
| `ipvaCarretas` | `sum(ipvaLicenciamento)` | Σ `carreta.ipva_licenciamento` | há homônimo em `CAVALO`; o tipo separa |
| `seguroCarretas` | `sum(seguro)` | Σ `carreta.seguro` | |
| `lucroFixoCarretas` | `sum(lucroFixomodeloNovoCicloCarreta)` | Σ `carreta.lucro_fixomodelo_novo_ciclo_carreta` | |
| `lucroVariavelCarretas` | `sum(lucroVariavelPrevistoCarreta)` | Σ `carreta.lucro_variavel_previsto_carreta` | |
| `manutencaoCavalos` | `sum(manutencaoAno) / 12` | Σ `cavalo.manutencao_ano`, **normalizado** | ver §4 |
| `valorFrotaCarretas` | `sum(valorNfCompra)` | Σ `carreta.valor_nf_compra` | grandeza de aquisição, não de fluxo |
| `valorFrotaCavalos` | idem | Σ `cavalo.valor_nf_compra` | idem |

Os três agrupamentos são contagens por valor de um atributo texto, por vigência:

| Bloco | Hoje | Fonte canônica |
|---|---|---|
| `financiamentoByVigencia` | conta `statusFinanciamento` das carretas | `carreta.status_financiamento` |
| `modelosByVigencia` | conta `modelo` das carretas | `carreta.modelo` |
| `ativoStatusByVigencia` | conta `ativo` dos cavalos | `cavalo.ativo` |

Cada linha é `{ vigencia, label, ...contagens }`, e a tela lê as contagens
descartando as duas primeiras chaves. O prefixo `"Descrição: "` é removido do
valor de `statusFinanciamento` **na rota e de novo na tela** — a duplicação sai
com a migração, e a limpeza fica de um lado só.

### 3.2 `GET /fleet-analysis/carretas?vigencia=` e `/cavalos?vigencia=`

Linhas cruas, filtradas por vigência. A tela mostra estas colunas:

| Carretas | Fonte canônica |
|---|---|
| `Placa` | **identificador**, `entity_identifier` — não é fato |
| `Operador - Nome` | **escopo**, `scope` — não é fato |
| `implemento` | `carreta.implemento` |
| `modelo` | `carreta.modelo` |
| `ano` | `carreta.ano` |
| `custoFixo` | `carreta.custo_fixo` |
| `finameImplemento` | `carreta.finame_implemento` |
| `seguro` | `carreta.seguro` |
| `ipvaLicenciamento` | `carreta.ipva_licenciamento` |
| `valorNfCompra` | `carreta.valor_nf_compra` |
| `statusFinanciamento` | `carreta.status_financiamento` |

| Cavalos | Fonte canônica |
|---|---|
| `Placa` | **identificador** |
| `Placa Carreta` | `cavalo.placa_carreta` |
| `Operador - Nome` | **escopo** |
| `montadora` | `cavalo.montadora` |
| `anoBid` | `cavalo.ano_bid` |
| `ativo` | `cavalo.ativo` |
| `faixaKm` | `cavalo.faixa_km` |
| `finameCavalo` | `cavalo.finame_cavalo` |
| `manutencaoAno` | `cavalo.manutencao_ano` |
| `reaiskm` | `cavalo.reaiskm` |
| `valorNfCompra` | `cavalo.valor_nf_compra` |

**Duas colunas não são fato, e é a descoberta que mais muda a implementação.**
`Placa` é identidade (`entity_identifier`, com histórico de vigência) e
`Operador - Nome` é escopo (`scope`, ligado à vigência e não ao ativo). Uma
migração que as procurasse em `fact` não as acharia, e concluiria que o dado
sumiu. `getEntityTable` (`comparison/grouped.ts`) já pivota `(entity, attribute)`
e já resolve a placa — é o motor a reusar, não um novo.

---

## 4. Os quatro pontos onde a migração pode errar

**4.1 `manutencaoCavalos` divide por 12 dentro da rota.** É conversão de
periodicidade escrita à mão, e o produto tem autoridade para isso:
`normalizarParaCompetencia` (`lib/dre/src/normalizacao.ts`). A migração usa a
autoridade — e, se o atributo ainda não tiver periodicidade confirmada, o valor
não é dividido em silêncio: ele é `NOT_CALCULABLE` com motivo, como a DRE já
faz. Repetir o `/12` aqui recriaria a divergência que a auditoria existe para
fechar.

**4.2 A soma de hoje atravessa unidade e canal.** A planilha tinha uma unidade
só, então somar tudo dava certo por acidente. Ao ler o canônico, a rota passa a
recortar por contexto como Alterações, Impacto, Composição e DRE — e depois do
P1, pelo contexto **corrigido**. Por isso o PR-15 vem depois do P1, e não antes.

**4.3 `valorNfCompra` é grandeza de aquisição.** A DRE já a classifica como
`GRANDEZA_DE_AQUISICAO` e se recusa a somá-la ao fluxo do período. A tela a
mostra como "valor da frota", que é legítimo — mas o rótulo tem de continuar
dizendo que é estoque, e não custo do mês.

**4.4 Ausência não é zero.** `sumField` faz `Number(r[f]) || 0`: célula vazia,
texto e sentinela viram zero, e o zero entra na soma. No canônico, `is_null` com
`null_reason` diz o contrário, e a distinção é a mesma que `impacto.ts` protege.
A migração **muda números** neste ponto, e é a única mudança de número esperada
— quando ela aparecer, é correção, não regressão. O teste de caracterização
registra os totais de hoje para que a diferença seja medida, e não descoberta.

---

## 5. Alternativas descartadas

**Remover a tela.** Ela responde perguntas que o produto não responde em outro
lugar. Remover para satisfazer uma regra de arquitetura seria pagar a regra com
funcionalidade.

**Apontar `findExcelFile` para o export combinado antigo.** Faria a tela voltar a
mostrar número hoje, e é a pior das opções: consertaria o sintoma com a causa
intacta, e o número voltaria a ser de um arquivo do repositório, não do que a
Ambev entregou.

**Reimplementar a agregação dentro da rota, lendo `fact` direto.** É metade da
migração e cria a nona definição de série. A rota não calcula: chama a
autoridade, como `routes/coverage.ts` já faz.

---

## 6. Ordem e critério de aceitação

O PR-15 executa esta migração, **depois** do P1, pelo motivo de §4.2.

Aceita quando:

1. `/fleet-analysis/summary` devolve as vigências que o canônico tem — a mesma
   lista que Vigências e Cobertura veem;
2. a forma da resposta é idêntica à que este ADR e o teste registram, e a tela
   não muda uma linha;
3. nenhum número vem de arquivo em disco, e cada um é rastreável até a célula;
4. as diferenças de valor em relação a hoje são **só** as de §4.4, e estão
   nomeadas uma a uma;
5. `attached_assets` deixa de ser lido em runtime por qualquer rota.
