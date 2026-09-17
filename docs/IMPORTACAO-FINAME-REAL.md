# Importar o financiamento real — o extrato do ERP, mês a mês

> O que a Ambev paga de FINAME é o **remunerado**, e o produto sempre soube
> guardá-lo. O que o banco cobrou é o **real**, e ele entra por aqui: o razão
> contábil do ERP, sem conversão manual nenhuma, direto no pipeline oficial.

---

## 1. O procedimento, todo mês

1. Exporte o razão do ERP em `.xlsx` (as colunas de sempre: `MES`, `ANO`,
   `Placa`, `VLRREA`, `NUMDOC` e as demais).
2. Na tela de **Importações**, escolha o acervo **Real**, o tipo do ativo e a
   **unidade** — esta última é obrigatória e não sai do arquivo (ver §4).
3. Envie. A leitura acontece em segundo plano; o cartão mostra o progresso.
4. Confira o resumo e **aprove**.
5. A competência aparece em **Custo Fixo → Finame Real**.

Nada além disso. Não há planilha intermediária, não há "uma linha por placa e
vigência" para preparar, e não há passo manual entre o ERP e a auditoria.

---

## 2. O que acontece com o arquivo

O extrato **não é um cadastro, é um razão**: a linha é um lançamento contábil —
um documento, uma filial, uma conta, uma data de escrituração —, e a mesma placa
aparece quantas vezes o mês tiver lançamentos dela. O export de remuneração é o
contrário: uma linha por equipamento por quinzena.

Por isso o extrato tem leitor próprio (`lib/ingest/src/financiamento-real/`), e
por isso ele se junta ao caminho de sempre exatamente em `staged_fact`:

```
receiveFile → captureRaw → estagiarExtratoReal → preview → promote
                                ↑
                  aqui o razão vira consolidado:
                  um valor por (competência, placa)
```

Do `preview` em diante é o pipeline de sempre, sem exceção para o acervo Real —
identidade canônica da vigência, revisão, escopo obrigatório, presença,
cobertura, exclusão de importação e imutabilidade por gatilho valem igual.

### A vigência que nasce

Uma por competência, com rótulo `EMPURRADA_MENSAL_<mês>_<ano>`, data no dia 1 e
`granularidade = 'MENSAL'`. A coluna existe porque a data sozinha não distingue:
`2026-03-01` é o primeiro dia da competência março **e** o primeiro dia da 1ª
quinzena de março. As duas vigências coexistem porque a família as separa
(`FINANCIAMENTO_REAL` contra `REMUNERACAO_EQUIPAMENTO`), mas só a granularidade
diz que uma cobre trinta dias e a outra quinze.

---

## 3. A regra de agregação, em três casos

Medidos no extrato real de 2026 (903 linhas, 104 placas, nove competências):

| Caso | Como se reconhece | O que acontece |
|---|---|---|
| **Um documento, duas rubricas** (73 chaves) | mesmo `NUMDOC`, valores diferentes | **Somam** — principal e juros do mesmo pagamento |
| **Dois documentos, mesmo valor** (14 pares) | diferem em `NUMDOC` e `DATATU` | **Somam** — dois pagamentos com parcela igual |
| **Linha repetida** (5 pares) | idênticas em **todas** as 43 colunas | **Retidas**: fora da soma, preservadas, aguardando confirmação |

O terceiro caso não é decidido pelo software, e é por isso que ele aparece na
tela com o valor em jogo à vista: somar cobraria duas vezes o mesmo pagamento;
descartar perderia um pagamento que talvez exista.

**Como se decide.** Na tela do Finame Real, cada duplicata retida traz as duas
saídas — "é repetição do export" e "são dois pagamentos" — e um motivo
obrigatório. A decisão é **gravada, não aplicada**: o consolidado só muda quando
aquele mês for reimportado, porque a apuração é função pura das linhas mais as
decisões conhecidas. Aplicar no clique seria mexer numa vigência fechada sem
passar pela pré-visualização.

A decisão é endereçada pela **impressão digital da linha** (todas as células,
inclusive `DATATU`), e não pela chave contábil: aquela agrupa principal e juros
do mesmo documento, e uma confirmação endereçada por ela apagaria o juro junto
com a repetição. Um lançamento lido antes de a coluna existir (`0104`) não tem
endereço, e a tela diz isso em vez de oferecer um botão que não teria onde
gravar — reimportar aquela competência o devolve.

**O sinal** — `VLRREA` é negativo (é débito). O consolidado é apresentado em
positivo e o valor original fica gravado ao lado, porque a reconciliação contra o
razão se faz por ele.

### Reconciliação

Roda **antes** de qualquer escrita e é bloqueante:

```
Σ |VLRREA| do arquivo  =  Σ consolidado
                        + Σ retido como duplicata provável
                        + Σ rejeitado
                        + Σ pendente de classificação
```

Se não fechar, nada é gravado e a importação diz de quanto é a diferença. Uma
agregação que não fecha não é um relatório ruim: é dinheiro sumido entre a
planilha e o banco.

---

## 4. A unidade, e por que ela é declarada

O extrato traz `UNIDADE` por extenso ("TRANSFERÊNCIA URBANA - EMPURRADA") e
`CODUNN` — **nunca o CNPJ**. E é o CNPJ que fecha a identidade de uma vigência:
sem ele, duas unidades diferentes teriam a mesma chave.

Quem sabe o CNPJ é quem envia, escolhendo a unidade do cadastro. É a mesma
autoridade da `0094` — ato explícito de uma pessoa —, e não uma heurística sobre
o texto do arquivo. O que o arquivo diz continua inteiro em `raw_cell` e vira a
evidência contra a qual a declaração é conferida: **um extrato que fale de mais
de uma unidade é recusado**, porque carimbar todas com o mesmo CNPJ poria custo
na unidade que não o teve.

Se você declarar a **competência** no envio, ela também é conferida contra
`MES`/`ANO` das linhas — mandar agosto achando que se manda setembro passa a ser
uma recusa nomeada em vez de silêncio. Sem declarar, o arquivo entra pelas
competências que trouxer (é o caso da carga histórica: um arquivo com nove meses
abre nove vigências).

---

## 5. O tipo do ativo — e o que nunca é deduzido

O tipo sai do **cadastro**, pela placa:

1. `entity_identifier` (PLACA) do acervo — a mesma entidade do remunerado;
2. não achou → **fila de classificação**, e o lançamento fica preservado.

`C.D.C. - VP` significa "crédito direto ao consumidor, veículo pesado", e pesado
é cavalo, é caminhão e é carreta. Deduzir o tipo da conta contábil acertaria na
maioria e erraria calado no resto — e o erro só apareceria como um cavalo somado
no meio das carretas. A conta aparece na fila como **evidência**, nunca como
regra.

O dinheiro das placas na fila não some nem entra: ele aparece na tela como
pendente, e a reconciliação o conta. No extrato de 2026 são 8 placas e
R$ 174.826,25.

Classificar é o mesmo gesto das duplicatas: escolher o tipo, escrever como se
sabe, e reimportar o mês para o valor entrar.

---

## 6. A comparação: mensal contra quinzenal, sem dupla contagem

**As duas quinzenas do remunerado não são somadas.** Medido no acervo:
agosto/2026, o único mês com as duas importadas — 64 de 64 cavalos e 47 de 47
carretas trazem o **mesmo** valor nas duas vigências. A curadoria já dizia isso
por outro caminho: as colunas de FINAME estão confirmadas como periodicidade
`MENSAL`, e "mensal" quer dizer o que o equipamento recebe **por mês** naquela
vigência. A vigência é quinzenal; o valor dentro dela é mensal.

Somar as duas levaria a razão realizado ÷ remunerado de **1,03** (mediana de 715
pares) para ~2,06 — a auditoria passaria a afirmar que a Ambev paga o dobro do
que o banco cobra, em toda a frota, todo mês.

Então:

```
remunerado(mês) = o valor mensal contido na vigência quinzenal do mês
realizado(mês)  = o consolidado da competência
desvio(mês)     = realizado − remunerado
```

- **Se as duas quinzenas discordarem** — não acontece no acervo de hoje —, a
  linha sai como `REMUNERADO_DIVERGE_ENTRE_QUINZENAS`, com os dois valores
  visíveis e fora de qualquer soma. Uma média seria um número que nenhum dos dois
  arquivos afirma.
- **Se um dos lados não existir**, a linha sai como ausência nomeada. Ausência
  não vira zero: "a competência ainda não foi importada" não é uma economia de
  100%.
- **Numa quinzena isolada**, o realizado mostrado é o do mês inteiro, e a tela
  diz isso — ele não foi dividido por dois, e o mesmo valor aparecer nas duas
  quinzenas não é duplicidade.

---

## 7. Mês parcial

Uma competência é marcada como possivelmente parcial quando traz menos de 70% da
mediana de lançamentos das demais, ou quando o mês ainda está em curso. A régua é
uma medida do próprio acervo, e não um mês escrito no código — "setembro está
parcial" é verdade sobre um arquivo, não sobre setembro. Um mês real com queda de
frota cai aqui também, e é o desfecho certo: a marca diz **confira**, não "está
errado". O número continua visível e comparado.

---

## 8. Reimportar

Três camadas, e cada uma responde antes da seguinte:

| Camada | Chave | O que acontece |
|---|---|---|
| Arquivo | `source_file.sha256` | o mesmo arquivo é reconhecido antes de qualquer leitura |
| Vigência | identidade canônica + hash do conteúdo normalizado | o ERP reexportando o mês não abre segunda vigência ativa; conteúdo diferente vira **revisão** |
| Lançamento | a apuração é função pura das linhas | reestagiar apaga antes de escrever, e produz o mesmo consolidado |

Corrigir um mês é reenviar aquele mês: ele entra como revisão, e os outros não
são tocados.

**Reprocessar** (reler o mesmo arquivo porque o leitor mudou) é outra coisa, e
ela herda as declarações do arquivo — tipo, acervo, granularidade, competência e
unidade. Reler nunca desdeclara: a declaração é do arquivo, e a releitura pega a
mais recente que existe na corrente, mesmo que a leitura imediatamente anterior
tenha falhado antes de declarar qualquer coisa.

Quando a releitura conclui que o conteúdo normalizado é o mesmo
(`SKIPPED_DUPLICATE_DATA`), nenhuma revisão é aberta — e as telas passam a ler os
lançamentos **dessa** leitura, que é a mais recente do arquivo que sustenta a
vigência ativa. É o que faz reler com um leitor melhor servir para alguma coisa.

---

## 9. Onde as coisas moram

| O quê | Onde |
|---|---|
| Leitura do razão (pura) | `lib/ingest/src/financiamento-real/extrato.ts` |
| Regra de agregação e dedup (pura) | `lib/ingest/src/financiamento-real/agregacao.ts` |
| Estágio + conferências + vínculo | `lib/ingest/src/financiamento-real/estagio.ts` |
| Comparação entre granularidades (pura) | `lib/comparison/src/finame-real.ts` |
| Consultas da comparação | `lib/comparison/src/finame-real-query.ts` |
| Rotas | `artifacts/api-server/src/routes/financiamento-real.ts` |
| Tela | `artifacts/freightaudit/src/pages/custo-fixo-finame-real.tsx` |
| Schema | `lib/db/src/schema/financiamento-real.ts`, migrations `0103` e `0104` |

Os testes rodam sobre o **extrato real** (`attached_assets/Finames_Real_2026.xlsx`),
e não sobre planilha sintética: as três situações da §3 foram contadas naquele
arquivo, e é nele que precisam continuar sendo encontradas.

```bash
pnpm --filter @workspace/ingest exec vitest run src/financiamento-real
pnpm --filter @workspace/comparison exec vitest run src/__tests__/finame-real.test.ts
```
