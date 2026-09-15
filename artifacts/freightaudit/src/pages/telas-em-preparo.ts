import {
  BadgeCheck,
  Banknote,
  Building2,
  ChartColumn,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  History,
  Receipt,
  Shield,
  SquareActivity,
  SquareTerminal,
  Timer,
  TrendingUp,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * O catálogo das telas anunciadas no menu que o banco ainda não sustenta.
 *
 * Uma linha aqui é um contrato em três partes: **a pergunta** que a tela vai
 * responder, **o que falta** para ela responder — sempre um dado que não
 * existe, nunca um prazo — e **onde olhar hoje**, que é a tela já funcionando
 * mais perto daquela pergunta.
 *
 * O terceiro campo é o que separa este catálogo de uma lista de promessas.
 * "Impacto financeiro em preparo" deixa quem abriu no mesmo lugar; "o delta de
 * cada parâmetro está em Alterações, e o valor montado de um equipamento está
 * em Composição" entrega metade da resposta na hora.
 *
 * Tirar uma linha daqui é o passo final de construir a tela: some do catálogo,
 * a rota passa a apontar para a tela de verdade em `App.tsx`, e o menu não muda
 * uma vírgula — o item já estava lá, no lugar certo, com o nome certo.
 */

export interface TelaEmPreparo {
  href: string;
  label: string;
  icon: LucideIcon;
  /** A classe de cor da seção a que ela pertence — ver `--nav-*` em `index.css`. */
  cor: string;
  /** A pergunta que a tela vai responder, numa frase. */
  pergunta: string;
  /** O que precisa existir antes — sempre um dado, nunca um prazo. */
  depende: string[];
  /** Onde olhar hoje: telas que já funcionam e chegam perto. */
  hoje: { href: string; label: string; porque: string }[];
}

export const TELAS_EM_PREPARO: TelaEmPreparo[] = [
  // -------------------------------------------------------------------------
  // Auditoria
  // -------------------------------------------------------------------------
  /*
    `/impacto-financeiro` saiu deste catálogo: a rota abre Alterações › Impacto,
    que responde a pergunta pelo caminho que o dado sustenta hoje — quanto cada
    ativo custa em cada quinzena, pelo valor que a própria tabela declara.

    O que aquela entrada dizia faltar continua faltando, e não é pouco: o volume
    realizado por equipamento, que é o que transformaria a variação de um
    parâmetro no dinheiro que ela **move**. Sem ele, esta tela mostra o preço
    contratado e a variação dele, nunca o custo de uma operação. A distinção
    está escrita na própria tela, e é dela que sai a próxima versão desta
    resposta — não de uma linha de volta aqui.
  */
  {
    href: "/anomalias",
    label: "Anomalias",
    icon: TriangleAlert,
    cor: "text-nav-auditoria",
    pergunta:
      "Que valores desta vigência estão fora do que a própria base explica — o outlier que ninguém pediu para procurar.",
    depende: [
      "Uma régua estatística por rubrica sobre o histórico de vigências. Com poucas vigências importadas, qualquer limiar acusa tudo ou não acusa nada, e as duas falhas custam a confiança da tela.",
      "A separação entre desvio e mudança negociada: reajuste combinado e erro de digitação têm a mesma cara num gráfico, e só o registro da negociação os distingue.",
    ],
    hoje: [
      {
        href: "/curadoria",
        label: "Curadoria",
        porque: "O que a importação não soube classificar sozinha — o desvio que já aparece hoje.",
      },
      {
        href: "/comparar",
        label: "Comparar vigências",
        porque: "A variação item a item entre duas vigências quaisquer, para olhar com o olho humano.",
      },
    ],
  },
  {
    href: "/auditorias",
    label: "Auditorias",
    icon: ClipboardCheck,
    cor: "text-nav-auditoria",
    pergunta:
      "Que ciclos de auditoria estão abertos, quem responde por cada achado e o que já foi fechado — com data e nome.",
    depende: [
      "O achado como registro próprio no banco: hoje existe a confirmação de curadoria, que diz que alguém olhou um item, e não o caso de auditoria, que atravessa vigências e tem dono, prazo e desfecho.",
      "O vínculo entre achado e evidência — a alteração, o parâmetro ou a célula que o originou —, sem o qual o ciclo vira lista de tarefas sem lastro.",
    ],
    hoje: [
      {
        href: "/alteracoes",
        label: "Alterações",
        porque: "A fila do que mudou na vigência aberta, que é de onde os achados nascem.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // QLP — hoje dentro de Custo Fixo
  // -------------------------------------------------------------------------
  /*
    `/qlp-administrativo` saiu deste catálogo: a importação passou a receber o
    export próprio do QLP ADM (tipo QLP_ADMINISTRATIVO, família de dados
    QUADRO_DE_PESSOAL), e a tela de verdade lê o quadro por unidade e cargo,
    compara vigências pelo motor canônico e rastreia cada valor até a célula.
    O que a entrada dizia faltar em segundo lugar **continua faltando**: o
    registro da auditoria bimestral — o DESCONTO QLP ADM — não vem em export
    nenhum, e a tela diz isso em vez de fingir o desconto. A distinção está
    escrita na própria tela, e é dela que sai a próxima versão desta resposta.

    O QLP Operacional continua aqui pela razão de sempre: o export dele ainda
    não chegou. O tipo de importação já existe (`QLP_OPERACIONAL`, grão unidade
    + cargo + turno), então o caminho é o mesmo que o administrativo percorreu:
    importar a primeira planilha, e promover a tela.
  */
  /*
    `/qlp-operacional` saiu deste catálogo — e saiu **sem o arquivo**, que é a
    única vez que isto acontece nesta série. É preciso dizer com todas as letras:
    o que o verbete pedia continua faltando. As linhas de QLP operacional não
    chegam neste banco, e a tela abre dizendo isso.

    O que mudou é que ela pode existir antes do arquivo sem prometer nada. O grão
    (unidade + cargo + turno), as colunas e — sobretudo — **as contas** estão
    declarados no dicionário da tabela de equipe: nove daquelas colunas são
    subtotais das outras, e a cadeia que as liga está escrita lá como *proposta,
    não medida*. Uma tela que confere essa cadeia é o instrumento que a confirma
    ou a derruba no dia em que o primeiro export entrar — e, até lá, o que ela
    mostra é a frase verdadeira, e não um quadro vazio que pareceria uma operação
    sem gente.

    A mesma auditoria virou a aba **Auditoria** do QLP Administrativo, onde o
    arquivo já existe: lá ela confere `Quantidade × Valor = Despesa`, uma por
    rubrica, e o efetivo contra o quadro de referência da auditoria bimestral
    (`docs/ACHADO-QLP.md`). É o mesmo componente nas duas telas, porque é a mesma
    pergunta.
  */

  // -------------------------------------------------------------------------
  // Custo Fixo
  // -------------------------------------------------------------------------
  /*
    Os módulos da seção Custo Fixo que ainda não têm tela entram no menu com o
    nome, e no catálogo com o que já se sabe de cada rubrica. A definição de cada tela — o
    que ela mostra, com que grão e comparada a quê — ainda vem; o que este
    catálogo recusa é o caminho contrário, um item de menu que abre página vazia
    enquanto a definição não chega.

    O `depende` deles tem uma linha em comum, e não é acaso: custo fixo de
    um ativo só fecha quando a rubrica estiver separada na base e ligada ao
    equipamento e à vigência a que pertence. O que muda de um verbete para o
    outro é a segunda linha, que é a do dado próprio da rubrica.
  */
  /*
    `/custo-fixo-finame` saiu deste catálogo: a rota abre a Auditoria de FINAME,
    que compara o financiamento de cada veículo entre duas vigências — parcela,
    juros, amortização, taxa, prazo, carência, entrada e base de compra —, sobre
    o motor de comparação que já existe.

    O que o verbete dizia faltar continua faltando, e não é pouco: o contrato por
    trás da parcela — valor financiado, prazo e o que já foi amortizado. Sem ele
    a tela diz o que **mudou** no que se paga, nunca o que ainda se deve. A
    distinção está escrita na própria tela.
  */
  /*
    `/custo-fixo-juros-finame` saiu do catálogo junto com o item de menu que o
    alcançava: o juro do financiamento não é rubrica ao lado da Finame, é uma
    coluna dentro dela — a Auditoria de FINAME já compara juros, amortização e
    taxa parcela a parcela. Um módulo próprio só repetiria, em outro lugar, o
    que aquela tela mostra ao lado do principal, e verbete sem item que o
    alcance é catálogo que ninguém lê.
  */
  /*
    `/custo-fixo-ipva` saiu deste catálogo: a rota abre a Auditoria de IPVA, que
    compara o tributo de cada veículo entre duas vigências — o IPVA, o valor de
    nota que lhe serve de base, o ano e a data de entrada — sobre o mesmo motor de
    comparação do Finame.

    **O verbete não foi atendido, e é importante dizer qual metade ficou.** Ele
    pedia a conferência contra ano-modelo, valor venal e a UF do emplacamento;
    categoria e UF continuam não existindo no acervo, e a tela não afirma nada
    sobre elas. O que o acervo tem é o valor de nota, e o IPVA dividido por ele é
    uma alíquota que se lê — a leitura que separa um IPVA alto de um IPVA errado,
    e que mostrou, sobre dado real, que a queda de R$ 720 mil na linha da frota de
    cavalos foi troca de fórmula e não economia (`docs/ACHADO-IPVA.md`). O que
    falta está escrito na própria tela, no rodapé da alíquota.
  */
  /*
    `/custo-fixo-lucro-fixo` saiu deste catálogo: a rota abre a Auditoria de
    Lucro Fixo, que compara a remuneração fixa de cada veículo entre duas
    vigências — a parcela própria, o ciclo, a amortização e o ano — sobre o mesmo
    motor de comparação do Finame e do IPVA.

    **O verbete não foi atendido, e é a metade que fica.** Ele pedia o percentual
    contratado sobre o qual a rubrica é calculada; ele continua não existindo, e
    por isso a tela diz o que mudou no que se paga, nunca se é o valor devido.

    O que mudou foi a pergunta, e o acervo a responde melhor do que um percentual
    responderia: **lucro fixo e amortização nunca coexistem** — 558 linhas, zero
    coexistências (`regras.ts`) —, e o ciclo diz qual dos dois está valendo.
    Quando um ativo termina de amortizar, ele entra no segundo ciclo e a
    remuneração começa; a linha da frota sobe sem que ninguém tenha renegociado
    nada. A tela mostra quem virou, com o dinheiro dos dois lados, e marca os
    dois casos que o acervo diz não existirem: o ativo que voltou ao primeiro
    ciclo e o que declara os dois ao mesmo tempo.
  */
  /*
    `/custo-fixo-impostos` saiu deste catálogo: a rota abre a Auditoria de
    Impostos, que compara o ICMS e o PIS/COFINS da compra de cada ativo entre
    duas vigências — montante, alíquota declarada e valor de nota — sobre o mesmo
    motor das outras três auditorias de rubrica.

    **O verbete foi atendido pela metade, e a outra metade virou recusa escrita.**
    A metade atendida é a primeira linha do `depende`: a alíquota **medida**, e
    não a declarada. O montante dividido pelo valor de nota é dinheiro sobre
    dinheiro, sem a ambiguidade de escala de uma coluna de percentual, e a tela
    põe as duas lado a lado — é a conferência que ocupa o painel central.

    A metade recusada é a segunda linha, e ela continua verdadeira: **o imposto do
    frete não está aqui.** A dedução de PIS/COFINS e de ICMS/ISS sobre a prestação
    mora na tabela de trecho, que não é a fonte que este banco apura, e somá-la ao
    imposto da compra do ativo daria o total de duas grandezas diferentes. A tela
    diz isso no rodapé da conferência e na gaveta de cada veículo, em vez de
    fingir a soma.

    O que nenhuma das duas metades previa está medido em `docs/ACHADO-IMPOSTOS.md`:
    o montante de ICMS é **zero nas 1.215 linhas** do acervo, enquanto as
    alíquotas de ICMS são declaradas em todas elas. Não é imposto zero — é coluna
    sem dado, e a tela tem um veredito próprio para dizê-lo.
  */

  // -------------------------------------------------------------------------
  // Custo Variável
  // -------------------------------------------------------------------------
  /*
    A outra metade da conta, e o mesmo contrato dos quatro acima: o item existe
    no menu com o nome, e o verbete diz o que falta antes de a rubrica virar
    número. A linha comum aqui é outra, e é a que separa custo variável de custo
    fixo: **o realizado**. Nenhuma destas quatro telas fecha sem o que a operação
    de fato rodou na quinzena, e é esse dado que o export que abastece este banco
    ainda não traz — o mesmo que já falta ao Impacto, e pela mesma razão.
  */
  /*
    `/custo-variavel-km-rodado` saiu deste catálogo, e é a primeira das quatro de
    custo variável a sair — pelo caminho das quatro de custo fixo, e com a mesma
    honestidade sobre a metade que não foi atendida.

    **O que continua faltando é exatamente o que o verbete dizia**: a
    quilometragem **realizada** por quinzena. O que chega a este banco é a tabela
    de preço por trecho, não o apontamento de viagens, e a tela não multiplica
    R$/km por uma distância que ninguém importou — seria inventar o número que ela
    existiria para mostrar. Ela diz isso no cartão de impacto, no rodapé da
    conferência e na gaveta de cada trecho.

    **O que mudou foi o grão da pergunta.** Custo variável é provocado por rodar,
    e o que roda é um percurso: a tela é por **trecho**, e não por placa. Nesse
    grão o acervo sustenta uma pergunta inteira — quanto custa o quilômetro
    contratado, parcela a parcela — e mais duas contas que o próprio dicionário da
    tabela de frete publica e que ninguém tinha conferido: ida + volta tem de dar
    o km do ciclo, e `R$/viagem ÷ R$/km` tem de devolver esse mesmo km. A segunda
    enxerga um preço montado sobre outra distância — a projeção mensal, o km de
    ida, a versão “lucro” —, coisa que o delta de uma coluna sozinha nunca mostra
    (`docs/ACHADO-KM-RODADO.md`).
  */

  /*
    `/custo-variavel-velocidade-media` saiu deste catálogo, e desta vez o verbete
    foi atendido quase por inteiro — o que não aconteceu com nenhuma das cinco
    telas anteriores.

    Ele pedia **distância e tempo na mesma linha** e **a separação entre tempo
    rodando e tempo parado**, e as duas existem na tabela de frete: o ciclo é
    declarado como deslocamento mais TMA de origem, TMA de destino e refeição, e
    cada parcela tem coluna própria. Subtraindo as paradas do ciclo sobra o tempo
    rodando — a separação que o verbete dizia faltar —, e com o km ele produz uma
    velocidade que tem de ser a declarada. Quando não é, ou o ciclo foi montado
    com outro tempo de deslocamento, ou a velocidade declarada não é a que o
    modelo usou (`docs/ACHADO-VELOCIDADE-MEDIA.md`).

    **O que continua faltando é o realizado, e é outra coisa do que o verbete
    imaginava.** Estes são o tempo e a distância **contratados** — o que o modelo
    de remuneração parametriza para o trecho, não o que um motorista praticou
    numa quinzena. A tela não afirma a que velocidade alguém dirigiu; afirma a que
    velocidade o contrato supõe que se dirija, e diz a diferença por extenso.

    E trouxe o que o dicionário pede em voz alta e nenhuma tela mostrava: a folga
    entre o tempo que **remunera** e o que a operação pratica. Os pares `…Lucro`
    existem porque os dois podem divergir, e "a diferença entre os dois é
    exatamente onde a conversa comercial acontece — não a apague escolhendo um
    só".
  */

  {
    href: "/custo-variavel-tma",
    label: "TMA",
    icon: Timer,
    cor: "text-nav-custo-variavel",
    pergunta:
      "Qual o tempo médio de atendimento por unidade e por ativo, e quanto do custo variável da vigência ele responde.",
    depende: [
      "O registro de cada atendimento com começo e fim: média de tempo sem os dois carimbos é média de nada.",
      "A regra do que conta como atendimento — o que entra, o que é espera e o que é interrupção —, sem a qual duas unidades com a mesma operação exibiriam TMAs que não se comparam.",
    ],
    hoje: [
      {
        href: "/ativos-e-parados",
        label: "Ativos e parados",
        porque: "A leitura de tempo que o banco já sustenta hoje, por ativo e por vigência.",
      },
      {
        href: "/book-operador",
        label: "Book do Operador",
        porque: "A regra do atendimento está escrita lá — a metade da resposta que não depende de importação.",
      },
    ],
  },
  {
    href: "/custo-variavel-salario-variavel",
    label: "Salário Variável",
    icon: Wallet,
    cor: "text-nav-custo-variavel",
    pergunta:
      "Quanto da folha desta vigência é variável — o que se paga por produção, e não por ter a pessoa no quadro —, por unidade e por cargo.",
    depende: [
      "A parte variável separada da fixa dentro da folha: enquanto as duas chegarem somadas, o total seria o da remuneração inteira, e não o do que a produção moveu.",
      "A produção a que o variável se prende — a mesma quilometragem e o mesmo atendimento de que as telas acima dependem —, sem a qual a tela mostra o valor pago e não responde se é o valor devido.",
    ],
    hoje: [
      {
        href: "/qlp-administrativo",
        label: "QLP Administrativo",
        porque: "O quadro de gente que o modelo remunera, por unidade e cargo — onde a folha já se lê hoje.",
      },
      {
        href: "/remunerado",
        label: "Remunerado",
        porque: "O que a vigência remunera, como a própria tabela o declara.",
      },
    ],
  },

  {
    href: "/custo-variavel-lucro-variavel",
    label: "Lucro Variável",
    icon: TrendingUp,
    cor: "text-nav-custo-variavel",
    pergunta:
      "Quanto do lucro desta vigência é variável — o que o modelo paga por produção, e não por ter o ativo à disposição —, por equipamento e por unidade.",
    depende: [
      "O realizado da operação por equipamento: a base traz o lucro variável **previsto** (`lucroVariavelPrevisto`), e previsto menos realizado é a pergunta desta tela. Sem o realizado, ela mostraria a previsão com o nome de resultado.",
      "A regra que liga a previsão à produção — a mesma quilometragem e o mesmo atendimento de que Km Rodado e TMA dependem —, sem a qual não há como conferir o variável pago contra o variável devido.",
    ],
    hoje: [
      {
        href: "/remunerado",
        label: "Remunerado",
        porque: "O lucro variável previsto, como a própria tabela da vigência o declara.",
      },
      {
        href: "/composicao",
        label: "Composição",
        porque:
          "O valor montado de um equipamento, parcela a parcela — é onde a linha do lucro variável previsto aparece hoje.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Frota
  // -------------------------------------------------------------------------
  /*
    `/cavalo-360` e `/carreta-360` saíram deste catálogo: as duas telas existem,
    e respondem pelo caminho que o dado sustenta hoje — as quatro leituras de
    Alterações recortadas no equipamento, com a placa como segundo nível.

    O que a entrada do cavalo dizia faltar era "a chave de frota ligando a
    vigência ao equipamento físico", e ela existe: `entity_identifier` do tipo
    `PLACA`, que a comparação já denormaliza em `change.entity_label` e a
    matriz por quinzena já usa como rótulo de linha.

    O que a entrada da carreta dizia faltar **continua faltando**, e não é
    pouco: o vínculo cavalo–carreta ao longo do tempo. Sem ele, Carreta 360°
    responde pela carreta — o que ela recebe, o que mudou nela, quanto custou —
    e não responde "o que muda quando ela troca de cavalo". A distinção está
    escrita na própria tela, e é dela que sai a próxima versão desta resposta,
    não de uma linha de volta aqui.
  */
  {
    href: "/dre-veiculo",
    label: "DRE do veículo",
    icon: FileSpreadsheet,
    cor: "text-nav-frota",
    pergunta:
      "Receita, custo e margem de um veículo no período — se ele se paga, e por quanto.",
    depende: [
      "O custo operacional: combustível, manutenção, pneu, pessoal, depreciação. Nada disso vem da planilha de remuneração, que só conhece o lado da receita.",
      "O critério de rateio do custo indireto por veículo, escrito e versionado. DRE por ativo sem rateio declarado é opinião apresentada como resultado.",
    ],
    hoje: [
      {
        href: "/dre",
        label: "DRE",
        porque:
          "A demonstração que o banco sustenta hoje: receita, amortização, juros e " +
          "IPVA por conjunto, com a origem de cada número e a cobertura medida. Ela " +
          "recusa exibir EBITDA e margem de contribuição justamente pelo que falta " +
          "aqui, e abre a ficha de cada veículo a partir do ranking.",
      },
      {
        href: "/composicao",
        label: "Composição",
        porque: "O lado da receita, que é a metade da conta que o banco já sustenta.",
      },
    ],
  },
  {
    href: "/benchmark-unidades",
    label: "Benchmark de unidades",
    icon: ChartColumn,
    cor: "text-nav-frota",
    pergunta:
      "Como cada unidade se paga em relação às outras, na mesma régua — e o que explica a diferença.",
    depende: [
      "Mais de uma unidade com vigência importada. Com uma só, a tela compara a unidade consigo mesma.",
      "A normalização por perfil de operação: distância média, tipo de carga, mix de frota. Comparar reais por viagem entre operações diferentes produz um ranking que mede a operação, não a tabela.",
    ],
    hoje: [
      {
        href: "/unidades",
        label: "Unidades",
        porque: "Que unidades existem e o que cada uma já entregou de vigência.",
      },
      {
        href: "/vigencia",
        label: "Acompanhamento",
        porque: "O acompanhamento da unidade aberta, que é a régua de uma unidade por vez.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Inteligência
  // -------------------------------------------------------------------------
  {
    href: "/monitor-ia",
    label: "Monitor de IA",
    icon: SquareActivity,
    cor: "text-nav-inteligencia",
    pergunta:
      "O que o assistente respondeu, com que material, em que modo e a que custo — o rastro de tudo que a IA disse neste produto.",
    depende: [
      "O registro de cada resposta no banco: a pergunta, os trechos que ela citou, o modelo, o esforço e os tokens. Hoje a resposta é dita na tela e não fica.",
      "A retenção decidida em produto — o que se guarda de uma pergunta feita por uma pessoa, e por quanto tempo.",
    ],
    hoje: [
      {
        href: "/assistente",
        label: "Assistente IA",
        porque: "Cada resposta já diz em qual dos dois modos foi redigida e sobre que material.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Dados & governança
  // -------------------------------------------------------------------------
  {
    href: "/qualidade-dados",
    label: "Qualidade de dados",
    icon: BadgeCheck,
    cor: "text-nav-dados",
    pergunta:
      "Que regra de qualidade cada vigência passou, onde falhou e o que a falha impede de afirmar.",
    depende: [
      "O catálogo de regras como dado versionado, e não como código espalhado pela importação: uma regra que muda sem deixar registro reescreve o passado da tela.",
      "O resultado de cada regra gravado por vigência, para que a tela mostre histórico e não apenas o estado de agora.",
    ],
    hoje: [
      {
        href: "/rastreio-de-dados",
        label: "Rastreio de Dados",
        porque: "A regra de qualidade que já roda: toda célula do arquivo chegou a algum lugar.",
      },
      {
        href: "/dados",
        label: "Cobertura de dados",
        porque: "O que a base cobre e o que ficou de fora, por tipo de entidade.",
      },
    ],
  },
  {
    href: "/fontes-dados",
    label: "Fontes de dados",
    icon: Database,
    cor: "text-nav-dados",
    pergunta:
      "De onde vem cada número — arquivo, aba, coluna, quem enviou e quando —, e o que quebra se aquela fonte parar.",
    depende: [
      "O catálogo de fontes acima do registro de importação: hoje o banco sabe qual arquivo trouxe cada fato, e não qual sistema, área ou pessoa responde por aquele arquivo.",
      "A dependência declarada entre fonte e tela, para que a pergunta 'o que para de funcionar se esta fonte atrasar' tenha resposta.",
    ],
    hoje: [
      {
        href: "/importacoes",
        label: "Importações",
        porque: "Cada arquivo recebido, com o que ele trouxe e o que foi recusado.",
      },
      {
        href: "/versoes",
        label: "Versões",
        porque: "As versões do que foi ingerido, em ordem.",
      },
    ],
  },
  {
    href: "/historico-decisoes",
    label: "Histórico de decisões",
    icon: History,
    cor: "text-nav-dados",
    pergunta:
      "Quem decidiu o quê, quando e com base em quê — numa linha do tempo só, atravessando curadoria, vigências e acessos.",
    depende: [
      "A reunião do que já é gravado em separado: as confirmações de curadoria carregam autor e carimbo, a promoção de vigência também, e os dois não se leem juntos.",
      "A decisão como registro de primeira classe, com o estado anterior e o posterior, para que a linha do tempo mostre o efeito e não só o clique.",
    ],
    hoje: [
      {
        href: "/curadoria",
        label: "Curadoria",
        porque: "As confirmações já ficam no nome de quem as fez — é a metade que existe.",
      },
      {
        href: "/versoes",
        label: "Versões",
        porque: "O que entrou em cada versão, que é o efeito das decisões de ingestão.",
      },
    ],
  },
  {
    href: "/logs-sistema",
    label: "Logs de sistema",
    icon: SquareTerminal,
    cor: "text-nav-dados",
    pergunta:
      "O que o servidor fez, em ordem, quando algo não saiu como esperado — sem pedir o terminal a alguém.",
    depende: [
      "Coleta e retenção de log do lado do servidor, hoje escrito na saída do processo e perdido a cada reinício.",
      "Uma rota autenticada que os exponha filtrados: log de servidor carrega caminho de arquivo, consulta e identificador de pessoa, e não é material para qualquer sessão aberta.",
    ],
    hoje: [
      {
        href: "/importacoes",
        label: "Importações",
        porque: "O erro de ingestão já aparece na própria importação que o produziu, com a linha do arquivo.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Administração
  // -------------------------------------------------------------------------
  /*
    "Integrações" saiu deste catálogo porque deixou de estar em preparo: a tela
    existe (`pages/integracoes.tsx`), sobre a porta de API de verdade — chave
    por sistema, escopo por chave e o registro de cada chamada. O verbete pedia
    "credencial guardada e resultado da última execução", e é isso que ela
    mostra.

    O que aquele verbete pedia e ainda não existe é a **busca ativa** — nós
    chamando o fornecedor numa agenda. Isso não voltou para cá como tela em
    preparo porque não é uma tela que falta: é uma capacidade que falta, e o
    lugar de descrevê-la é `docs/INTEGRACOES.md`, onde ela está, e não um item
    de menu que promete o que não faz.
  */
  {
    href: "/seguranca",
    label: "Segurança",
    icon: Shield,
    cor: "text-nav-admin",
    pergunta:
      "Quem entrou, de onde, o que abriu e o que continua aberto agora.",
    depende: [
      "O registro de sessão além do último login: início, fim, origem e encerramento — a tela de Usuários já conta as sessões abertas, e não sabe contar a história delas.",
      "O registro de acesso a dado sensível, que é o que uma tela de segurança precisa mostrar e o servidor ainda não grava.",
    ],
    hoje: [
      {
        href: "/configuracoes/usuarios",
        label: "Configurações › Usuários",
        porque: "Quem tem acesso, o último login de cada pessoa e quantas sessões estão abertas.",
      },
    ],
  },

  /*
    As quatro seções da casa que o índice de Configurações anuncia e o banco
    ainda não sustenta. Elas entram aqui, e não em telas próprias de cadastro,
    pela regra do catálogo: uma tela de cadastro vazia convida a preencher, e o
    que se preenchesse não teria onde ser gravado. O índice as mostra marcadas
    "em preparo", e abrir cada uma responde o que falta.
  */
  {
    href: "/configuracoes/empresa",
    label: "Minha Empresa",
    icon: Building2,
    cor: "text-nav-admin",
    pergunta:
      "Quem é a empresa que opera este produto: razão social, CNPJ, marca e quem responde por ela.",
    depende: [
      "O cadastro da própria instalação no banco. Hoje o produto conhece as seleções que entregaram vigência, e nenhuma linha diz de que empresa elas são — a identidade da casa está no nome do ambiente, não em dado.",
      "A separação entre a empresa que contrata e o embarcador que aparece nas planilhas: os dois nomes convivem na mesma coluna em vários exports, e sem distingui-los esta tela responderia duas perguntas diferentes com o mesmo campo.",
    ],
    hoje: [
      {
        href: "/configuracoes/unidades",
        label: "Configurações › Unidades",
        porque:
          "As seleções que já entregaram vigência — o mais perto de um cadastro da casa que existe hoje.",
      },
    ],
  },
];
