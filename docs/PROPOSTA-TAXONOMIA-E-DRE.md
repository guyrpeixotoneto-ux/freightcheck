# Taxonomia e plano da DRE: dois eixos, e o que pertence a cada um

**A pergunta.** A planilha de atributos oferece uma lista suspensa vinda da
taxonomia (`lib/db/src/taxonomia-canonica.ts`), e as planilhas de classificação
do time usam o vocabulário do plano da DRE (`lib/dre/src/plano.ts`). Metade dos
termos de uma não existe na outra. A tentação é unificar — cadastrar na
taxonomia tudo que falta, inclusive "Receita bruta" e "Deduções".

**Isto é uma proposta de vocabulário, não de arquitetura.** A separação de
eixos que ela defende já existe no código; o que falta é a taxonomia ter nomes
para tudo que o export mede.

---

## 1. Os dois eixos já são independentes

Medido em 18/08/2026, lendo o motor:

- **Quem decide em que linha da DRE um valor cai** é `PLANO_DA_DRE`, pela lista
  `fontes[].attributeCode` de cada componente. O motor percorre essa lista
  (`lib/dre/src/motor.ts:336`) e nunca pergunta a categoria do atributo.
- **`costClass` e `taxonomyPath` viajam junto** em cada origem
  (`lib/dre/src/motor.ts:371-372`), como rastro para quem lê a apuração — não
  como critério de montagem.
- **`componenteDoAtributo(escopo, attributeCode)`** é o mapeamento, e ele é
  declarado, nunca derivado. O comentário de `apareceEm` em `plano.ts` já
  explica por quê: derivar a linha do escopo do atributo punha R$ 1,2 milhão/mês
  de cavalo dentro do número das carretas.

Ou seja: a taxonomia responde **"o que este valor representa"**, o plano
responde **"onde este valor aparece financeiramente"**, e trocar a apresentação
da DRE hoje já não obriga a mexer na taxonomia. O problema é outro — a taxonomia
não tem nome para boa parte do que o export mede, e por isso quem classifica
pega emprestado o vocabulário da DRE, que é onde os dois começam a se confundir.

---

## 2. O teste que separa

Um termo é **natureza** (taxonomia) quando dá para apontar uma coluna do export
e dizer *"esta coluna **é** um <termo>"*. Ele sobrevive a um redesenho da DRE.

Um termo é **linha, agrupador ou resultado** (plano) quando só existe como
posição numa demonstração — uma seção, um subtotal, ou a afirmação de que algo
não entra. Ele muda quando a apresentação muda, e nenhuma coluna do export "é"
ele.

Dois casos-limite resolvidos pelo teste:

- **ICMS.** "ICMS sobre a prestação" é uma linha da DRE. Mas `valorIcms` **é** um
  tributo — natureza. Vão para lados diferentes, e é isso que se quer: a
  taxonomia ganha `Tributos sobre a prestação`, o plano continua dono da seção
  `(−) Deduções`.
- **Frete líquido.** `freteLiquido` parece natureza porque é uma coluna com
  valor, mas o que ele representa é *receita bruta menos tributos* — a definição
  dele é a cascata. É resultado, e resultado é do plano.

---

## 3. Termos que são natureza — podem entrar na taxonomia

A coluna "hoje" diz onde o atributo cairia com a árvore canônica atual.

### 3.1 Já existem e servem

| Natureza | Nó atual |
|---|---|
| Combustível | `cv_combustivel` |
| Manutenção | `cv_manutencao` |
| Pneus | `cv_pneus` |
| Cadastro do ativo e do contrato | `cad_*` (4 nós) |
| Financiamento e juros · Depreciação e amortização | `cf_financiamento`, `cf_depreciacao` |

### 3.2 Faltam, e são natureza legítima

| Natureza | Hoje cairia em | Atributos que a pedem |
|---|---|---|
| **Pedágio** | Outros custos variáveis | `pedagio`, `pedagioReaisKM`, `pedagioPorEixoIdaVolta`, `freteReaisKMPedagio`, `freteReaisViagemPedagio` |
| **Lavagem e lubrificação** | Outros custos variáveis | `lavagemReaisKm`, `freteReaisKMLavagem`, `freteReaisViagemLavagem` |
| **Seguro de carga** | Seguros e tributos (que é do ativo) | `seguro`, `seguroReaiskm`, `freteReaisKMSeguro`, `freteReaisViagemSeguro` |
| **Arla** | Outros custos variáveis | nenhum ainda — o plano registra a lacuna |
| **IPVA e licenciamento** | Seguros e tributos | `ipvaLicenciamento`, `ipvaLicenciamentoMensal` |
| **Rastreamento e telemetria** | Outros custos fixos | `rastreador` |
| **Locação de equipamento** | Outros custos fixos | `custoAluguel`, `Empresa locadora` |
| **Itens obrigatórios do implemento** | Outros custos fixos | `faixaReflexiva`, `revestimento`, `tacografo` |
| **Tributos sobre a prestação** | Seguros e tributos | `icms`, `percentualIcms`, `valorIcms`, `icmsIss`, `impostosIcmsIss`, `percentualIcmsIss`, `pisCofins`, `fretePisCofins` |
| **Premissas de financiamento** | Financiamento e juros | `Spread BNDES`, `Spread Banco`, `TJLP`, `Taxa Finame (%)`, `carencia`, `percentualEntrada`, `periodoFiname` |
| **Valor de aquisição do ativo** | nenhum lugar honesto | `valorNfCompra`, `valorPisCofins` |

Duas observações sobre esta tabela. **Premissas de financiamento** são taxas e
prazos, não dinheiro — misturá-las com a parcela faz uma lista de "custos" em
que sete itens não são montante. E **valor de aquisição** é natureza (o ativo
custou isso); que ele não entre na DRE do período é afirmação do plano, não da
taxonomia.

### 3.3 Faltam, e são classes inteiras

Estas são as ausências grandes, e explicam por que o vocabulário da DRE foi
emprestado em primeiro lugar.

**Remuneração ao transportador.** A raiz da árvore se chama "Remuneração" e não
tem um único nó de receita — só classes de custo e cadastro. Todo o lado que a
Ambev paga fica sem casa: `finameCavalo`, `custoFixo`, `finame`,
`finameImplemento`, `lucroFixomodeloNovoCiclo`, `lucroFixomodeloNovoCicloCarreta`,
`freteCtrc`, `freteComCprb`, `fretePTms`. Naturezas propostas: *Remuneração
fixa*, *Lucro fixo*, *Remuneração variável*, *Frete do trecho*.

**Direcionador operacional.** Vinte e dois atributos da tabela de trecho medem
distância, tempo, ciclo, jornada, capacidade e velocidade — `kmRodado`,
`kmIda`, `kmVolta`, `tempoInternoOrigem`, `tempoInternoDestino`,
`cargaHorariaPorTrajetoMinuto`, `velocidadeMediaKmH`, `diasMes`,
`previsaoViagens`, `Capacidade`, e mais. Não são custo nem cadastro: são o
denominador que transforma R$/km em dinheiro. Hoje cairiam em *Especificação
técnica*, que os descreve mal. Naturezas propostas: *Distância*, *Tempo e
jornada*, *Ciclo e frequência*, *Capacidade*.

---

## 4. Termos que são linha, agrupador ou resultado — ficam no plano

Nenhum destes deve virar nó de taxonomia. O atributo os alcança por
`PLANO_DA_DRE[].fontes[]`, que é o mapeamento que já existe.

| Termo | O que é |
|---|---|
| Receita bruta · (−) Deduções · (−) Custos variáveis · (−) Custos fixos do veículo · (−) Depreciação e financeiro | As cinco seções (`SECOES`) |
| Receita líquida · Margem de contribuição · EBITDA · Resultado econômico | Subtotais da cascata (`SUBTOTAIS`) |
| "Subtotal e margem" | Balde criado para a planilha de trecho acomodar `freteLiquido` e o lucro variável. É puro plano |
| "Não entra na DRE" · "não entra na DRE do período" | Afirmação de colocação, não de natureza |
| Escopo conjunto · do cavalo · da carreta | Unidade de alocação — já declarada em `escopo` e `apareceEm` |
| "não confirmado — não soma" | Nem uma coisa nem outra: é `semantics_status`, e já tem lugar próprio |
| Frete "base de CPRB" · "valor no TMS" | Três leituras do mesmo dinheiro em bases diferentes. A natureza é uma (*Frete do trecho*); a base é significado, e pertence a `meaningCode` |

---

## 5. Três tensões que a separação revela

Nenhuma precisa ser resolvida agora, e todas ficam piores se a unificação for
feita antes de decidi-las.

**1. `costClass` é meio-apresentação, e mora na taxonomia.** Um nó declara
`FIXO` ou `VARIAVEL` e os descendentes herdam. Mas o próprio código já admite
que a classe não se lê na natureza — o comentário de `PAI_DE_CATEGORIA_NOVA`
diz que "pedágio é custo variável numa operação e repasse contratual em outra".
E há um caso medido: *Pessoal e encargos* é custo fixo do cavalo e custo
variável do trecho. Com a classe na taxonomia, a mesma natureza precisa de dois
nós — que é exatamente a duplicação que a separação de eixos deveria evitar.

**2. "Lucro variável" está sob Custo Variável.** Não é custo, é margem. É
sintoma da ausência do lado de receita: sem classe de remuneração, a margem foi
parar na classe de custo mais próxima.

**3. A taxonomia não sabe dizer "isto é uma razão".** `manutencaoReaisKm`,
`reaiskm`, `lavagemReaisKm` e a família de R$/km são natureza *Manutenção* e
*Lavagem*, e mesmo assim não somam sem quilometragem. Isso hoje é dito em
`agregacao.ts`, não na categoria — o que está certo, e vale registrar para que
ninguém tente resolver na taxonomia.

---

## 6. O que fazer, em que ordem

1. **Decidir a tensão 1** — se `costClass` continua na taxonomia ou migra para o
   plano. É a única decisão que muda o desenho da árvore, e fazê-la depois de
   cadastrar trinta nós custa trinta migrações.
2. **Cadastrar as naturezas de 3.2** — onze nós, nenhum deles polêmico, todos
   com atributos esperando.
3. **Abrir as duas classes de 3.3** — remuneração e direcionador operacional.
   São as que destravam a maior parte do vocabulário emprestado.
4. **Não cadastrar nada de 4.** Se um dia alguém quiser "Receita bruta" na lista
   suspensa, o que falta não é um nó: é a planilha mostrar, ao lado da
   categoria, a linha da DRE que o atributo alimenta — que o plano já sabe
   responder por `componenteDoAtributo`.

O passo 4 é o que mantém a promessa: mudar a DRE não redesenha a taxonomia,
porque a DRE nunca esteve dentro dela.
