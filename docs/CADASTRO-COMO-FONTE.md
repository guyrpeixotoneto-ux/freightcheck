# O `Cadastro` como sétima fonte — desenho

**Estado: a porta está ligada.** `lerResumoDoMes` recebe hoje uma
`FonteDeCadastro` de verdade — `cadastroDaRemuneracao`, em
`artifacts/api-server/src/lib/`, que lê a aba digitada em `remuneracao_planilha`
e a traduz pelo `contrato.ts` de `@workspace/remuneracao`. Com uma aba
cadastrada, o painel do fechamento passa a mostrar **devido × demonstrado ×
diferença**; sem ela, cai no de-para do 03.08.20 como antes.

O que **ainda** falta deste desenho é o cadastro virar **documento importável e
versionado** — com `vigenteAte`, correção retroativa com motivo escrito e o
cadastro fixado na apuração (os três mecanismos do fim deste documento). Hoje a
vigência é a `effective_date` da aba, e a resolução é a descrita em *A herança
entre as duas quinzenas do mesmo mês*, abaixo.

## Por que ele é fonte, e não configuração

As seis fontes atuais são relatórios: alguém exporta do Promax e sobe. O
cadastro não é isso — é o **contrato**, e nenhum relatório o traz. Sem ele,
57,8 % do dinheiro do mês não pode ser reconstruído (ver `MAPA-ROTA.md`).

Tratá-lo como configuração de tela seria repetir o erro da planilha: um valor
que alguém edita, sem data e sem rastro, e que muda o resultado de um mês já
discutido. Tratá-lo como fonte dá a ele o que as outras seis já têm — arquivo
de origem, competência, quem subiu, quando, e a possibilidade de conferir o
número contra o documento.

## Campos necessários

Os dezoito parâmetros que o motor consome, agrupados pela natureza que têm no
contrato. Todos os valores monetários são **mensais e sem imposto** — é assim
que o contrato os escreve, e a divisão por dois mora no motor.

### Alíquotas — o estado e o município

| Campo | Aba `Cadastro` | Tipo |
|---|---|---|
| `pis` | `Alíquota PIS no Estado` | fração (0,0065) |
| `cofins` | `Alíquota COFINS no Estado` | fração |
| `icms` | `Alíquota ICMS no Estado` | fração |
| `iss` | `Alíquota ISS no Município` | fração |

### Frota contratada

| Campo | Aba `Cadastro` | Tipo |
|---|---|---|
| `frotaFixaAtiva` | `Total Frota Fixa Ativos` | inteiro |
| `frotaFixaInativa` | `Total Frota Fixa Inativos` | inteiro |
| `vansAtivas` | `Quantidade de Vans Ativas` | inteiro |
| `vansInativas` | `Quantidade de Vans Inativas` | inteiro |
| `rotasNoturnas` | `Quantidade de Rotas Noturnas` | inteiro |

### Tarifa por veículo, por mês, sem imposto

| Campo | Aba `Cadastro` |
|---|---|
| `remuneracaoFixaDaFrotaAtiva` | `Remuneração Fixa - Frota Fixa Ativa` |
| `remuneracaoDaEquipeDeEntrega` | `Remuneração Fixa - Equipe Entrega` |
| `remuneracaoDoQlpAdministrativo` | `Remuneração Fixa - QLP Adm.` |
| `remuneracaoDeOutrasDespesas` | `Remuneração - Outras Despesas` |
| `remuneracaoDaFrotaInativa` | `Remuneração Fixa - Frota Fixa Inativa` |
| `custoFixoDaVan` | `Custo Fixo` (bloco VANS) |
| `custoDaEquipeDeEntregaDaVan` | `Custo Equipe Entrega` (bloco VANS) |
| `remuneracaoDasVansInativas` | `Remuneração Vans - Frota Vans Inativas` |
| `custoDaNoturnaSemImposto` | `Custo Fixo sem impostos - Noturna` |
| `custoDeMarketingSemImposto` | `Custo Fixo sem impostos - Marketing` |
| `custoVariavelPrevistoPor25Viagens` | `Custo Variável (para 25 viagens previstas)` **+** `Lucro Operacional Variável (previsto)` |

### O campo de natureza diferente — e por que ele precisa de decisão

| Campo | Aba `Cadastro` |
|---|---|
| `parcelaDentroDoMunicipio` | `% de viagens dentro do Município - ISS` |

**Este não é um termo de contrato: é uma medição.** Ele descreve que fatia dos
documentos do período saiu como `NF-ISS`, e o diário operacional o calcula
sozinho (`Mapa Rota!118`/`119`). A planilha o traz digitado no cadastro **e**
calculado do diário, e é exatamente dessa duplicidade que nascem os R$ 128,05
da 2ª quinzena (ver `MAPA-ROTA.md`).

A regra canônica já decidiu que a **autoridade é o cadastro**. O desenho
propõe registrar, junto do valor declarado, a medição do período que o
justifica — não para recalcular com ela, mas para que a divergência entre
declarado e medido seja visível na tela em vez de ficar enterrada numa fórmula.
Um cadastro cujo declarado se afasta do medido é um sinal, não um erro.

## Chave e identidade

```
(unidadeCodigo, transportadoraCodigo, canal, vigenteDe)
```

- **`unidadeCodigo` + `transportadoraCodigo`** — o mesmo par que identifica a
  competência. Dois CDDs da mesma transportadora têm contratos diferentes.
- **`canal`** — `ROTA` hoje; `AS` quando o painel dele for transcrito. A frota
  contratada é por canal, e um cadastro sem canal obrigaria a duplicar a linha
  no dia em que o AS entrar.
- **`vigenteDe`** — a data em que o contrato passou a valer. É parte da chave
  porque duas vigências do mesmo trio são dois cadastros, não uma edição.

`id` continua sendo `uuid`, e a chave acima vira índice único.

**O que a identidade não inclui:** ano, mês e quinzena. Amarrar o cadastro à
competência obrigaria a redigitar dezoito parâmetros a cada quinzena para dizer
que nada mudou — e é assim que se erra um deles.

## Vigência

```
vigenteDe   date  NOT NULL   -- inclusivo
vigenteAte  date             -- inclusivo; NULL = vigência aberta
```

Uma competência resolve o seu cadastro assim:

```
vigenteDe <= competencia.inicio  E  (vigenteAte IS NULL OU vigenteAte >= competencia.fim)
```

Três regras que o desenho exige, e as razões:

1. **A vigência tem de cobrir a quinzena inteira.** Um cadastro que começa no
   dia 8 não serve para a 1ª quinzena: o período teria dois contratos e um
   número só. O caso é **recusado com o motivo**, não resolvido por média nem
   por rateio — ratear seria inventar um contrato que ninguém assinou. Se o
   contrato mudou no meio da quinzena, quem responde por ele decide qual vale,
   e registra isso como vigência.

2. **Vigências do mesmo trio não podem se sobrepor.** Duas linhas cobrindo o
   mesmo dia dariam dois custos fixos para a mesma competência, e a escolha
   entre elas seria arbitrária. Restrição de exclusão no banco, verificada na
   escrita.

3. **Buracos são permitidos e visíveis.** Um período sem cadastro é um estado
   legítimo (ninguém subiu ainda) e precisa aparecer como tal — ver abaixo.

Os dados de julho/2026 mostram que **os parâmetros mudam de quinzena para
quinzena** (`remuneracaoFixaDaFrotaAtiva` foi de 1.424,91 para 1.038,03). Na
prática, portanto, a vigência típica é quinzenal — mas o modelo não a força, e é
isso que permite que um contrato estável de seis meses seja uma linha só.

## Como cada parâmetro alimenta cada linha

| Linha do `RESUMO GERAL` | Parâmetros que a produzem | Regra |
|---|---|---|
| `CUSTO FIXO PADRONIZADO` | `remuneracaoFixaDaFrotaAtiva` + `remuneracaoDaEquipeDeEntrega` + `remuneracaoDoQlpAdministrativo` + `remuneracaoDeOutrasDespesas`, `frotaFixaAtiva`, as 4 alíquotas, `parcelaDentroDoMunicipio` | `(soma ÷ 2) × frota × fator` |
| `CUSTO FIXO INATIVOS` | `remuneracaoDaFrotaInativa`, `frotaFixaInativa`, alíquotas, `parcelaDentroDoMunicipio` | `(tarifa ÷ 2) × frota × fator` |
| `CUSTO VANS INATIVAS` | `remuneracaoDasVansInativas`, `vansInativas`, alíquotas, `parcelaDentroDoMunicipio` | `(tarifa ÷ 2) × vans × fator` |
| `CUSTO FIXO - VANS` | `custoFixoDaVan` + `custoDaEquipeDeEntregaDaVan`, `vansAtivas`, alíquotas, `parcelaDentroDoMunicipio` | `(soma × vans × fator) ÷ 2` |
| `CUSTO FIXO - ESPECIAIS` | `custoDaNoturnaSemImposto`, `rotasNoturnas`, `custoDeMarketingSemImposto`, alíquotas, `parcelaDentroDoMunicipio` | `(noturna × fator ÷ 2) × rotas + (marketing × fator ÷ 2)` |
| `DESCONTO DE DEVOLUÇÃO %` | alíquotas, `parcelaDentroDoMunicipio` (só o fator) | `−base × fator` |
| `DESCONTO DE DISPONIBILIDADE` | idem | `−base × fator` |
| `DESCONTO COMPLEMENTAR NEGATIVO` | nenhum | `−base`, sem fator |
| `CUSTO VARIÁVEL (FROTA FIXA)` | `custoVariavelPrevistoPor25Viagens`, alíquotas | `(previsto ÷ 25) ÷ divisor` pelo split do dia × mapas |
| `CUSTO VARIÁVEL (AGREGADO)` | nenhum | soma do faturado das viagens `Spot` |
| `TOTAL REMUNERAÇÃO ROTA DVS` | `custoVariavelPrevistoPor25Viagens`, alíquotas | soma das quatro parcelas variáveis |

As alíquotas e a `parcelaDentroDoMunicipio` entram em **quase toda** linha, pelo
fator. Trocar uma alíquota muda o mês inteiro — o que é mais uma razão para a
mudança ter data e autor.

## Quando faltar cadastro para uma vigência

O princípio é o mesmo do resto do pacote: **a conta roda com o que houver, e
diz o que não havia.** Nunca zero por ausência.

| Situação | Comportamento |
|---|---|
| Nenhum cadastro cobre a quinzena | As cinco linhas de custo fixo saem `null`; `CUSTO VARIÁVEL (FROTA FIXA)` e o `DVS` saem `null` (dependem do previsto e das alíquotas); os descontos saem `null` (dependem do fator). `AGREGADO` e `OUTROS CUSTOS` continuam preenchidos. |
| Total do quadro | `null`, não a soma do que existe — ver `somarQuadro` em `mapa-rota.ts`. |
| Tela | Uma pendência nomeada: *"a 2ª quinzena não tem cadastro vigente; sem ele o custo fixo não pode ser reconstruído"*, com o caminho para subir. |
| Vigência que cobre só parte da quinzena | **Recusa explícita**, com as duas datas e o motivo. Não escolhe, não rateia. |
| Cadastro presente mas com campo faltando | Não há contrato: `contratoDaPlanilha` devolve `contrato: null` e a lista das chaves que faltam, com o rótulo que a tela mostra. As linhas que dependem dele saem vazias — nunca com zero no lugar do que ninguém digitou. |

## A herança entre as duas quinzenas do mesmo mês

O desenho original não herdava nada, e a razão continua valendo para o caso que
ele tinha em mente: herdar o cadastro do **mês anterior** reproduziria um
contrato vencido com cara de vigente, e o número sairia plausível.

Entre as duas metades do **mesmo mês** a decisão passou a ser outra, a pedido de
quem opera. O contrato é mensal; a quinzena é uma régua de calendário. Exigir a
mesma aba digitada duas vezes por mês não protegia de nada — produzia duas
cópias do mesmo contrato, e uma tela vazia enquanto a segunda não chegasse.

A regra está em `vigenciaQueResponde` (`@workspace/remuneracao/contrato.ts`):

1. A aba da própria quinzena, se houver — a mais recente, se houver duas.
2. A da **outra quinzena do mesmo mês**, se houver.
3. Nada: `null`, e a tela diz que falta cadastro.

**Não atravessa o mês**, e não existe meia herança: a aba é um ato só
(`gravarPlanilha` grava as trinta linhas numa transação), e completar as que
faltam numa com as da outra montaria um contrato que ninguém assinou.

**O risco é real, e está dito na tela.** Julho/2026 é o contraexemplo do próprio
produto: `remuneracaoFixaDaFrotaAtiva` foi de R$ 1.424,91 na 1ª quinzena para
R$ 1.038,03 na 2ª, e `remuneracaoDaFrotaInativa` de R$ 1.650,97 para R$ 4.359,09.
Quem cadastrar só a 1ª e deixar a herança responder pela 2ª verá um devido
errado — plausível, que é o pior tipo. Por isso a herança nunca é silenciosa: o
painel escreve `cadastro vigente desde <data>` e, quando uma aba responde pelas
duas, diz que responde. Cadastrar a segunda aba desliga a herança sozinha.

## Como impedir que um cadastro futuro recalcule o passado

Três mecanismos, e os três são necessários. Os dois primeiros protegem a
resolução; o terceiro protege o que já foi apurado.

### 1. A vigência filtra pelo período, não pelo relógio

A resolução compara `vigenteDe` com `competencia.inicio`. Um cadastro com
vigência a partir de agosto simplesmente não é candidato para julho, por mais
recente que seja o cadastro.

### 2. `registradoEm` é separado de `vigenteDe`

```
vigenteDe     date        -- quando o contrato passou a valer  (negócio)
registradoEm  timestamptz -- quando alguém subiu isto          (auditoria)
```

Um cadastro registrado hoje com `vigenteDe` no passado é uma **correção
retroativa** — legítima, e que precisa ser reconhecível como tal. Ela exige
motivo escrito, do mesmo jeito que reabrir uma competência já exige
(`motivoDaReabertura`), e aparece na trilha.

### 3. A apuração fixa o cadastro que usou

Este é o mecanismo forte. Hoje a apuração já é **gravada e não recalculada a
cada leitura** — `lerResumoDoMes` lê a apuração vigente como ela foi gravada, e
o comentário em `persistencia.ts` explica por quê. O cadastro entra na mesma
disciplina:

```
fechamento_apuracao.cadastro_id  uuid  -- o cadastro que produziu estes números
```

Com isso:

- Reler um fechamento apurado devolve os números **daquele** cadastro, mesmo que
  uma correção retroativa tenha entrado depois.
- Uma correção retroativa **não** muda um fechamento apurado em silêncio: ela
  fica disponível, e a tela mostra *"há um cadastro mais novo vigente para este
  período; a apuração usou o de 12/06"* com a opção de reapurar.
- Reapurar é um ato, com autor e data — não um efeito colateral de subir um
  arquivo.

É a mesma forma do modo `PLANILHA_LEGADA` × `REGRA_CANONICA`: o sistema guarda
o que foi, calcula o que deveria ser, e mostra a diferença — sem corrigir o
histórico por conta própria.

## O que este desenho deixa em aberto

1. **`parcelaDentroDoMunicipio` é medição vestida de parâmetro.** A regra
   canônica dá autoridade ao cadastro, e o desenho propõe registrar a medição ao
   lado. Se o negócio decidir que a autoridade deveria ser o diário, muda a
   regra canônica — e a comparação Legado × Canônica já existe para medir o
   efeito antes.
2. **O canal `AS`** entra na chave, mas o painel dele não está transcrito. O
   cadastro pode ser importado antes do painel existir.
3. **A aba `Cadastro` vem dentro da mesma `.xlsb` do fechamento**, junto de 43
   outras abas. O leitor já isola a aba; falta decidir se o upload aceita a
   pasta inteira ou exige um recorte.


---

## A porta, e como plugar o módulo

O fechamento já está ligado ao motor e espera o cadastro por uma interface. O
módulo não precisa saber nada do fechamento: precisa responder uma pergunta.

```ts
// lib/fechamento/src/cadastro-porta.ts
export interface FonteDeCadastro {
  resolver(pergunta: {
    unidadeCodigo: string;
    transportadoraCodigo: string;
    canal: Canal;
    inicio: string;  // primeiro dia da quinzena, YYYY-MM-DD
    fim: string;     // último dia da quinzena
  }): Promise<RespostaDoCadastro | null>;
}
```

A resposta traz os parâmetros, o `custoVariavelPrevistoPor25Viagens`, o
`cadastroId` (para a apuração fixá-lo) e o `vigenteDe` (para a tela dizer qual
contrato produziu o número).

**A pergunta é sobre um período, nunca sobre "agora".** É a assinatura que
impede um cadastro futuro de recalcular o passado — o mecanismo 1 acima está
embutido no contrato da porta, e não na disciplina de quem chama.

### Como ligar

```ts
lerResumoDoMes(db, alvo, minhaFonteDeCadastro)
```

O terceiro parâmetro tem padrão `SEM_CADASTRO`, que responde `null` a tudo.
**Enquanto o módulo não passar por ali, o produto se comporta exatamente como
antes** — o painel do devido não aparece e a tela mostra o de-para do 03.08.20
como sempre mostrou. Nada quebra e nada muda até o primeiro cadastro existir.

Para desenvolver e testar sem banco, `cadastroEmMemoria([...])` implementa a
mesma resolução de vigência: ela precisa cobrir a quinzena inteira, e a mais
recente que cobre vence.

### O que o fechamento faz com a resposta

1. Lê as viagens da competência de `fechamento_viagem`, agrupadas por dia.
2. Chama `montarMapaDaQuinzena` com os parâmetros, as viagens e as bases.
3. Casa o resultado com o painel do 03.08.20 em `compararPaineis`.
4. A tela mostra **devido × demonstrado × diferença**, com a memória de cálculo
   de cada linha e o `vigenteDe` do cadastro usado.

### Duas contraprovas que valem a pena existir no módulo

Uma tarifa digitada errada produz um número **plausível** — não quebra nada e
vira remuneração. Vigência e autoria dão rastro, não validam valor. Duas
verificações que o sistema pode fazer sozinho:

1. **Fatia de emissão declarada × medida.** O cadastro declara a fatia de
   documentos dentro do município; o diário a calcula. Divergência grande é
   sinal, não erro — foi exatamente essa divergência que produziu os R$ 128,05
   da planilha.
2. **Custo fixo calculado × 03.08.20.** Quando o demonstrativo chega, ele vira o
   **conferente** do cadastro — a inversão exata do que o de-para antigo fazia.
   Duas fontes independentes chegando ao mesmo número é a única prova real de
   que o cadastro está certo.

### O que ainda não tem origem, e por isso sai vazio

`basesDaQuinzena` (em `persistencia.ts`) monta hoje só o que um documento
sustenta:

| Base | Origem | Estado |
|---|---|---|
| Devolução | descontos do 03.08.20, tipo `DEVOLUCAO` | ✅ |
| Disponibilidade | descontos do 03.08.20, tipos `DISPONIBILIDADE_*` | ✅ |
| Complementar negativo | descontos do 03.08.20, tipo `FRETE_MINIMO` | ✅ |
| Outros custos | 03.08.12.09 | ❌ `null` (esta leitura não abre o relatório) |
| Indisponibilidade | diário | ❌ `null` |

As duas últimas saem `null`, o quadro sai `null`, e a tela nomeia o que falta.
**Nenhuma é preenchida com zero** — e nenhuma repete o número digitado da
planilha, cuja derivação ninguém sabe explicar (ver `MAPA-ROTA.md`).
