# Aba Cliente — diagnóstico antes do código

> O que se pode propor ao cliente ajustar no Freightec, o que só se pode
> investigar, e o que não se deve levar a ele de jeito nenhum.
>
> Medido em 16/08/2026 sobre o export real
> (`attached_assets/Remuneração_Equipamento_Análise_FT_*.xlsx`), 9 vigências,
> `EMPURRADA_2_12_2025` → `EMPURRADA_1_8_2026`, 62 cavalos e 71 carretas na
> última ponta. Os números deste documento reproduzem os da aba Impacto — as
> **2.931 alterações** batem com o que `getPanoramaDeAlteracoes` conta hoje.

---

## 0. A conclusão, antes das dez respostas

Três coisas, e a terceira é a que muda o produto.

**Primeira: o sinal matemático da mudança não é o sinal econômico dela, e no
dado real isso não é teoria.** `combustivelVidaCavalo` sobe em 494 das 494
transições do export — nunca desce, nunca fica igual, sobe 0,083 por vigência.
Não é uma premissa que alguém mexeu: é o relógio. Pedir ao cliente para
"revisar de 5,58 para 4,92" é pedir para o caminhão rejuvenescer. E
`taxaFiname` caindo de 13,62% para 13,16% derrubou os juros do cavalo em
R$ 85,15/mês por placa — uma queda de número que é uma queda de receita.

**Segunda: a maior parte do dinheiro que se move neste export é legítima.** Os
dois maiores movimentos apurados — o FINAME do cavalo (−R$ 52.223,90/mês) e o
FINAME do implemento (−R$ 32.570,33/mês) — são financiamentos que terminaram,
com o lucro fixo do novo ciclo entrando no lugar (+R$ 38.359,95 e
+R$ 51.918,06). Uma aba que listasse "o que caiu" proporia recompor um
financiamento quitado.

**Terceira, e a mais cara: a maior "perda" visível na tela de hoje não é uma
perda.** `lucroVariavelPrevistoCavalo` aparece com −R$ 23.466,25 na aba
Impacto. **107 das 107 transições dessa coluna têm um zero de um dos lados**, e
34 placas só alternam entre um único valor e zero. Não é preço caindo — é a
coluna que às vezes vem preenchida e às vezes vem zerada. Uma aba Cliente
ingênua pediria de volta R$ 23 mil por mês que ninguém tirou.

Por isso a aba Cliente **não pode ser a aba Impacto filtrada**. Rodado o motor
sobre as 27 linhas econômicas deste export, o resultado é **0 propostas, 14
investigações e 13 fora** — e isso é uma resposta melhor do que dez propostas
plausíveis. A tabela completa está no §11.

---

## 1. Quais variáveis podem aparecer em Impacto

O universo é definido por `getPanoramaDeAlteracoes` (`lib/comparison/src/panorama.ts`):
**todo atributo `data_type = 'NUMERIC'` que teve pelo menos uma transição de
valor entre vigências entregues consecutivas**, no contexto (unidade × canal)
resolvido. Não há filtro de semântica na entrada — quem não passa na régua
aparece com o motivo escrito.

No export real: **80 colunas numéricas** (43 cavalo + 37 carreta), das quais
**35 mudaram** (19 cavalo + 16 carreta), somando **2.931 alterações**.

### Cavalo — 19 parâmetros alterados

| Parâmetro | Alterações | Ativos | Variação entre as pontas |
|---|--:|--:|---|
| `combustivelVidaCavalo` | 494 | 64 | 4,92 → 5,58 (por placa) |
| `manutencaoVidaMeses` | 494 | 64 | 59,8 → 67,9 meses |
| `Custo Variável Simulado` | 428 | 64 | R$/km, oscila 0,16 ↔ 9,09 |
| `combustivelConsumoNeg` | 240 | 62 | km/l, 77 zeros em 558 |
| `ipvaLicenciamento` | 122 | 62 | **−R$ 731.586,01/ano** |
| `manutencaoReaisKm` | 109 | 35 | R$/km |
| `combustivelConsumoBenchmark` | 107 | 34 | km/l |
| `lucroVariavelPrevistoCavalo` | 107 | 34 | −R$ 23.466,25 (ver §9.3) |
| `ativo` | 107 | 34 | texto |
| `odometroEntrada` | 62 | 62 | km |
| `finameCavalo` | 37 | 15 | **−R$ 52.223,90/mês** |
| `jurosFinameCavalo` | 27 | 15 | −R$ 21.279,50/mês |
| `combustivelPercentualPerdaVida` | 15 | 15 | −1,5% → −2% |
| `Taxa Finame (%)` | 14 | 10 | 13,62% → 13,16% |
| `TJLP` | 10 | 10 | 7,70% → 7,26% |
| `amortizacaoCavalo` | 10 | 10 | −R$ 69.304,36/mês |
| `lucroFixomodeloNovoCicloCavalo` | 10 | 10 | +R$ 38.359,95/mês |
| `ciclo` | 10 | 10 | 1 → 2 |
| `statusFinanciamentoT1Shared` | 10 | 10 | texto |
| `percentualReajusteAplicado` | 4 | 4 | 16,85% → 20,56% |
| `manutencaoBid` | 1 | 1 | R$/km |
| `Placa Carreta` | 5 | 5 | texto |
| `manutencaoCompraForaDoBidAutorizada` | 5 | 5 | texto |

### Carreta — 16 parâmetros alterados

| Parâmetro | Alterações | Ativos | Variação entre as pontas |
|---|--:|--:|---|
| `ipvaLicenciamentoMensal` | 149 | 80 | R$ 525 → R$ 434 |
| `ipvaLicenciamento` | 144 | 80 | R$ 151,88 → R$ 140,34 |
| `lucroVariavelPrevisto` | 113 | 40 | conjunto (contém o cavalo) |
| `custoFixo` | 47 | 23 | conjunto |
| `finame` | 47 | 23 | conjunto |
| `lucroVariavelPrevistoCarreta` | 47 | 18 | 47/47 transições com zero |
| `lucroFixomodeloNovoCiclo` | 16 | 16 | **+R$ 51.918,06/mês** |
| `finameImplemento` | 11 | 7 | **−R$ 32.570,33/mês** |
| `jurosFinameImplemento` | 11 | 7 | −R$ 7.772,71/mês |
| `seguro` | 8 | 7 | R$ 177,23 → R$ 627,86 |
| `tacografo` | 8 | 7 | R$ 0 → R$ 21,03 |
| `amortizacaoImplemento` | 7 | 7 | −R$ 24.797,66/mês |
| `ciclo` | 7 | 7 | 1 → 2 |
| `lucroFixomodeloNovoCicloCarreta` | 7 | 7 | +R$ 13.558,10/mês |
| `TJLP` | 4 | 4 | 6,15% → 7,26% |
| `Taxa Finame (%)` | 4 | 4 | 11,99% → 13,16% |
| `statusFinanciamentoT1Shared` | 7 | 7 | texto |

O panorama ainda tira dos rankings o que contaria o mesmo real duas vezes — a
parcela cujo total mudou junto, e a coluna de conjunto que já embute o outro
equipamento. Sobram **27 linhas econômicas** (12 fixo + 10 variável + 5 sem
classe).

---

## 2. Quais já têm semântica suficiente para sustentar uma recomendação

A régua de hoje é `assessImpact` (`lib/comparison/src/impact.ts`), e ela é uma
porta de três chaves: **semântica CONFIRMED**, **`is_monetary = true`** e
**`aggregation = SUM`**. Sem as três, não há número financeiro — há um motivo
escrito.

`CONFIRMED_SEMANTICS` (`lib/curation/src/confirmations.ts`) tem **15 entradas**,
das quais 13 são monetárias e somáveis. Cruzando com os 35 alterados:

**Passam a régua (11):**

| Código | Periodicidade | Base da confirmação |
|---|---|---|
| `cavalo.finame_cavalo` | MENSAL | amortização ÷ (NF × (1−entrada) ÷ prazo) = 1,081 |
| `cavalo.amortizacao_cavalo` | MENSAL | mesma cadeia |
| `cavalo.juros_finame_cavalo` | MENSAL | mesma cadeia |
| `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | MENSAL | mesma cadeia |
| `cavalo.ipva_licenciamento` | **ANUAL** | 1,000% da NF, desvio 0, 6 vigências |
| `carreta.custo_fixo` | MENSAL | confirmado pelo transportador |
| `carreta.finame` | MENSAL | soma não muda de periodicidade no meio |
| `carreta.finame_implemento` | MENSAL | idem |
| `carreta.amortizacao_implemento` | MENSAL | idem |
| `carreta.juros_finame_implemento` | MENSAL | idem |
| `carreta.lucro_fixomodelo_novo_ciclo` | MENSAL | idem |

**Depois de tirar parcela e conjunto, sobram quatro linhas econômicas com
dinheiro apurado** — e as quatro são custo fixo:

- `cavalo.finame_cavalo` — **−R$ 52.223,90/mês**
- `cavalo.ipva_licenciamento` — **−R$ 731.586,01/ano**
- `carreta.finame_implemento` — **−R$ 32.570,33/mês**
- `carreta.lucro_fixomodelo_novo_ciclo` — **+R$ 51.918,06/mês**

**Não passam (24 dos 35).** `seguro`, `tacografo`, `ipvaLicenciamento` da
carreta, os dois `lucroVariavelPrevisto`, todo o bloco de combustível, toda a
manutenção, as taxas e os cadastrais. O motivo, por parâmetro, já é escrito
hoje por `motivoDaRegua`.

**O achado que isto expõe: 2.155 das 2.931 alterações são de custo variável e
nenhuma tem impacto apurável.** A aba Cliente herda essa fronteira inteira — e
é justamente por isso que ela precisa da categoria INVESTIGAR, senão o custo
variável some da conversa com o cliente por não ter número.

---

## 3. Comportamento econômico, parâmetro a parâmetro

Aqui está a dimensão que **não existe em lugar nenhum do código hoje**. O que
existe é *o que a coluna é* (unidade, periodicidade, agregação, classe de
custo, em que valor da remuneração ela mexe). O que falta é *para que lado ela
empurra a remuneração quando se move*.

A modelagem que proponho não declara os dois efeitos separadamente — declara o
**sentido** e deriva os dois, para que não possam se contradizer:

| Sentido | Aumenta → | Diminui → |
|---|---|---|
| `DIRETO` | remuneração ↑ | remuneração ↓ |
| `INVERSO` | remuneração ↓ | remuneração ↑ |
| `NULO` | sem efeito | sem efeito |
| `NAO_MONOTONICO` | depende da faixa | depende da faixa |
| `DEPENDE_DE_FORMULA` | precisa da fórmula e das bases | idem |
| `DESCONHECIDO` | não sabemos | não sabemos |

E três eixos que decidem se cabe *pedir alguma coisa*:

- **`papel`** — `MONTANTE` (é o dinheiro), `TAXA`, `PRAZO`, `RELOGIO`
  (avança sozinho com o tempo), `DRIVER_FISICO`, `ESPECIFICACAO`,
  `IDENTIFICACAO`.
- **`acionavel`** — `NEGOCIAVEL` (o cliente parametriza), `INDEXADO_EXTERNO`
  (TJLP, índice publicado), `AUTOMATICO` (o relógio, o ciclo do
  financiamento), `CADASTRAL`, `DESCONHECIDO`.
- **`fonteDoValorRecomendado`** — de onde sairia o valor a propor, se houver.

### O mapa, para os parâmetros que aparecem em Impacto

| Parâmetro | Papel | Sentido | Acionável | Mecanismo |
|---|---|---|---|---|
| `cavalo.finame_cavalo` e parcelas | MONTANTE | DIRETO | AUTOMATICO | É o custo fixo do cavalo. Sobe/desce com o ciclo do financiamento; quando ele encerra, o valor migra para o lucro fixo do novo ciclo dentro do mesmo total. |
| `carreta.finame_implemento` e parcelas | MONTANTE | DIRETO | AUTOMATICO | Idem, no implemento. |
| `carreta.lucro_fixomodelo_novo_ciclo` | MONTANTE | DIRETO | NEGOCIAVEL | É o que se recebe depois de quitado o financiamento. O valor é parametrizado, não calculado por prazo. |
| `cavalo.ipva_licenciamento` | MONTANTE | DIRETO | NEGOCIAVEL | Tributo reembolsado no fixo. A base de cálculo mudou duas vezes na série. |
| `carreta.seguro`, `tacografo`, `faixa_reflexiva`, `revestimento`, `rastreador` | MONTANTE | DIRETO | NEGOCIAVEL | Itens de valor fixo do implemento. |
| `taxa_finame`, `tjlp`, `spread_bndes`, `spread_banco` | TAXA | DIRETO | INDEXADO_EXTERNO (TJLP) / NEGOCIAVEL (spreads) | **Taxa maior ⇒ juros maiores ⇒ recebo mais.** Medido: TJLP 7,70→7,26 derrubou `jurosFinameCavalo` em R$ 85,15/mês/placa. `Taxa Finame = (1+TJLP)(1+spreadBNDES)(1+spreadBanco) − 1`, conferida ao centésimo. |
| `periodo_finame` | PRAZO | INVERSO | NEGOCIAVEL | Prazo maior ⇒ amortização mensal menor ⇒ parcela menor. |
| `percentual_entrada` | TAXA | INVERSO | NEGOCIAVEL | Entrada maior ⇒ menos financiado ⇒ parcela menor. |
| `carencia` | PRAZO | DEPENDE_DE_FORMULA | NEGOCIAVEL | Adia a amortização; desloca no tempo em vez de aumentar ou diminuir. |
| `valor_nf_compra` | MONTANTE | DIRETO | CADASTRAL | Base do financiamento, do IPVA (1,000% a.a.) e do PIS/COFINS (9,250%). |
| `combustivel_vida_cavalo` | **RELOGIO** | NULO (direto) | AUTOMATICO | **Idade do cavalo em anos.** 494/494 transições para cima, +0,083/vigência, e igual a `manutencaoVidaMeses ÷ 12,17`. Não remunera por si; é o eixo da curva de perda. |
| `manutencao_vida_meses` | **RELOGIO** | NULO (direto) | AUTOMATICO | A mesma idade, em meses. |
| `combustivel_percentual_perda_vida` | DRIVER_FISICO | DEPENDE_DE_FORMULA | NEGOCIAVEL | Quanto o consumo piora com a idade. O sinal do efeito depende de a fórmula reconhecer *litros* ou *km/l* — e o export não traz a fórmula nem o volume. |
| `combustivel_consumo_neg`, `combustivel_consumo_benchmark` | DRIVER_FISICO | INVERSO | NEGOCIAVEL | km/l maior ⇒ menos litros reconhecidos ⇒ menor remuneração de diesel. **Este é o caso do enunciado — e ele vale para `consumoNeg`, não para `vidaCavalo`.** |
| `manutencao_reais_km`, `custo_variavel_simulado`, `manutencao_bid`, `reaiskm` | DRIVER_FISICO | DIRETO | NEGOCIAVEL | R$/km. Vira dinheiro só com a quilometragem do período, que este export não traz. |
| `percentual_reajuste_aplicado` | TAXA | DIRETO | NEGOCIAVEL | Reajuste aplicado ao valor. |
| `odometro_entrada` | DRIVER_FISICO | NULO | CADASTRAL | Leitura do hodômetro. |
| `ciclo` | ESPECIFICACAO | NULO | AUTOMATICO | Numera o ciclo do financiamento. Muda *porque* o financiamento terminou. |
| `ano`, `capacidade*`, `eixo*`, `double_deck`, `pneu_medida*` | ESPECIFICACAO | NULO | CADASTRAL | Especificação do ativo. Não remunera nada. |
| `icms`, `pis_cofins`, `percentual_icms` | TAXA | DIRETO | CADASTRAL | Alíquota; o montante está em `valor_icms` / `valor_pis_cofins`. |
| `lucro_variavel_previsto*` | MONTANTE | DIRETO | DESCONHECIDO | Semântica não confirmada e série intermitente (ver §9.3). |
| `ipva_licenciamento_mensal` (carreta) | MONTANTE | DIRETO | DESCONHECIDO | Homonímia comprovada com `ipvaLicenciamento` — dispersão de 63% na razão por ativo. Ninguém sabe o que a coluna é. |

---

## 4. Quais **não** podem gerar recomendação segura — e por quê

Quatro motivos distintos, que a tela precisa separar porque exigem ações
diferentes:

**a) Falta de régua financeira (24 dos 35).** Semântica não confirmada, não
monetária ou não somável. Ação: curadoria. → `INVESTIGAR` quando há efeito
econômico conhecido, `NAO_CALCULAVEL` quando nem isso.

**b) Falta a base que transforma a razão em dinheiro.** `manutencaoReaisKm`
(R$/km), `combustivelConsumoNeg` (km/l), `Custo Variável Simulado` (R$/km).
`BASE_QUE_FALTA` em `lib/composition/src/regras.ts` já nomeia o que falta:
quilometragem rodada, preço do litro. Ação: pedir o arquivo à Ambev. →
`INVESTIGAR`, nunca R$ 0,00.

**c) A variação é artefato da fonte, não preço.** Colunas que zeram e voltam:

| Coluna | Transições | Com zero de um lado | Placas que só oscilam valor ↔ 0 |
|---|--:|--:|--:|
| `lucroVariavelPrevistoCavalo` | 107 | **107** | 34 |
| `combustivelConsumoBenchmark` | 107 | **107** | 34 |
| `lucroVariavelPrevistoCarreta` | 47 | **47** | 18 |
| `manutencaoReaisKm` | 109 | 108 | 34 |
| `lucroVariavelPrevisto` (carreta) | 113 | 57 | 23 |

Ação: perguntar por que a coluna esvazia. → `INVESTIGAR`, com o padrão medido
na frase. **Nunca** propor recompor o valor.

**d) A mudança é legítima e conhecida.** Fim de financiamento (`ciclo` 1→2, o
FINAME zerando e o lucro fixo do novo ciclo entrando), o relógio da idade, o
odômetro andando. → `NAO_PROPOR`, com o motivo escrito, porque "não aparece na
lista" e "aparece dizendo que está certo" não são a mesma resposta para quem
confere.

---

## 5. Onde mora hoje a lógica que permite calcular o impacto

| Pergunta | Autoridade | Arquivo |
|---|---|---|
| Vira dinheiro? | `assessImpact` | `lib/comparison/src/impact.ts` |
| O mesmo motivo, em prosa, para a tela | `motivoDaRegua` | `lib/comparison/src/panorama.ts` |
| Unidade, periodicidade, agregação, monetário | `attribute` + `attribute_semantics` | `lib/curation/src/{semantics,confirmations,versioning}.ts` |
| Classificação na data da vigência | `loadAttributeClassificationsAt` | `lib/comparison/src/classification.ts` |
| Custo fixo ou variável | `INHERITED_COST_CLASS_JOIN` (taxonomia) | `lib/comparison/src/classification.ts` |
| Em que valor da remuneração mexe | `CLASSIFICACAO_DE_PARAMETROS` | `lib/knowledge/src/classificacao.ts` |
| Total × parcela, e o escopo de conjunto | `COMPOSITIONS`, `ESCOPOS_DE_CONJUNTO` | `lib/comparison/src/composition.ts` |
| O que compõe a remuneração do equipamento | `comporDeFatos` | `lib/composition/src/motor.ts` |
| Por que um componente ficou de fora | `MotivoDeExclusao`, `BASE_QUE_FALTA` | `lib/composition/src/regras.ts` |
| Mensal ⇄ anual, e a recusa de converter pontual | `convertPeriodicity` | `lib/simulation/src/periodicity.ts` |
| Tudo que mudou, com preço separado de frota | `getPanoramaDeAlteracoes` | `lib/comparison/src/panorama.ts` |
| Ativo a ativo, vigência a vigência | `getQuinzenaMatrix` | `lib/comparison/src/impacto.ts` |
| Unidade × canal | `resolveContext`, `contextFilter` | `lib/comparison/src/series.ts` |
| Nome de leitura | `attributeLabel` | `lib/comparison/src/labels.ts` |

**Nada disso será reimplementado.** A aba Cliente consome as duas últimas
camadas e acrescenta exatamente uma coisa: a interpretação econômica.

---

## 6. As propriedades semânticas que faltam

Cinco, e nenhuma delas é derivável do que já existe:

1. **`sentido`** — para que lado a remuneração vai quando o parâmetro se move.
   Não sai da unidade: `taxaFiname` e `percentualEntrada` são as duas PERCENT e
   têm sentidos opostos.
2. **`papel` econômico** — montante, taxa, prazo, relógio, driver físico,
   especificação. Distingue *o dinheiro* de *o que empurra o dinheiro*. Sem
   ele, `TJLP` e `jurosFinameCavalo` viram duas linhas independentes e o mesmo
   real é discutido duas vezes.
3. **`acionavel`** — se faz sentido pedir ao cliente que mude. É o que separa
   "propor" de "investigar" mesmo quando o impacto é idêntico.
4. **`dependeDe` / `alimenta`** — qual coluna carrega o dinheiro deste driver.
   É o que permite dizer "a TJLP caiu, e o efeito disso está em
   `jurosFinameCavalo`: −R$ 85,15/mês por cavalo".
5. **`fonteDoValorRecomendado`** — de onde viria o valor a propor. Sem fonte
   declarada, não há proposta: há investigação.

**Onde isso deve morar: `lib/knowledge`.** É o mesmo critério que já colocou
`catalogo.ts` e `classificacao.ts` lá — é o mapa do modelo de remuneração, não
uma projeção dos nossos fatos; precisa existir com o banco vazio; e cada linha
carrega a evidência que a sustenta, revisável num pull request. Não vai para o
banco pelo mesmo motivo que `CONFIRMED_SEMANTICS` não foi.

---

## 7. Arquitetura proposta

```
Impacto identifica  →  Semântica interpreta  →  Cliente recomenda
getPanoramaDeAlteracoes   @workspace/knowledge      @workspace/advisory
(lib/comparison)          COMPORTAMENTO_ECONOMICO   avaliar() + motor
```

**`lib/knowledge/src/economia.ts`** — a autoridade semântica. Uma tabela
declarativa por código de atributo, com `papel`, `sentido`, `acionavel`,
`mecanismo` (a frase que a tela mostra), `dependeDe`, `alimenta`,
`fonteDoValorRecomendado` e `evidencia`. Mais os leitores derivados
`efeitoQuandoAumenta(code)` e `efeitoQuandoDiminui(code)` — derivados, e não
declarados, para que não possam se contradizer.

**`lib/advisory`** (novo pacote `@workspace/advisory`) — o motor:

- `recomendacao.ts` — os tipos e a função **pura** `avaliarParametro()`, que
  recebe a linha do panorama + o comportamento econômico + as transições
  medidas e devolve `situacao`, `confianca`, `valorRecomendado`, `fonte`,
  `impacto` e `porque`. Pura de propósito: é onde os testes moram.
- `transicoes.ts` — a única consulta nova. Agrupa as transições por (vigência,
  valor antes → valor depois) para produzir "8,2 → 9,1 em EMPURRADA_2_7_2026,
  73 veículos". Usa `contextFilter` — não reconstrói contexto.
- `motor.ts` — `getRecomendacoesAoCliente(db, options)`: chama
  `getPanoramaDeAlteracoes` para o universo, `resolveContext` para o recorte, e
  compõe. **Não soma nada por conta própria.**

**Rota** `artifacts/api-server/src/routes/cliente.ts` → `GET /api/cliente/recomendacoes`,
com o mesmo `parseContext` de `impacto.ts`.

**Tela** — quarta aba em `alteracoes.tsx`, à direita de Impacto, componente em
`components/changes/cliente-recomendacoes.tsx`.

### A decisão, em ordem

```
sem comportamento declarado ................................ NAO_CALCULAVEL
sentido NULO (especificação, identificação, relógio) ....... NAO_PROPOR
impacto não calculável + efeito econômico conhecido ........ INVESTIGAR
impacto não calculável + nada conhecido .................... NAO_CALCULAVEL
efeito nos favorece ........................................ NAO_PROPOR
efeito indeterminado ....................................... INVESTIGAR
variação com zero em ≥70% das transições ................... INVESTIGAR (artefato)
nos prejudica + acionável AUTOMATICO/CADASTRAL ............. NAO_PROPOR
nos prejudica + acionável INDEXADO_EXTERNO ................. INVESTIGAR
nos prejudica + NEGOCIAVEL + fonte de valor declarada ...... PROPOR_AJUSTE
nos prejudica + NEGOCIAVEL sem fonte ....................... INVESTIGAR
```

O efeito nunca é inferido do sinal do delta: para `MONTANTE` ele é lido de
`variacao.preco` (que já vem separado do tamanho da frota); para `TAXA`,
`PRAZO` e `DRIVER_FISICO` ele vem do `sentido` declarado, e o dinheiro fica na
coluna que o driver alimenta — **nunca somado duas vezes**.

### Confiança

`ALTA` quando semântica confirmada + comportamento declarado com evidência
medida + fonte do valor recomendada. `MEDIA` quando uma das três é derivada.
`BAIXA` quando o impacto é projeção de periodicidade ou a evidência é indireta.
Recomendação de confiança baixa entra na lista **dizendo que é baixa**, nunca
escondida.

---

## 8. Proposta visual

**Topo — "O que recomendamos discutir com o cliente".** Quatro ladrilhos:
impacto total identificado (R$/mês e R$/ano em linhas separadas, nunca
somadas), impacto potencialmente recuperável (só o que está em PROPOR),
quantos para propor / quantos para investigar, e o percentual do impacto
explicado (quanto do dinheiro que se moveu tem leitura econômica). Abaixo, uma
linha de procedência: de que vigências, que unidade, que canal, quantos ativos.

**Corpo — cartões por prioridade**, um por recomendação:

```
┌────────────────────────────────────────────────────────────┐
│ ⚠ INVESTIGAR          confiança média        62 cavalos    │
│ IPVA / Licenciamento                                        │
│ 11.089,38 → 2.513,19  ·  EMPURRADA_2_12_2025 → 1_8_2026    │
│                                                             │
│ Por que isso nos prejudica                                  │
│ O Freightec trocou a base de cálculo do IPVA duas vezes.    │
│ Até Dez/2025 era o valor real por veículo (2,52% da nota,   │
│ em média). Em Jan/2026 virou 1,000% fixo. Em Jul/2026       │
│ passou a 0,651%. A linha de IPVA da frota caiu de           │
│ R$ 989.844 para R$ 268.952 por ano.                         │
│                                                             │
│ Impacto estimado        −R$ 731.586,01/ano                  │
│ Valor atual             0,651% da nota (média)              │
│ Valor recomendado       — não há fonte para determiná-lo    │
│ O que perguntar         Qual a base contratual do IPVA?     │
│ Fonte                   docs/ACHADO-IPVA.md — medição das   │
│                         9 vigências, desvio 0,0000          │
│                                     [ver detalhe técnico →] │
└────────────────────────────────────────────────────────────┘
```

Três caixas dobráveis abaixo da lista, e não abas novas: **Não propor**, com o
motivo de cada um; **Não calculável**, com o que destravaria cada um; e **o que
o Impacto viu e a semântica ainda não lê**.

**Ordem**: perda recuperável (desc) → abrangência de frota (desc) → confiança
(desc) → recorrência → relevância econômica. Nunca alfabética. As
investigações entram intercaladas por impacto, não num bloco no fim: uma
investigação de R$ 731 mil vale mais atenção do que uma proposta de R$ 300.

**Filtros** — os mesmos de Impacto, pela mesma autoridade: unidade e canal por
`resolveContext`, o corte por equipamento vindo de `listImpactEntityTypes`, e o
recorte **De/Até vigência** pendurado no próprio contexto (`SeriesContext.janela`,
aplicado em `contextFilter`). Ele foi acrescentado em Impacto e é herdado aqui
pelo mesmo caminho — o estado vive uma vez só em `alteracoes.tsx` e as duas abas
o compartilham, de modo que trocar de aba não troca o período debaixo dos
números. Ver §12.

---

## 9. Exemplos reais — a prova de que o sinal matemático não é o econômico

### 9.1 `TJLP` caiu, e nós perdemos — cavalo QYW2F98

| Vigência | TJLP | Taxa Finame | Juros | Amortização | FINAME cavalo |
|---|--:|--:|--:|--:|--:|
| 2_1_2026 | 7,70% | 13,62% | 2.623,49 | 8.039,07 | **10.662,56** |
| 2_2_2026 | **7,26%** | **13,16%** | **2.538,34** | 8.039,07 | **10.577,41** |

O número caiu **0,44 ponto** e a remuneração caiu **R$ 85,15/mês**. Um leitor
que assumisse "caiu = ficou mais barato para mim = bom" leria exatamente ao
contrário. E a fórmula fecha: `(1,0726 × 1,0115 × 1,0430) − 1 = 13,16%`,
composta e não somada.

**Mas o agregado engana no outro sentido.** Na mesma transição, 10 cavalos
mexeram em TJLP: **6 caíram e 4 subiram** (`6,19% → 7,68%`), e o efeito líquido
sobre os juros foi **+R$ 128,52**. Uma tela que mostrasse só o líquido diria
"a TJLP nos favoreceu" enquanto seis placas perderam. Por isso a recomendação é
por padrão de transição, e não pela soma da coluna.

### 9.2 `combustivelVidaCavalo` subiu — e não há nada a pedir

O enunciado deste trabalho supôs que essa variável fosse km/l. **Os dados dizem
que não.** Ela sobe em **494 das 494** transições, nunca desce, avança
**+0,083 por vigência** — um doze avos de ano por mês — e vale exatamente
`manutencaoVidaMeses ÷ 12,17` (dispersão entre 12,07 e 12,50). É a **idade do
cavalo em anos**.

Consequências para a aba:

- Aumento **não é** alteração de premissa: é o calendário. → `NAO_PROPOR`,
  acionável `AUTOMATICO`.
- Ela é o eixo da curva de perda, não a remuneração. Quem carrega dinheiro é
  `combustivelPercentualPerdaVida` (−1,5% → −2%) e `combustivelConsumoNeg`.
- E **é `consumoNeg` que tem o sentido `INVERSO` do enunciado**: km/l maior ⇒
  menos litros reconhecidos ⇒ menor remuneração de diesel. Só que o export não
  traz volume nem preço do litro (`BASE_QUE_FALTA`), então o impacto é
  `NAO_CALCULAVEL` e o item vira `INVESTIGAR` — não uma proposta com número
  inventado.

Se a aba tivesse sido escrita com a regra "subiu ⇒ peça para baixar", ela teria
proposto rejuvenescer 64 caminhões.

### 9.3 `lucroVariavelPrevistoCavalo` — a perda que não existe

A aba Impacto mostra **−R$ 23.466,25** (230.266,56 → 206.800,31). A tela já
avisa que o parâmetro não passa na régua. O que ela ainda não diz é *por quê o
número é enganoso*: **107 de 107 transições têm um zero de um dos lados**, e 34
placas nunca assumem outro valor além de `2.662,60` e `0`. A placa QYQ6A80
percorre `0 → 0 → 2.662,60 → 0 → 2.662,60 → 0 → 0 → 0 → 0`.

Isto não é preço caindo: é uma coluna intermitente. → `INVESTIGAR`, com a
pergunta "por que a coluna esvazia em algumas vigências?", e **jamais** uma
proposta de recompor R$ 23 mil.

### 9.4 O FINAME que terminou — o maior número, e nada a propor

`cavalo.finame_cavalo` cai **R$ 52.223,90/mês**, o maior movimento mensal
apurado do export. A decomposição pelas parcelas fecha ao centavo:

```
amortização   −69.304,36
juros         −21.279,50
lucro fixo    +38.359,95
              ──────────
              −52.223,91
```

Quinze cavalos com `ciclo` indo de 1 para 2, o financiamento zerando e o lucro
fixo do novo ciclo entrando no lugar por menos. A parte legítima é o fim do
financiamento; a parte discutível é *o tamanho do que entrou no lugar* — e essa
é uma pergunta de contrato, não um valor que possamos propor. →
`INVESTIGAR`, confiança média, com a conta acima escrita.

Na carreta a mesma mecânica aparece com sinal invertido no líquido:
`finameImplemento` −32.570,33 contra `lucroFixomodeloNovoCiclo` +51.918,06.
**Aqui o novo ciclo pagou mais do que o financiamento que saiu** — e uma aba
que só listasse quedas teria pedido para recompor o FINAME de um implemento
quitado que passou a render mais.

### 9.5 O que sobe e é nosso — `seguro`

`carreta.seguro` sobe de R$ 177,23 para R$ 627,86 em 6 implementos (mais 2 em
outra vigência): **+R$ 2.375,61/mês**. Favorável. → `NAO_PROPOR`, escrito
assim, para que ninguém peça revisão do que nos beneficia.

---

## 10. Riscos de recomendar um ajuste incorreto

| Risco | Como aparece | Como a arquitetura o barra |
|---|---|---|
| **Pedir para desfazer o legítimo** | "Recompor o FINAME" de um financiamento quitado | `acionavel: AUTOMATICO` + a composição total/parcela |
| **Pedir para reverter o relógio** | "Voltar a vida do cavalo para 4,92" | `papel: RELOGIO`, medido em 494/494 transições |
| **Confundir artefato com perda** | R$ 23 mil de lucro variável "recuperáveis" | detecção de transição com zero, ≥70% ⇒ INVESTIGAR |
| **Ler o agregado e perder o caso** | "A TJLP nos favoreceu" com 6 placas perdendo | recomendação por padrão de transição, não pelo líquido |
| **Somar mensal com anual** | R$ 731 mil/ano dentro do total mensal | duas linhas separadas; conversão só por `convertPeriodicity`, marcada como projeção |
| **Inventar o valor a propor** | "Voltar para o valor anterior" sem saber se ele era o certo | `fonteDoValorRecomendado` obrigatória para PROPOR |
| **Tratar ausência como zero** | Coluna vazia virando "caiu para R$ 0,00" | herdado de `impacto.ts`: `SEM_VALOR ≠ 0` |
| **Correlação como causalidade** | "O ciclo mudou, logo o ciclo causou a queda" | `dependeDe`/`alimenta` declarados com evidência medida |
| **Contar o mesmo real duas vezes** | TJLP e juros como duas perdas | driver não carrega dinheiro; o dinheiro fica na coluna alimentada |
| **Perder credibilidade na mesa** | uma proposta errada num pacote de dez | ordem por impacto, confiança à vista, e 0 propostas é um resultado |

**O custo assimétrico é o princípio de projeto desta aba.** Uma proposta errada
queima a próxima reunião inteira; uma investigação a mais custa uma pergunta.
Na dúvida, a aba investiga.

---

## 11. O que a execução sobre o dado real mudou no projeto

O motor foi rodado contra as 9 vigências do export antes de a tela existir, e a
primeira rodada **errou duas vezes**. As duas correções estão no código e nos
testes, e valem mais do que o resultado final.

### Erro 1 — propôs devolver o IPVA a um valor que não é premissa

A primeira versão classificou `cavalo.ipva_licenciamento` como **PROPOR
AJUSTE**, com a frase "revisar de R$ 7.210 para R$ 21.259,89". O número saía do
par de transição mais comum — e o par mais comum cobre **30 das 62 placas**
afetadas. Para as outras 32, R$ 21.259,89 é simplesmente o valor errado: o IPVA
é calculado como alíquota sobre a nota de cada veículo, e a nota é diferente em
cada um.

A regra que entrou: **um número só pode ser proposto quando ele é a premissa, e
não o resultado dela.** Dois sintomas denunciam o resultado — o valor é
calculado a partir de outro parâmetro (`dependeDe` preenchido), ou o par
dominante não cobre a maioria dos ativos afetados (`COBERTURA_DE_PREMISSA`,
60%). Nos dois casos a saída é INVESTIGAR, e a pergunta muda de "volte ao valor
anterior" para "qual é a base contratual do cálculo?".

### Erro 2 — leu um ganho como coluna intermitente

`carreta.tacografo` tem **8 de 8** transições com zero de um dos lados, e a
primeira versão do detector — só proporção — o classificou como coluna que
pisca. Ele não pisca: são sete implementos que passaram a ter o item cadastrado,
de R$ 0 para R$ 21,03. Um ganho virou investigação.

A assinatura correta não é a proporção de zeros, é o **retorno**: quantos ativos
voltam a ter valor depois de zerar. Medido no export:

| Coluna | % de transições com zero | Ativos que voltam | Veredicto |
|---|--:|--:|---|
| `lucroVariavelPrevistoCavalo` | 100% | 30 | pisca |
| `combustivelConsumoBenchmark` | 100% | 30 | pisca |
| `manutencaoReaisKm` | 99% | 30 | pisca |
| `lucroVariavelPrevistoCarreta` | 100% | 15 | pisca |
| `tacografo` | 100% | **0** | item passou a existir |
| `lucroFixomodeloNovoCicloCarreta` | 100% | **0** | novo ciclo entrando |
| `finameImplemento` | — | **0** | financiamento encerrando |
| `finameCavalo` | 49% | 9 | ciclo de vida, não oscilação |

As duas condições juntas separam os oito casos sem exceção. Nenhuma das duas
sozinha separa.

### O resultado, depois das correções

```
parâmetros alterados ....... 35
linhas econômicas .......... 27      fora da conta (conjunto) ... 3
propor / investigar ........ 0 / 14
não propor / não calculável  13 / 0
impacto explicado .......... 100%
  MENSAL: identificado R$ 136.712,29 · recuperável R$ 0
  ANUAL:  identificado R$ 731.586,01 · em investigação R$ 731.586,01
```

As quatro primeiras linhas da tela, na ordem em que ela as mostra:

| # | Situação | Parâmetro | Impacto | Por quê |
|--:|---|---|--:|---|
| 1 | INVESTIGAR | IPVA / Licenciamento (cavalo) | −R$ 731.586,01/ano | valor é resultado de alíquota × nota; pedir a base, não o valor |
| 2 | INVESTIGAR | IPVA / Licenciamento (carreta) | não apurável | movimento contra nós, semântica presumida |
| 3 | INVESTIGAR | IPVA “mensal” (carreta) | não apurável | 27 ativos para baixo, 30 para cima — líquido esconde |
| 4 | INVESTIGAR | Custo variável simulado | não apurável | 29 contra 236 em direções opostas |
| … | NÃO PROPOR | FINAME do cavalo | −R$ 52.223,90/mês | financiamento encerrando — mecanismo próprio |
| … | NÃO PROPOR | Lucro fixo do novo ciclo | +R$ 51.918,06/mês | favorável a nós |
| … | NÃO PROPOR | Vida do combustível / da manutenção | — | o relógio |
| … | NÃO PROPOR | Seguro, tacógrafo, reajuste | — | favoráveis a nós |

**Zero propostas neste export não é a aba falhando.** É a aba dizendo que, nas
nove vigências disponíveis, tudo que se move ou nos favorece, ou é mecanismo
próprio do contrato, ou ainda não tem base para virar pedido. O que ela produz
são quatorze perguntas específicas — e a primeira delas vale R$ 731 mil por ano.

---

## 12. O recorte De/Até de vigências

Acrescentado em Impacto e herdado por Cliente, como o §8 previa. Três decisões
o definem, e nenhuma é de tela.

### Onde ele mora

**No contexto, não no filtro de cada leitura.** `SeriesContext` ganhou uma
`janela` opcional e `contextFilter` a aplica. Como aquele predicado é por onde
toda consulta de leitura do produto passa, o panorama, a matriz por quinzena e
as recomendações ao cliente respeitam o mesmo corte sem que nenhum dos três
tenha uma linha nova. É o oposto de construir um `de`/`ate` em cada rota, que é
exatamente a segunda régua de disponibilidade que o enunciado proíbe.

Consequência que vale dizer: Composição, DRE e Assistente continuam sem janela
porque nunca pedem uma — `janela` ausente é a série inteira, e nenhum deles
mudou de comportamento.

### O que ele recusa

As pontas são **inclusivas** e precisam ser vigências que o contexto entregou.
Uma data qualquer é recusada com a lista das que existem — `JanelaInvalidaError`,
400 na rota, separado do 404 de "não há contexto". Aparar em silêncio para a
vigência mais próxima produziria o número certo sob o título errado, que é a
categoria de erro que este produto inteiro evita. Intervalo invertido também é
recusa, e a tela nem o oferece: o "Até" desabilita as datas anteriores ao "De".

Meia janela é aceita: "de março para cá" completa a outra ponta com o extremo da
série.

### O que ele não muda

`context.periods` continua sendo o tamanho do histórico. Se ele encolhesse ao
filtrar, a frase "N vigências no histórico" que várias telas mostram deixaria de
ser verdadeira sem ninguém perceber. Quem responde "quantas caem no recorte" é
`periodosNaJanela` — e é ele que permite à tela separar dois estados que de fora
são idênticos e por dentro são opostos:

- **"Nada mudou neste recorte"** — houve comparação e ela não achou nada.
- **"Uma vigência só — não há par para comparar"** — não houve comparação.

### Medido sobre o export real

O mesmo motor, quatro recortes:

| Recorte | Vigências | Linhas econômicas | Propor / Investigar | Maior impacto |
|---|--:|--:|---|---|
| série inteira | 9 | 27 | 0 / 14 | IPVA −R$ 731.586,01/ano |
| mai → ago/2026 | 4 | 21 | 0 / 11 | IPVA −R$ 144.874,50/ano |
| jul → ago/2026 | 2 | 11 | 0 / 5 | sem linha anual |
| ago/2026 | 1 | 0 | 0 / 0 | não há par |

Três coisas que a tabela confirma:

1. **A janela recorta a comparação, não só a exibição.** No recorte de dois
   meses o IPVA some da conta anual — a transição dele foi em julho, e a
   primeira vigência da janela não tem predecessora. É o comportamento certo:
   uma janela que arrastasse valores de antes da borda mostraria uma alteração
   que não aconteceu dentro do período pedido.
2. **Menos evidência produz mais cautela, e não mais certeza.** No recorte de
   quatro meses o FINAME do cavalo deixa de ser "mecanismo próprio" e vira
   INVESTIGAR: dentro daquela janela ele tem 8 de 9 transições com zero e placas
   que voltam, ou seja, a assinatura de coluna intermitente. A aba diz isso em
   vez de propor recompor R$ 29 mil.
3. **Uma vigência não vira zero.** O recorte de um mês devolve lista vazia com a
   frase certa, e não "nada mudou".
