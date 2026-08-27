import {
  BadgeCheck,
  ChartColumn,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Gavel,
  Handshake,
  HardHat,
  History,
  Plug,
  Settings2,
  Shield,
  ShieldCheck,
  SquareActivity,
  SquareTerminal,
  TriangleAlert,
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
  // Recuperação
  // -------------------------------------------------------------------------
  {
    href: "/contestacao",
    label: "Contestação & Recuperação",
    icon: Gavel,
    cor: "text-nav-recuperacao",
    pergunta:
      "Que valores cabem contestar junto à Freightec, em que estágio está cada pedido e quanto já voltou.",
    depende: [
      "O impacto financeiro apurado — não se contesta uma variação de parâmetro, contesta-se um valor pago a mais.",
      "O estágio de cada pedido como estado no banco: aberto, enviado, aceito, recusado, recuperado — com o documento que sustenta cada transição.",
    ],
    hoje: [
      {
        href: "/comparar",
        label: "Comparar vigências",
        porque: "A prova documental de que o parâmetro mudou, que é o anexo de qualquer contestação.",
      },
    ],
  },
  {
    href: "/reconciliacao",
    label: "Reconciliação",
    icon: Handshake,
    cor: "text-nav-recuperacao",
    pergunta:
      "O que a tabela manda pagar bate com o que foi efetivamente pago, viagem a viagem.",
    depende: [
      "A entrada do realizado — fatura, pagamento ou espelho de frete. Hoje só entra a tabela de remuneração; sem o outro lado não há o que reconciliar.",
      "A chave que liga um pagamento à linha de tabela que o justifica. Sem ela a comparação vira soma contra soma, que fecha por acaso e esconde erro compensado.",
    ],
    hoje: [
      {
        href: "/rastreio-de-dados",
        label: "Rastreio de Dados",
        porque: "A conferência que já existe: toda célula que o arquivo trouxe chegou a algum lugar.",
      },
    ],
  },
  {
    href: "/risco-materialidade",
    label: "Risco & Materialidade",
    icon: ShieldCheck,
    cor: "text-nav-recuperacao",
    pergunta:
      "Onde vale gastar a hora de auditoria — qual desvio é grande o bastante para pagar o trabalho de contestá-lo.",
    depende: [
      "O impacto financeiro apurado, que é o numerador de qualquer conta de materialidade.",
      "O limiar por unidade, decidido e registrado no produto. Materialidade herdada de outra empresa é chute com aparência de norma.",
    ],
    hoje: [
      {
        href: "/analise-equipamentos",
        label: "Análise de frota",
        porque: "Onde a frota se concentra — a exposição que hoje dá para ver sem o valor em reais.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // QLP
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
  {
    href: "/qlp-operacional",
    label: "QLP Operacional",
    icon: HardHat,
    cor: "text-nav-qlp",
    pergunta:
      "Quantas pessoas o modelo remunera na operação de cada unidade — o quadro por cargo, a quantidade contratada e o valor que ela carrega na quinzena.",
    depende: [
      "As linhas de QLP dentro da importação: o Freightech publica cargo, quantidade e valor por faixa (os cartões de QLP benchmark), e o export que chega a este banco não traz nenhuma delas — sem essas linhas, não há quadro para mostrar.",
      "O vínculo entre o quadro e a unidade e vigência a que ele pertence, sem o qual a tela mostraria um número solto, e não o quadro de uma operação numa quinzena.",
    ],
    hoje: [
      {
        href: "/book-operador",
        label: "Book do Operador",
        porque:
          "A regra do quadro de gente está escrita nos blocos de Gente — é a metade da resposta que não depende de importação.",
      },
      {
        href: "/assistente",
        label: "Assistente IA",
        porque: "Responde o que o Book diz sobre QLP, cargo a cargo, sem esperar a tela.",
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
  {
    href: "/ajustes",
    label: "Configurações",
    icon: Settings2,
    cor: "text-nav-admin",
    pergunta:
      "Os ajustes que valem para a instalação inteira: moeda, fuso, casas decimais, limiares e o que cada tela assume por padrão.",
    depende: [
      "Os ajustes como dado no banco, e não como constante no código. Hoje cada padrão está escrito onde é usado, o que é honesto e não é configurável.",
      "O registro de quem mudou cada ajuste e quando: mexer num limiar muda o que todas as telas afirmam, e isso é decisão auditável.",
    ],
    hoje: [
      {
        href: "/unidades",
        label: "Unidades",
        porque: "Que unidades existem — o cadastro que os ajustes da instalação também vão precisar.",
      },
      {
        href: "/configuracoes",
        label: "Usuários",
        porque: "A administração que já existe: quem pode entrar, e em nome de quem cada ação fica.",
      },
    ],
  },
  {
    href: "/integracoes",
    label: "Integrações",
    icon: Plug,
    cor: "text-nav-admin",
    pergunta:
      "Que sistemas entregam e consomem dados aqui, e se a última troca de cada um funcionou.",
    depende: [
      "O conector como coisa do produto: endereço, credencial guardada em cofre, agenda e resultado da última execução. Hoje a entrada é envio manual de arquivo em Importações.",
      "O contrato de cada troca versionado, para que a mudança do outro lado apareça como falha nomeada e não como importação silenciosamente incompleta.",
    ],
    hoje: [
      {
        href: "/importacoes",
        label: "Importações",
        porque: "O caminho de entrada que existe hoje, com o resultado de cada arquivo enviado.",
      },
    ],
  },
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
        href: "/configuracoes",
        label: "Usuários",
        porque: "Quem tem acesso, o último login de cada pessoa e quantas sessões estão abertas.",
      },
    ],
  },
];
