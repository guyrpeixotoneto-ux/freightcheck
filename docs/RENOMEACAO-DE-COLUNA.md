# Coluna renomeada entre importações — o desenho

Estado: **desenhado, não implementado.** O que existe hoje está descrito em
"Como está"; o resto é a próxima entrega. Este documento existe para que ela
seja uma construção, e não uma redescoberta.

## O problema, em uma frase

O código do atributo nasce do cabeçalho — `attributeCode =
${entityType.toLowerCase()}.${slugifyColumn(header)}` (`lib/ingest/src/pipeline.ts`)
— então, quando o Freightec renomeia `Seguro` para `Seguro Mensal`, nasce
`carreta.seguro_mensal` com semântica UNKNOWN, e o `carreta.seguro` curado para
de receber fato sem que ninguém seja avisado de que os dois são a mesma coisa.

Não é um defeito da cunhagem do código: derivar identidade do cabeçalho é o que
faz duas importações do mesmo arquivo caírem no mesmo atributo. O que falta é o
caso em que o cabeçalho muda.

## Como está hoje

| Situação | O que o sistema faz |
| --- | --- |
| Cabeçalho igual ao de antes | Mesmo slug → mesmo código → o fato cai no atributo já curado. Funciona. |
| Dois cabeçalhos que normalizam para o mesmo slug | `AMBIGUOUS_COLUMN_SLUG`, severidade ERROR: recusa juntar. Correto. |
| Cabeçalho novo | `NEW_ATTRIBUTE`, severidade INFO, na prévia. Cria atributo novo ao promover. |
| Cabeçalho que sumiu | Nada. Nenhum aviso. |

Existe uma tabela `attribute_alias` (`sourceName`, `sourceSheet`,
`matchConfidence`, `firstSeenImportRunId`), e o pipeline já a consulta ao montar
o `column_mapping` — mas **só para relatar** `MAPPED` vs `NEW`. O fato continua
indo para o código derivado do cabeçalho. Redirecionar o fato é a mudança de
código central desta entrega.

## O desenho

### 1. Dois estados, e não um

`NEW_ATTRIBUTE` hoje cobre duas coisas muito diferentes, e quem lê a prévia não
consegue separá-las:

- **`NOVO_ATRIBUTO`** — coluna que não corresponde a nada que existia. Conceito
  novo: entra como atributo novo, UNKNOWN, e vai para a fila de curadoria. É o
  caminho feliz e não pede decisão nenhuma.
- **`POSSIVEL_RENOMEACAO`** — coluna nova **e**, na mesma vigência e no mesmo
  equipamento, um atributo que vinha recebendo fato parou de aparecer. É uma
  pergunta, e ela tem dono.

O par candidato sai da coincidência de ausência e presença, não de semelhança de
texto. A semelhança pode **ordenar** os candidatos na tela; ela nunca decide —
é assim que duas colunas diferentes viram uma.

### 2. A decisão acontece na prévia, antes de promover

É onde é barata: nada foi gravado ainda, então dizer "é a mesma coluna" faz o
fato entrar direto no atributo curado. Depois de promovido, o mesmo conserto
significa mover fatos de atributo — dado da Ambev, que só se toca por correção
registrada, nunca por edição de curadoria.

A promoção **não** é bloqueada por um par pendente: um arquivo que precisa
entrar não pode ficar parado esperando alguém opinar sobre nomenclatura.

### 3. A Curadoria é a segunda rede

O que passou sem decisão aparece na Curadoria como conflito pendente, com os dois
estados separados. Resolver **de lá** não move fato: grava o alias para as
próximas importações e deixa registrado que os dois códigos são a mesma coluna.
Reunir os fatos já promovidos, quando for preciso, é uma correção de importação
— outro fluxo, com outro registro.

### 4. Alias confirmado é permanente

Uma vez dito que `Seguro Mensal` é o `carreta.seguro`, a decisão fica em
`attribute_alias` e vale para sempre: nenhuma importação futura volta a
perguntar, e nenhuma delas cria `carreta.seguro_mensal`. O que precisa mudar no
pipeline para isso valer de fato:

```
// hoje: o fato vai para o código derivado do cabeçalho
const attributeCode = `${entityType.toLowerCase()}.${slug}`;

// desenhado: o alias confirmado manda; o slug é o padrão
const attributeCode = aliasConfirmado(header, sheet)?.attributeCode
  ?? `${entityType.toLowerCase()}.${slug}`;
```

A linha de alias precisa carregar **quem** decidiu e **quando** — pela mesma
razão de `CONFIRMED_SEMANTICS`: é conhecimento de domínio dado por uma pessoa, e
tem de ser atribuível. `matchConfidence` distingue o alias que a importação
gravou sozinha ao ver a coluna (`1.0000`, observação) do que uma pessoa
confirmou (a decisão).

## O que não muda

- **Cabeçalho igual continua casando sozinho.** A pergunta só existe quando o
  nome muda.
- **`source_name` continua intocado.** É por ele que a importação encontra a
  coluna.
- **Cavalo e carreta continuam separados.** `cavalo.seguro` e `carreta.seguro`
  são dois atributos por desenho — a renomeação é uma pergunta dentro de um
  mesmo equipamento, nunca entre equipamentos.

## Trecho: uma decisão pendente que não é esta

`datasetFamilyFor` (`lib/ingest/src/canonical-identity.ts`) devolve
`REMUNERACAO_EQUIPAMENTO` para todo tipo não mapeado. O padrão é inclusivo de
propósito — um DOLLY novo tem de entrar como componente da vigência que já
existe, e não abrir uma segunda identidade ativa para a mesma data.

Para `TRECHO` isso precisa ser verificado **antes** da primeira importação: se
frete por trecho é outro dataset, e não remuneração de equipamento, ele precisa
de família própria. Sem isso, um arquivo de trecho da mesma data disputa a
identidade canônica da vigência de cavalo/carreta e pode supersedê-la. A decisão
depende de ver o arquivo; a mudança, se for o caso, é uma linha em
`FAMILY_BY_ENTITY_TYPE`.
