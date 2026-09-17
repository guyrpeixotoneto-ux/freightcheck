# A fonte Real da Auditoria de FINAME

Como a mesma tela passou a responder duas perguntas — *o que mudou entre duas
vigências remuneradas?* e *a remuneração cobriu o custo realizado?* — e as
decisões que essa segunda pergunta obrigou a tomar.

**Medido em 17/09/2026**, sobre o repositório inteiro e sobre a base curada
(`Modelo_Carreta` + `Modelo_Cavalo`, 9 vigências de 16/12/2025 a 01/08/2026,
contexto `CAMAÇARI · EMPURRADA`).

---

## 1. O achado que decidiu a arquitetura: a fonte do realizado não existe

Antes de escrever uma linha, a pergunta era *onde estão os dados reais de
FINAME no pipeline*. A varredura respondeu: **em lugar nenhum**.

Procurado em todo o repositório — código, schema, as 102 migrations, fixtures,
`attached_assets` e documentação:

| procurado | ocorrências |
|---|--:|
| `VLRREA`, `VLR_REA` | **0** |
| `ORIGEM=FIN` | **0** |
| `TIPO=REALIZADO` | **0** |
| qualquer custo contábil por placa e competência | **0** |

Três nomes do produto sugerem o contrário e significam outra coisa:

- `evolucao-de-finame-real.test.ts` é *"contra a base real curada"* — contra as
  planilhas **remuneradas** de verdade, em oposição a fixtures sintéticas;
- `impacto-apurado.ts` é o impacto de uma mudança entre vigências, não custo
  incorrido;
- `lib/fechamento` é a única família de dado realizado do produto, e ela é **de
  trecho**: viagem, CT-e, pagamento por rota. É custo variável, e está fora
  deste módulo por decisão explícita.

`Base_FT_Atualizada_*.xlsx`, o único ativo candidato pelo nome, é a **Base FT /
Contrato** — a régua do remunerado (ver `pages/fechamento/roteiro.ts`, etapa 1).

**A decisão.** Construir a porta antes da fonte. `realizado-de-finame.ts`
declara o contrato `FonteDoRealizado`; enquanto não há adaptador, quem responde
é `SEM_FONTE_DO_REALIZADO`, que devolve **indisponibilidade** — não lista
vazia, que a tela desenharia como um mês sem movimento. Quando o arquivo
chegar, é **um** arquivo que muda: tudo o mais já está escrito e testado.

---

## 2. A regra que impede a dupla contagem: a parcela FINAME é mensal

A fonte Real confronta **uma competência mensal**. O remunerado, porém, chega
em vigências — e o acervo entrega duas por mês, as quinzenas. Havia três
respostas plausíveis para *"qual é o remunerado de setembro?"*, e duas estão
erradas.

**Somar as duas quinzenas conta o dinheiro duas vezes.** A parcela FINAME é
`MENSAL`, e isso está medido em `docs/AUDITORIA-PERIODICIDADE.md` por duas
cadeias independentes:

- `custo_fixo = finame + lucroFixomodeloNovoCiclo` fecha em 611 de 657 linhas
  das 9 vigências. Uma soma não muda de periodicidade no meio: se o total é
  mensal, a parcela é mensal;
- a aritmética do financiamento — `amortizacao ÷ (valorNF × (1 − entrada) ÷
  prazoEmMeses)` — dá razão média 1,08–1,11, compatível com amortização mensal.
  Lida como quinzenal ou anual, a conta erra por um fator inteiro;
- `cavalo.finame_cavalo`, `carreta.finame_implemento` e as parcelas delas estão
  na tabela de periodicidade daquele documento como **MENSAL**.

A vigência da 1ª quinzena **não** diz "metade de setembro": diz "a parcela
mensal deste veículo, como ela está valendo agora". A da 2ª diz o mesmo, quinze
dias depois.

**Não existe vigência mensal consolidada no acervo** — `snapshot` não tem esse
artefato —, e **comparar quinzena a quinzena** só valeria se o realizado
tivesse divisão quinzenal confiável, e ele é mensal.

### A regra adotada

> O remunerado de uma competência é a **parcela mensal vigente** naquele mês,
> por placa — e nunca uma soma.

Quatro situações, todas explícitas (`SituacaoDoConsolidado`):

| situação | quando | valor |
|---|---|---|
| `CONSOLIDADO` | as vigências do mês concordam | a parcela mensal |
| `DIVERGENCIA_INTRAMENSAL` | discordam, ou uma informa e a outra não | `null` — com os dois números à mão |
| `COBERTURA_PARCIAL` | a placa está em parte do mês apenas | `null` |
| `SEM_VALOR` | nenhuma vigência informou a parcela | `null` |

Escolher uma das duas caladamente — a última, a maior, a média — responderia
com precisão inventada a uma pergunta que o dado não responde. As três
situações que não consolidam ficam **fora de todo total** e são **informadas**
na tela.

---

## 3. A fórmula, e por que a direção é fixa

```
diferença = remunerado − realizado
```

| resultado | leitura |
|---|---|
| positivo | **Sobra de remuneração** — pagou acima do custo |
| negativo | **Déficit de remuneração** — pagou abaixo |
| zero | **Equilíbrio** |
| sem os dois lados | **Não calculável** — nunca R$ 0,00 |

**Não há Inverter na fonte Real.** Inverter uma comparação entre duas vigências
é outra leitura legítima do mesmo fato; inverter *remunerado × realizado* é o
fato ao contrário — "déficit" escrito sobre uma sobra.

**Sobra não é pintada de verde.** Uma sobra grande pode ser um ativo que saiu
da operação e continuou sendo remunerado: um achado de auditoria, não uma boa
notícia. A paleta é descritiva (azul para sobra, âmbar para déficit), nunca
avaliativa.

**A variação tem por base o realizado, e não existe sobre base zero.** Um
realizado zero com remunerado de mil reais não é "mil por cento a mais": é uma
divisão que não existe, e a tela escreve um traço.

---

## 4. O sinal de `VLRREA`

A convenção é **declarada pelo adaptador**, nunca inferida do dado
(`ConvencaoDeSinal`). O razão contábil costuma lançar custo a crédito e
entregá-lo negativo; uma exportação de sistema de gestão costuma entregá-lo
positivo. Adivinhar entre as duas inverte o resultado inteiro — um déficit
viraria sobra, com o número certo e o sinal trocado. Inferir pela maioria
funcionaria até o mês em que a operação tivesse um estorno.

`normalizarSinal` **troca o sinal**, e não toma módulo: sob `CUSTO_NEGATIVO`,
um valor positivo na origem é um estorno — dinheiro que voltou — e tem de
chegar à tela como custo negativo. `Math.abs` o transformaria em custo.

O dado bruto sobrevive em `ValorRealizado.bruto`: a normalização é decisão de
**apresentação e de cálculo de custo**, e uma decisão de apresentação não pode
apagar o fato que confere contra o razão.

---

## 5. A conciliação de placas

A chave é **(placa, tipo de ativo)**, e as quatro recusas são explícitas:

1. **Ausência não vira zero.** A linha diz qual lado falta.
2. **Tipos diferentes não conciliam.** A mesma placa como CAVALO no remunerado
   e CARRETA no realizado é `NAO_CONCILIADO`, dito por extenso — é o que impede
   "cavalo + carreta remunerados contra apenas o cavalo realizado".
3. **Duplicata não é somada.** Dois lançamentos para a mesma placa no mesmo mês
   podem ser rateio legítimo ou repetição, e o módulo não tem como saber.
4. **O que não concilia não entra em total nenhum** — nem no líquido, nem nos
   dois totais que o produzem, ou a identidade `líquido = remunerado −
   realizado` deixaria de fechar na própria tela. O que ficou de fora é
   publicado em `foraDoConfronto`, com quanto e quantos.

Veículos **sem placa** no acervo são contados (`semPlaca`) e ficam de fora: uma
chave vazia juntaria num só ativo todos os sem-placa da frota.

---

## 6. Dado de trecho não entra — em três camadas

1. **A lista de vigências** passa por `vigenciasQueCobrem(…, TIPOS_DE_EQUIPAMENTO)`:
   o arquivo de trecho entra no acervo como vigência própria
   (`entity_type_set = TRECHO`) e é descartado antes de qualquer leitura.
2. **A entrada da rota** recusa `?tipo=` fora de `CAVALO`/`CARRETA` com 400.
3. **As colunas lidas** saem do catálogo `VARIAVEIS_DE_FINAME` — a parcela, e
   só ela. Nenhum código de trecho existe lá.

A porta do realizado diz isso na própria frase de indisponibilidade: dado de
trecho não serve e não entra.

---

## 7. Conferência dos totais contra a origem

Agosto/2026, contexto `CAMAÇARI · EMPURRADA`, três leituras independentes:

| leitura | total |
|---|--:|
| `SELECT sum(value_numeric)` sobre `fact`, direto no banco | **R$ 1.122.608,75** |
| `GET /finame/totais` (a rota que já existia), ponta comparada | **R$ 1.122.608,75** |
| `GET /finame/confronto` → `remunerado.totalConsolidado` | **R$ 1.122.608,75** |

Ao centavo, e com a mesma contagem: 62 cavalos + 71 carretas = 133 veículos.

**A base de desenvolvimento não exercita a consolidação de duas quinzenas** —
as nove vigências dela caem uma por mês. É por isso que
`finame-confronto.test.ts` monta o mês de duas entregas à mão: o caso que
decide se o produto conta o dinheiro duas vezes não pode depender de o acervo
de teste tê-lo.

---

## 8. O que muda quando a fonte do realizado chegar

Um arquivo: um adaptador que implemente `FonteDoRealizado` e a linha
`fonteDoRealizadoEmUso()` apontando para ele. Já estão prontos e testados a
consolidação mensal, o confronto, a conciliação, os cartões, a tabela, a
evolução, as rotas, a validação de escopo e a semântica da interface.
