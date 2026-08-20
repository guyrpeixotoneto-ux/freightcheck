# O `Cadastro` como sétima fonte — desenho

**Estado: desenho, não implementado.** Este documento é o que precisa ser
acordado antes de escrever código. A leitura da aba já existe
(`lib/fechamento/src/leitores/cadastro.ts`) e reconstrói o custo fixo ao
centavo; o que falta é o cadastro virar **documento importável e versionado**,
ao lado das seis fontes que a Ambev entrega.

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
| Cadastro presente mas com campo faltando | `RotuloDoCadastroNaoEncontrado`, que já existe, nomeando o rótulo e a quinzena. |

O que o desenho **não** faz: herdar o cadastro da quinzena anterior. Seria a
suposição mais confortável e a mais perigosa — reproduziria um contrato vencido
com cara de vigente, e o número sairia plausível.

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
