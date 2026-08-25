/**
 * O CADASTRO DA PLANILHA DE REMUNERAÇÃO — a aba que abre a pasta de Excel.
 *
 * Antes de qualquer quinzena ser apurada, alguém preenche uma aba com os
 * parâmetros da unidade: as quatro alíquotas, o tamanho da frota, quanto vale
 * cada parcela por veículo, quantas vans, quantas rotas noturnas, e as duas
 * proporções que decidem se o documento sai como ISS ou como CT-e. É dela que
 * todas as outras abas puxam. Este arquivo é essa aba escrita como catálogo.
 *
 * **Por que um catálogo em código, e não uma tabela editável.** Pela mesma
 * razão de `@workspace/fechamento/verbas`: a forma da aba é o contrato entre a
 * Ambev e a transportadora, não uma preferência do usuário. Um catálogo
 * versionado é revisável em diff e testável; uma tabela editável seria mais um
 * lugar onde um erro de digitação vira dinheiro errado sem deixar rastro.
 *
 * **A regra que rege o módulo inteiro: nenhuma linha inventa a sua origem.**
 * Cada linha declara, em {@link LinhaDoCadastro.origem}, de onde o número sai
 * no acervo da Auditoria — e as que não têm origem declarada dizem por extenso
 * o que falta, nomeando a coluna do export que as destravaria. Uma linha
 * preenchida com o número certo sob o rótulo errado é pior do que uma linha
 * vazia: a vazia se resolve, a errada se acredita.
 *
 * A legenda da própria planilha vira {@link Preenchimento}: azul é o que
 * alguém digita, cinza é o que a planilha calcula sozinha. Ela importa aqui
 * porque diz o que este módulo pode aspirar a substituir — o cinza é conta, e
 * conta nós refazemos; o azul é decisão, e decisão continua sendo de quem
 * assina.
 */

/** O que a linha mede — e, por consequência, como a tela a escreve. */
export type Medida = "DINHEIRO" | "PERCENTUAL" | "QUANTIDADE";

/**
 * A legenda da planilha: azul se preenche, cinza se calcula.
 *
 * `INFORMADO` é o que a aba pede a uma pessoa; `AUTOMATICO` é o que ela mesma
 * deriva de outras células.
 */
export type Preenchimento = "INFORMADO" | "AUTOMATICO";

/**
 * De onde o número sai no acervo da Auditoria.
 *
 * Cada variante corresponde a uma leitura que este módulo sabe fazer sobre o
 * modelo canônico — e `SEM_ORIGEM` é a variante honesta para o que ele ainda
 * não sabe fazer, com o motivo e a destrava escritos.
 */
export type Origem =
  /** Conta os cavalos da vigência pela coluna `ativo`. */
  | { tipo: "CONTAGEM_DE_FROTA"; recorte: "ATIVOS" | "INATIVOS" | "OPERACAO" }
  /** A alíquota que os trechos da vigência declaram para aquele tributo. */
  | { tipo: "ALIQUOTA_DECLARADA"; tributo: "ICMS" | "ISS" }
  /** PIS e COFINS: o export os soma numa coluna só, e a medição é conjunta. */
  | { tipo: "ALIQUOTA_CONJUNTA_PIS_COFINS"; parte: "PIS" | "COFINS" }
  /** A fatia dos documentos previstos que sai por dentro ou por fora do município. */
  | { tipo: "PROPORCAO_DE_DOCUMENTOS"; dentroDoMunicipio: boolean }
  /** `100% − (PIS + COFINS + tributo)`: o divisor do gross-up. */
  | { tipo: "RESUMO_DE_IMPOSTOS"; tributo: "ICMS" | "ISS" }
  /** A soma de outras linhas deste mesmo cadastro. */
  | { tipo: "SOMA_DE_LINHAS"; parcelas: string[] }
  /** Nada no acervo sustenta esta linha — e aqui está o porquê. */
  | {
      tipo: "SEM_ORIGEM";
      /** Por que a Auditoria não responde esta linha hoje. */
      motivo: string;
      /** O que a destravaria — sempre um dado, nunca um prazo. */
      destrava: string;
      /** Onde olhar hoje, quando existe uma tela que chega perto. */
      hoje?: { href: string; label: string; porque: string };
    };

export interface LinhaDoCadastro {
  /** A chave estável — o que a API e os testes usam. Nunca muda de sentido. */
  chave: string;
  /** O rótulo **como a planilha o escreve**, acento por acento. */
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  origem: Origem;
}

export interface BlocoDoCadastro {
  /** O título da faixa azul-marinho, em caixa alta, como na planilha. */
  titulo: string;
  /** O que o bloco responde, numa frase — a tela usa como subtítulo. */
  resumo: string;
  linhas: LinhaDoCadastro[];
}

/*
 * As três ausências que se repetem, escritas uma vez.
 *
 * Elas voltam em oito linhas do cadastro, e repetir o texto em oito lugares é
 * garantir que um dia oito textos digam coisas ligeiramente diferentes sobre a
 * mesma lacuna. O que muda entre uma linha e outra é o rótulo, não o motivo.
 */

/** O export de equipamento não distingue van de cavalo. */
const SEM_VAN = (o_que: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `${o_que} exige separar vans do restante da frota, e o export de equipamento não faz ` +
    "essa separação: cavalo e van chegam no mesmo tipo de entidade (`CAVALO`), sem coluna " +
    "que diga qual é qual. Contar tudo como van — ou nada — seria inventar o recorte.",
  destrava:
    "Uma coluna de categoria de veículo no export do Freightech, ou a confirmação de qual " +
    "valor de `modeloEmpurrada`/`Padrão` identifica van, registrada na curadoria.",
  hoje: {
    href: "/frota-360",
    label: "Frota 360°",
    porque: "A frota inteira da vigência, veículo a veículo, com o que cada um recebe.",
  },
});

/** A parcela existe na planilha e nenhuma coluna do export a nomeia. */
const SEM_COLUNA = (o_que: string, destrava: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `Nenhuma coluna dos exports do Freightech — equipamento, equipe, frete ou QLP — ` +
    `nomeia ${o_que}. O acervo da Auditoria não tem como responder esta linha sem que ` +
    "alguém decida, fora do dado, que outra coluna serve no lugar dela.",
  destrava,
});

/**
 * A composição do veículo responde o total, não a parcela com **este** nome.
 *
 * É a ausência mais delicada do cadastro, e a que mais convida ao erro: a
 * Composição já apura, cavalo a cavalo, tudo o que a Ambev paga por ele — e é
 * tentador dividir esse total pelas seis linhas da planilha por semelhança de
 * nome. Não é o que este módulo faz. `finameCavalo` e
 * `lucroFixomodeloNovoCicloCavalo` são colunas confirmadas do export; "Frota
 * Fixa Ativa" e "Outras Despesas" são rubricas da planilha; a correspondência
 * entre as duas listas é uma decisão de negócio que ninguém registrou, e
 * deduzi-la de nome de coluna é exatamente a regra que este repositório recusa.
 */
const SEM_RUBRICA = (rubrica: string, candidatas: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `A Composição apura o total mensal de cada cavalo a partir das colunas confirmadas do ` +
    `export, mas nenhuma delas se chama "${rubrica}". Qual conjunto de colunas forma esta ` +
    "rubrica da planilha é decisão de negócio, e deduzi-la por semelhança de nome daria um " +
    "número plausível e sem lastro.",
  destrava:
    `O enquadramento das colunas nesta rubrica, registrado na curadoria. Candidatas no ` +
    `export: ${candidatas}.`,
  hoje: {
    href: "/composicao",
    label: "Composição",
    porque:
      "O valor mensal montado de cada equipamento na vigência, componente a componente, " +
      "com a célula de origem de cada parcela.",
  },
});

/**
 * As categorias do Promax sem contrapartida confirmada no contrato.
 *
 * Refrigeração, Especial e Recarga aparecem na tela de frota do Promax (ver
 * `@workspace/fechamento/frota-promax-categorias`) e nenhuma delas corresponde
 * a uma célula confirmada da aba `Cadastro` real, nem a uma fórmula do
 * `RESUMO GERAL` que a some ao devido — ao contrário de Marketing, cuja
 * célula e fórmula (`CUSTO FIXO - ESPECIAIS`) estão confirmadas. Registrar o
 * número aqui é cadastro puro, para que exista registro; `contrato.ts` não lê
 * estas três chaves, e inventar a fórmula que as levaria ao devido seria
 * exatamente o erro que este catálogo recusa.
 */
const SEM_FORMULA_PROMAX = (categoria: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `"${categoria}" é uma categoria da tela de frota do Promax, sem célula ` +
    "confirmada na aba `Cadastro` real e sem fórmula do `RESUMO GERAL` que a " +
    "some ao devido. O valor fica registrado no cadastro — não entra em " +
    "nenhuma conta.",
  destrava:
    `A confirmação, na curadoria, de qual célula da planilha real (se ` +
    `houver) corresponde a "${categoria}", e a fórmula do RESUMO GERAL que a ` +
    "soma ao devido.",
  hoje: {
    href: "/frota-360",
    label: "Frota 360°",
    porque: "A frota da vigência por categoria do Promax, como a tela a mostra hoje.",
  },
});

/**
 * O cadastro, bloco a bloco, na ordem em que a aba os apresenta.
 *
 * A ordem é a da planilha e não a da facilidade: quem confere abre as duas
 * lado a lado, e uma tela que reordenasse os blocos obrigaria a procurar. O
 * mesmo vale para os rótulos, que são os literais da aba — inclusive
 * "SRTRANS FIXO" e "(PADRÃO)", que só significam alguma coisa para quem já
 * usa a planilha, e que por isso mesmo não podem ser "melhorados" aqui.
 *
 * **Os três últimos blocos são a exceção deliberada.** Refrigeração, Especial
 * e Recarga não vêm da aba `Cadastro` — vêm da tela de frota do Promax, e por
 * isso ficam depois dos que a planilha define, na ordem em que a decisão de
 * incluí-los foi tomada, e não intercalados como se fossem parte dela.
 */
export const BLOCOS_DO_CADASTRO: BlocoDoCadastro[] = [
  {
    titulo: "ALÍQUOTAS",
    resumo:
      "Os quatro tributos que convertem valor líquido em valor faturado, e o tamanho da " +
      "frota fixa sobre a qual tudo o mais é calculado.",
    linhas: [
      {
        chave: "aliquota_pis",
        rotulo: "Alíquota PIS no Estado",
        medida: "PERCENTUAL",
        preenchimento: "INFORMADO",
        origem: { tipo: "ALIQUOTA_CONJUNTA_PIS_COFINS", parte: "PIS" },
      },
      {
        chave: "aliquota_cofins",
        rotulo: "Alíquota COFINS no Estado",
        medida: "PERCENTUAL",
        preenchimento: "INFORMADO",
        origem: { tipo: "ALIQUOTA_CONJUNTA_PIS_COFINS", parte: "COFINS" },
      },
      {
        chave: "aliquota_icms",
        rotulo: "Alíquota ICMS no Estado",
        medida: "PERCENTUAL",
        preenchimento: "INFORMADO",
        origem: { tipo: "ALIQUOTA_DECLARADA", tributo: "ICMS" },
      },
      {
        chave: "aliquota_iss",
        rotulo: "Alíquota ISS no Município",
        medida: "PERCENTUAL",
        preenchimento: "INFORMADO",
        origem: { tipo: "ALIQUOTA_DECLARADA", tributo: "ISS" },
      },
      {
        chave: "frota_fixa_ativos",
        rotulo: "Total Frota Fixa Ativos",
        medida: "QUANTIDADE",
        preenchimento: "INFORMADO",
        origem: { tipo: "CONTAGEM_DE_FROTA", recorte: "ATIVOS" },
      },
      {
        chave: "frota_fixa_inativos",
        rotulo: "Total Frota Fixa Inativos",
        medida: "QUANTIDADE",
        preenchimento: "INFORMADO",
        origem: { tipo: "CONTAGEM_DE_FROTA", recorte: "INATIVOS" },
      },
      {
        chave: "frota_fixa_operacao",
        rotulo: "Total Frota Fixa Operação",
        medida: "QUANTIDADE",
        preenchimento: "AUTOMATICO",
        origem: { tipo: "CONTAGEM_DE_FROTA", recorte: "OPERACAO" },
      },
    ],
  },
  {
    titulo: "VEÍCULOS ATIVOS",
    resumo:
      "Quanto vale, por mês e por veículo ativo, cada parcela da remuneração da frota fixa. " +
      "O total é a soma das seis linhas, sem imposto.",
    linhas: [
      {
        chave: "ativo_remuneracao_fixa_frota",
        rotulo: "Remuneração Fixa - Frota Fixa Ativa",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_RUBRICA(
          "Remuneração Fixa - Frota Fixa Ativa",
          "`finameCavalo`, `lucroFixomodeloNovoCicloCavalo`, `custoAluguel`, `ipvaLicenciamento`",
        ),
      },
      {
        chave: "ativo_remuneracao_fixa_equipe",
        rotulo: "Remuneração Fixa - Equipe Entrega",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_RUBRICA(
          "Remuneração Fixa - Equipe Entrega",
          "no export de equipe, `totalRemuneracao`, `totalDaRemuneracao` e `remuneracaoFixa`, " +
            "com `quantidadePorCaminhao` como fator por veículo",
        ),
      },
      {
        chave: "ativo_custo_variavel",
        rotulo: "Custo Variável (para 25 viagens previstas)",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: {
          tipo: "SEM_ORIGEM",
          motivo:
            "A parcela é frete de trecho multiplicado por viagens previstas, e a remuneração " +
            "do trecho é **por viagem** — uma periodicidade que o motor de composição ainda " +
            "não tem gaveta para somar (ver `lib/composition/src/regras.ts`). Somá-la a " +
            "valores mensais antes disso repetiria o erro que separou mensal de anual.",
          destrava:
            "A gaveta de periodicidade por viagem no motor, e as colunas de trecho " +
            "(`freteLiquido`, `previsaoViagens`) importadas e confirmadas na curadoria.",
          hoje: {
            href: "/dre",
            label: "DRE",
            porque: "O custo variável apurado por unidade econômica, com a cobertura medida.",
          },
        },
      },
      {
        chave: "ativo_remuneracao_fixa_qlp",
        rotulo: "Remuneração Fixa - QLP Adm.",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: {
          tipo: "SEM_ORIGEM",
          motivo:
            "O QLP Administrativo é remunerado por unidade, não por veículo: o export traz " +
            "despesa por cargo (`Despesa Ordenados`, `Despesa Encargos`, `Despesa Benefício`…), " +
            "e a planilha traz o rateio já feito por veículo ativo. O divisor do rateio não " +
            "vem em nenhuma coluna.",
          destrava:
            "A regra de rateio do QLP por veículo, registrada em produto — e a confirmação " +
            "de que ela divide pela frota ativa, e não pela frota em operação.",
          hoje: {
            href: "/qlp-administrativo",
            label: "QLP Administrativo",
            porque:
              "O quadro administrativo da vigência, cargo a cargo, com a despesa de cada um.",
          },
        },
      },
      {
        chave: "ativo_outras_despesas",
        rotulo: "Remuneração - Outras Despesas",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_RUBRICA(
          "Remuneração - Outras Despesas",
          "o que sobra da composição do cavalo depois das rubricas nomeadas — e é justamente " +
            "por ser um resto que ela não pode ser deduzida antes das outras",
        ),
      },
      {
        chave: "ativo_lucro_operacional",
        rotulo: "Lucro Operacional Variável (previsto)",
        medida: "DINHEIRO",
        preenchimento: "AUTOMATICO",
        origem: {
          tipo: "SEM_ORIGEM",
          motivo:
            "`lucroVariavelPrevistoCavalo` existe no export e está classificado como receita " +
            "bruta **não confirmada**, fora de qualquer total (ver o dicionário do cavalo). " +
            "Um número que o produto recusa somar na DRE não pode entrar somado aqui.",
          destrava:
            "A confirmação da semântica de `lucroVariavelPrevistoCavalo` na curadoria — " +
            "periodicidade e agregação —, que é o que o tira da fila de não apurados.",
          hoje: {
            href: "/curadoria",
            label: "Curadoria",
            porque: "A fila onde esta coluna espera classificação humana.",
          },
        },
      },
      {
        chave: "ativo_total_sem_imposto",
        rotulo: "Total Custo Frota Fixa sem imposto",
        medida: "DINHEIRO",
        preenchimento: "AUTOMATICO",
        origem: {
          tipo: "SOMA_DE_LINHAS",
          parcelas: [
            "ativo_remuneracao_fixa_frota",
            "ativo_remuneracao_fixa_equipe",
            "ativo_custo_variavel",
            "ativo_remuneracao_fixa_qlp",
            "ativo_outras_despesas",
            "ativo_lucro_operacional",
          ],
        },
      },
    ],
  },
  {
    titulo: "VEÍCULOS INATIVOS (PADRÃO)",
    resumo: "O que a frota parada recebe — a parcela que sobrevive à ociosidade.",
    linhas: [
      {
        chave: "inativo_remuneracao_fixa",
        rotulo: "Remuneração Fixa - Frota Fixa Inativa",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_RUBRICA(
          "Remuneração Fixa - Frota Fixa Inativa",
          "as mesmas colunas do veículo ativo, aplicadas aos cavalos com `ativo` falso — o que " +
            "falta é a regra que diz **qual parcela** sobrevive à inatividade",
        ),
      },
    ],
  },
  {
    titulo: "VANS (SRTRANS FIXO)",
    resumo: "A frota de vans dedicada, contratada por fora do modelo de caminhão.",
    linhas: [
      {
        chave: "van_quantidade_ativas",
        rotulo: "Quantidade de Vans Ativas",
        medida: "QUANTIDADE",
        preenchimento: "INFORMADO",
        origem: SEM_VAN("Contar vans ativas"),
      },
      {
        chave: "van_custo_fixo",
        rotulo: "Custo Fixo",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_VAN("O custo fixo da van"),
      },
      {
        chave: "van_custo_equipe",
        rotulo: "Custo Equipe Entrega",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_VAN("O custo da equipe de entrega da van"),
      },
      {
        chave: "van_total_com_impostos",
        rotulo: "Total Custo Vans com impostos",
        medida: "DINHEIRO",
        preenchimento: "AUTOMATICO",
        origem: SEM_VAN("O total das vans com impostos"),
      },
    ],
  },
  {
    titulo: "VEÍCULOS INATIVOS (VANS)",
    resumo: "A contrapartida da frota de vans parada.",
    linhas: [
      {
        chave: "van_quantidade_inativas",
        rotulo: "Quantidade de Vans Inativas",
        medida: "QUANTIDADE",
        preenchimento: "INFORMADO",
        origem: SEM_VAN("Contar vans inativas"),
      },
      {
        chave: "van_remuneracao_inativas",
        rotulo: "Remuneração Vans - Frota Vans Inativas",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_VAN("A remuneração da van inativa"),
      },
    ],
  },
  {
    titulo: "VIAGENS NOTURNAS",
    resumo: "As rotas que rodam à noite, remuneradas por fora da grade diurna.",
    linhas: [
      {
        chave: "noturna_quantidade_rotas",
        rotulo: "Quantidade de Rotas Noturnas",
        medida: "QUANTIDADE",
        preenchimento: "INFORMADO",
        origem: SEM_COLUNA(
          "a rota noturna",
          "A importação dos trechos com `turnoEmpurrada`, e a confirmação de qual valor dessa " +
            "coluna marca a rota noturna. `adicionalNoturno`, no export de equipe, diz que " +
            "**alguém** roda à noite, mas não quantas rotas.",
        ),
      },
      {
        chave: "noturna_custo_sem_impostos",
        rotulo: "Custo Fixo sem impostos - Noturna",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_COLUNA(
          "o custo fixo da rota noturna",
          "A mesma importação de trecho acima — sem saber quais rotas são noturnas, não há " +
            "sobre o que somar.",
        ),
      },
      {
        chave: "noturna_custo_com_impostos",
        rotulo: "Custo Fixo com impostos - Noturna",
        medida: "DINHEIRO",
        preenchimento: "AUTOMATICO",
        origem: SEM_COLUNA(
          "o custo da rota noturna com impostos",
          "O custo sem impostos acima. O gross-up em si o cadastro já sabe fazer: é o resumo " +
            "de impostos deste mesmo cadastro.",
        ),
      },
    ],
  },
  {
    titulo: "MARKETING",
    resumo: "A verba de marketing repassada à unidade, quando há.",
    linhas: [
      {
        chave: "marketing_sem_impostos",
        rotulo: "Custo Fixo sem impostos - Marketing",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_COLUNA(
          "a verba de marketing",
          "Uma coluna de marketing no export do Freightech, ou o enquadramento de uma verba " +
            "de marketing na taxonomia — hoje ela não existe em nenhum dos dois lados.",
        ),
      },
      {
        chave: "marketing_com_impostos",
        rotulo: "Custo Fixo com impostos - Marketing",
        medida: "DINHEIRO",
        preenchimento: "AUTOMATICO",
        origem: SEM_COLUNA(
          "a verba de marketing com impostos",
          "A verba sem impostos acima.",
        ),
      },
    ],
  },
  {
    titulo: "QUANTIDADE DE DOCUMENTOS EMITIDOS - ROTA %",
    resumo:
      "Que fatia dos documentos previstos fica dentro do município — e por isso paga ISS em " +
      "vez de compor CT-e.",
    linhas: [
      {
        chave: "rota_percentual_iss",
        rotulo: "% de viagens dentro do Município - ISS",
        medida: "PERCENTUAL",
        preenchimento: "AUTOMATICO",
        origem: { tipo: "PROPORCAO_DE_DOCUMENTOS", dentroDoMunicipio: true },
      },
      {
        chave: "rota_percentual_ctrc",
        rotulo: "% de viagens fora do Município - CTRC",
        medida: "PERCENTUAL",
        preenchimento: "AUTOMATICO",
        origem: { tipo: "PROPORCAO_DE_DOCUMENTOS", dentroDoMunicipio: false },
      },
    ],
  },
  {
    titulo: "RESUMO IMPOSTOS",
    resumo:
      "O divisor do gross-up: quanto sobra de cada real faturado depois dos tributos por " +
      "dentro. É por ele que valor líquido vira valor de documento.",
    linhas: [
      {
        chave: "resumo_iss",
        rotulo: "% de Impostos dentro do Município - ISS",
        medida: "PERCENTUAL",
        preenchimento: "AUTOMATICO",
        origem: { tipo: "RESUMO_DE_IMPOSTOS", tributo: "ISS" },
      },
      {
        chave: "resumo_ctrc",
        rotulo: "% de Impostos fora do Município - CTRC",
        medida: "PERCENTUAL",
        preenchimento: "AUTOMATICO",
        origem: { tipo: "RESUMO_DE_IMPOSTOS", tributo: "ICMS" },
      },
    ],
  },
  {
    titulo: "REFRIGERAÇÃO (PROMAX)",
    resumo:
      "O valor da categoria Refrigeração na tela de frota do Promax — cadastro puro, sem " +
      "fórmula confirmada que a leve ao devido (ver a nota acima de SEM_FORMULA_PROMAX).",
    linhas: [
      {
        chave: "promax_refrigeracao",
        rotulo: "Refrigeração",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_FORMULA_PROMAX("Refrigeração"),
      },
    ],
  },
  {
    titulo: "ESPECIAL (PROMAX)",
    resumo:
      "O valor da categoria Especial na tela de frota do Promax — cadastro puro, sem fórmula " +
      "confirmada que a leve ao devido.",
    linhas: [
      {
        chave: "promax_especial",
        rotulo: "Especial",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_FORMULA_PROMAX("Especial"),
      },
    ],
  },
  {
    titulo: "RECARGA (PROMAX)",
    resumo:
      "O valor da categoria Recarga na tela de frota do Promax — cadastro puro, sem fórmula " +
      "confirmada que a leve ao devido.",
    linhas: [
      {
        chave: "promax_recarga",
        rotulo: "Recarga",
        medida: "DINHEIRO",
        preenchimento: "INFORMADO",
        origem: SEM_FORMULA_PROMAX("Recarga"),
      },
    ],
  },
];

/** Todas as linhas do cadastro, na ordem dos blocos. */
export const LINHAS_DO_CADASTRO: LinhaDoCadastro[] = BLOCOS_DO_CADASTRO.flatMap((b) => b.linhas);

const POR_CHAVE = new Map(LINHAS_DO_CADASTRO.map((l) => [l.chave, l]));

/** A linha de uma chave. `undefined` quando a chave não existe no catálogo. */
export function linhaDoCadastro(chave: string): LinhaDoCadastro | undefined {
  return POR_CHAVE.get(chave);
}

/* =========================================================================
 * O QUE CADA LINHA PODE SER COMPROVADO — a classificação que o lastro conta
 * ====================================================================== */

/**
 * De onde o número **poderia** vir, no melhor dos mundos.
 *
 * Não é o estado da linha hoje (isso é `LinhaApurada.estado`); é o teto dela.
 * Existe porque o denominador do lastro estava errado, e o erro tinha nome: a
 * tela dizia `0 de 30 linhas com lastro` e quem lia entendia que faltavam
 * trinta arquivos. Faltavam onze — e as outras dezenove não esperam arquivo
 * nenhum, nunca esperaram, e não vão esperar: elas são decisões de negócio que
 * alguém digita, ou contas que o próprio cadastro refaz.
 *
 * Um percentual sobre trinta diria "37% cadastrado" para a unidade que entregou
 * tudo o que tinha para entregar. É a diferença entre um indicador e uma
 * cobrança injusta.
 */
export type ProcedenciaPossivel =
  /**
   * Há documento independente que mede esta linha — export de equipamento ou
   * série de trechos. São as que o acervo confirma ou contradiz.
   */
  | "DOCUMENTO"
  /**
   * Aritmética sobre linhas de documento. Não tem fonte própria e herda a
   * delas: com as alíquotas medidas, o resumo de impostos é medido junto.
   */
  | "DERIVADA_DE_DOCUMENTO"
  /**
   * Aritmética sobre linhas que só existem informadas. Nunca terá lastro do
   * acervo — não porque falte arquivo, mas porque não há arquivo que a diga.
   */
  | "DERIVADA_DO_CADASTRO"
  /** Decisão de negócio. Só existe se alguém a digitar. */
  | "SO_INFORMADA";

/** Qual documento sustenta a linha, quando algum sustenta. */
export type DocumentoQueSustenta = "EXPORT_DE_EQUIPAMENTO" | "SERIE_DE_TRECHOS";

/**
 * O teto de uma linha — o que ela pode chegar a ser.
 *
 * Sai de `origem.tipo`, e não de uma lista à parte: uma segunda lista
 * discordaria da primeira no dia em que uma linha mudasse de origem, e a que a
 * tela lê seria a que ninguém testa.
 */
export function procedenciaPossivel(linha: LinhaDoCadastro): ProcedenciaPossivel {
  switch (linha.origem.tipo) {
    case "CONTAGEM_DE_FROTA":
    case "ALIQUOTA_DECLARADA":
    case "ALIQUOTA_CONJUNTA_PIS_COFINS":
    case "PROPORCAO_DE_DOCUMENTOS":
      return "DOCUMENTO";
    case "RESUMO_DE_IMPOSTOS":
      return "DERIVADA_DE_DOCUMENTO";
    case "SOMA_DE_LINHAS":
      return "DERIVADA_DO_CADASTRO";
    case "SEM_ORIGEM":
      return "SO_INFORMADA";
  }
}

/** Qual arquivo mede a linha — `null` nas que arquivo nenhum mede. */
export function documentoQueSustenta(linha: LinhaDoCadastro): DocumentoQueSustenta | null {
  switch (linha.origem.tipo) {
    case "CONTAGEM_DE_FROTA":
      return "EXPORT_DE_EQUIPAMENTO";
    case "ALIQUOTA_DECLARADA":
    case "ALIQUOTA_CONJUNTA_PIS_COFINS":
    case "PROPORCAO_DE_DOCUMENTOS":
      return "SERIE_DE_TRECHOS";
    default:
      return null;
  }
}

/**
 * As linhas cujo valor o acervo pode sustentar — **o denominador do lastro**.
 *
 * As de documento e as que derivam delas. As duas derivadas entram porque o
 * lastro delas é real: com as alíquotas medidas pelo export, `resumo_iss` é
 * aritmética sobre número medido, e a tela a marca como apurada. O que não
 * entra é o que nenhum arquivo alcança.
 */
export const LINHAS_VERIFICAVEIS_NO_ACERVO: string[] = LINHAS_DO_CADASTRO.filter((l) => {
  const p = procedenciaPossivel(l);
  return p === "DOCUMENTO" || p === "DERIVADA_DE_DOCUMENTO";
}).map((l) => l.chave);
