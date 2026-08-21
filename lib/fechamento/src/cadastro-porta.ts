import type { Canal } from "./dominio";
import type { ParametrosDoCadastro } from "./mapa-rota";

/**
 * A PORTA DO CADASTRO — onde o contrato entra no fechamento.
 *
 * O motor (`mapa-rota.ts`) sabe calcular a remuneração devida a partir dos
 * parâmetros do contrato. O que ele não sabe — e não deve saber — é **de onde
 * esses parâmetros vêm**: de uma tabela versionada, de uma aba de planilha, de
 * uma rota de API. Esta interface é a costura entre as duas coisas.
 *
 * **Por que uma porta, e não uma consulta direta.** O módulo de cadastro está
 * sendo escrito agora, e a forma dele ainda vai mudar. Um `select` no meio de
 * `lerResumoDoMes` amarraria o fechamento ao esquema do cadastro no dia em que
 * ele nascesse, e cada mudança lá viraria uma mudança aqui. Com a porta, o
 * fechamento depende de uma pergunta — *quais eram os parâmetros deste trio
 * neste período?* — e quem responde é problema de quem implementa.
 *
 * **A pergunta é sempre sobre um período, nunca sobre "agora".** É esta
 * assinatura que impede um cadastro futuro de recalcular o passado: quem
 * resolve recebe o início e o fim da quinzena, e não a data de hoje. Ver
 * `docs/CADASTRO-COMO-FONTE.md`.
 */

/** O que o fechamento pergunta ao cadastro. */
export interface PerguntaAoCadastro {
  /**
   * A unidade canônica da competência. `null` enquanto ninguém a associou.
   *
   * **É por ela que o cadastro é encontrado, quando ela existe.** As três faixas
   * de casamento por texto (exato, aparado, documento) continuam existindo e
   * passaram a ser o *plano B*: elas atendem as competências históricas que
   * ainda não têm identidade. Uma competência com `unidadeId` não passa por
   * nenhuma delas — vai direto ao cadastro que aponta para a mesma unidade —, e
   * é isso que acaba com a adivinhação.
   */
  unidadeId: string | null;
  /** O texto legado. Ver `unidadeId`. */
  unidadeCodigo: string;
  transportadoraCodigo: string;
  canal: Canal;
  /** O primeiro dia da quinzena, `YYYY-MM-DD`. */
  inicio: string;
  /** O último dia da quinzena, `YYYY-MM-DD`. */
  fim: string;
}

/**
 * O que o cadastro responde.
 *
 * `null` é uma resposta legítima e comum — significa "não há cadastro vigente
 * que cubra este período", que é o estado de toda competência antes de alguém
 * subir o contrato. Quem chama trata a ausência nomeando-a, nunca preenchendo.
 */
export interface RespostaDoCadastro {
  parametros: ParametrosDoCadastro;
  /**
   * `Custo Variável (para 25 viagens previstas)` mais o lucro previsto — o que
   * o motor divide por 25 para achar o valor padrão de um veículo.
   */
  custoVariavelPrevistoPor25Viagens: number;
  /**
   * A identidade do cadastro usado, para a apuração fixá-la.
   *
   * É o que permite reler um fechamento apurado e obter os mesmos números,
   * mesmo depois de uma correção retroativa entrar. Ver o mecanismo 3 em
   * `docs/CADASTRO-COMO-FONTE.md`.
   */
  cadastroId: string;
  /** Desde quando este cadastro vale, `YYYY-MM-DD`. Para a tela dizer qual usou. */
  vigenteDe: string;
}


/* =========================================================================
 * O diagnóstico — qual das três portas fechou, e o que abre cada uma
 * ====================================================================== */

/**
 * Onde a resolução do cadastro parou.
 *
 * O contrato de uma unidade atravessa três portas, nesta ordem: **encontrar a
 * unidade** pelo código, **encontrar a vigência** que responde pela quinzena e
 * **montar o contrato** com as obrigatórias que a aba tem. Antes desta
 * distinção as três fechavam do mesmo jeito — `resolver` devolvia `null` — e a
 * tela escrevia a mesma frase para as três: *"nenhum cadastro respondeu por
 * esta unidade nesta competência"*. A frase é verdadeira nos três casos e não
 * serve em nenhum: quem não cadastrou a unidade, quem cadastrou e digitou a aba
 * no mês errado e quem digitou vinte das vinte e duas linhas leem a mesma coisa
 * e vão procurar em três lugares diferentes — sem que a tela diga qual.
 *
 * Cada estado abaixo tem um conserto próprio, e é isso que os separa. Ver
 * {@link comoDestravar}, que escreve os dois em português.
 */
export type EstadoDaResolucao =
  /** As três portas abriram: há contrato, e o devido sai dele. */
  | "RESPONDEU"
  /** O canal perguntado não tem contrato transcrito — hoje, tudo fora da Rota. */
  | "CANAL_SEM_CONTRATO"
  /** Nenhuma unidade registrada responde por este código. */
  | "UNIDADE_NAO_ENCONTRADA"
  /**
   * Mais de uma unidade registrada responde pelo código.
   *
   * Não é o mesmo que não encontrar, e por isso não compartilha o estado: aqui
   * há cadastro **demais**, e escolher um deles em silêncio — que é o que um
   * `LIMIT 1` faz — poria o contrato de uma unidade a responder pelo
   * fechamento de outra, sem nada na tela dizendo que houve escolha.
   */
  | "UNIDADE_AMBIGUA"
  /** A unidade existe e nenhuma aba do mês responde por esta quinzena. */
  | "SEM_VIGENCIA"
  /** A aba existe e faltam obrigatórias — o contrato não se monta. */
  | "CONTRATO_INCOMPLETO";

/**
 * Como o código da competência encontrou o código do cadastro.
 *
 * Os três são casamentos legítimos, e nenhum deles adivinha: o que os separa é
 * **o que foi ignorado** para casar, e cada linha abaixo diz por que ignorar
 * aquilo é seguro. A tela mostra qual foi, porque um casamento que não é
 * `EXATO` é uma diferença real entre dois cadastros que alguém vai querer
 * arrumar.
 */
export type ComoCasou =
  /**
   * Pela unidade canônica — as duas pontas apontam para o mesmo `unidade.id`.
   *
   * É o único casamento que não compara texto nenhum, e por isso o único que
   * não pode errar. Os três abaixo são o plano B das competências históricas.
   */
  | "IDENTIDADE"
  /** Byte a byte. */
  | "EXATO"
  /**
   * Só espaço em volta separava os dois.
   *
   * `normalizarCodigo`, em `@workspace/remuneracao`, é `trim()` e nada mais —
   * o código canônico da unidade é, por definição do próprio módulo, o
   * digitado sem o espaço em volta. Dois códigos que só diferem nisso são o
   * mesmo código, e recusá-los era o backend discordando da sua própria regra.
   */
  | "ESPACO"
  /**
   * Os dois são o mesmo documento, um com máscara e outro sem.
   *
   * `12.345.678/0001-99` e `12345678000199` são o mesmo CNPJ, e o Excel
   * entrega ora um ora outro — às vezes como número, perdendo o zero da
   * frente. É a normalização que `@workspace/ingest` já aplica ao escopo
   * canônico (`normalizeDocumento`), e ela só entra aqui quando **os dois
   * lados** têm documento: um código sem dígito nenhum normaliza para vazio, e
   * vazio casaria com todos os outros sem dígito.
   */
  | "DOCUMENTO";

/** A primeira porta: existe unidade registrada com este código. */
export interface PortaDaUnidade {
  /** O código que a competência trouxe, como ela o guarda. */
  codigoProcurado: string;
  /** Quantas unidades o cadastro tem ao todo — o denominador da frase. */
  cadastradas: number;
  /** Quantas responderam por este código. Zero não acha; mais de uma é ambígua. */
  candidatas: number;
  /** Como casou, quando casou uma só. */
  comoCasou: ComoCasou | null;
  /** O código como o **cadastro** o escreve — o que a tela põe ao lado. */
  codigoNoCadastro: string | null;
  /**
   * Os códigos que as unidades cadastradas de fato têm.
   *
   * **É o outro lado da comparação, e a sua falta era o ponto de confusão.** A
   * tela dizia "nenhuma das N unidades responde pelo código X" — verdade, e
   * metade da informação: quem lê fica sabendo o que se procurou e não o que
   * existe. E como as duas telas que gravam esse campo pedem coisas diferentes
   * (a de Remuneração pede o CNPJ da coluna `Unidade - CNPJ`; a competência
   * guarda o que alguém digitou ao abri-la), a pergunta seguinte é sempre a
   * mesma — *então qual é o código certo?* — e nada na tela respondia.
   *
   * Com os dois lados à vista, a resposta é olhar: de um lado o que a
   * competência procura, do outro o que está cadastrado. Não há regra a
   * decorar; há dois textos que precisam ser iguais.
   *
   * Vem limitada — ver `TETO_DE_CODIGOS` —, porque a lista serve para
   * reconhecer, não para inventariar.
   */
  codigosCadastrados: string[];
}

/**
 * Quantos códigos cadastrados o diagnóstico carrega.
 *
 * Poucos de propósito: a lista existe para quem tem duas ou três unidades
 * reconhecer a sua num relance. Num acervo de trinta, despejar as trinta
 * transformaria a explicação num paredão — e quem tem trinta abre a lista de
 * Remuneração, que é feita para isso.
 */
export const TETO_DE_CODIGOS = 5;

/** A segunda porta: alguma aba digitada responde por esta quinzena. */
export interface PortaDaVigencia {
  /** As vigências com aba digitada **no mês perguntado**. */
  doMes: string[];
  /**
   * Todas as vigências com aba digitada, de qualquer mês.
   *
   * Está aqui porque é a diferença entre "você não digitou nada" e "você
   * digitou no mês errado", e as duas chegavam à tela como a mesma ausência.
   */
  todas: string[];
  /** A que respondeu. `null` quando nenhuma. */
  vigenteDe: string | null;
  /** Respondeu a aba da outra metade do mês — a herança que a regra permite. */
  herdadaDaOutraQuinzena: boolean;
}

/** Uma linha da aba que o contrato precisa, com o rótulo que a tela mostra. */
export interface ChaveDoContrato {
  chave: string;
  rotulo: string;
}

/** A terceira porta: a aba tem as obrigatórias. */
export interface PortaDoContrato {
  /** As obrigatórias que não foram digitadas. Vazia quando há contrato. */
  faltam: ChaveDoContrato[];
  /**
   * As opcionais que não vieram e entraram como zero.
   *
   * Ditas, nunca escondidas: quem vê um `CUSTO FIXO - ESPECIAIS` sem a parcela
   * de marketing tem direito de saber que ela não foi digitada, em vez de
   * deduzir que o contrato não a tem.
   */
  assumidasComoZero: ChaveDoContrato[];
  /** Quantas linhas o contrato lê ao todo — o denominador de "faltam 3 de 22". */
  lidas: number;
}

/**
 * O que aconteceu nas três portas — a resposta que a tela escreve.
 *
 * As portas são avaliadas em ordem e param na primeira que fecha: `vigencia` é
 * `null` quando a unidade não foi encontrada, e `contrato` é `null` quando
 * nenhuma vigência respondeu. É de propósito que sejam `null` e não objetos
 * vazios — não se avalia o que não se chegou a perguntar, e um `faltam: []`
 * numa porta não alcançada diria "o contrato está completo".
 */
export interface DiagnosticoDoCadastro {
  estado: EstadoDaResolucao;
  unidade: PortaDaUnidade;
  vigencia: PortaDaVigencia | null;
  contrato: PortaDoContrato | null;
}

/**
 * O que a leitura do cadastro devolve: o contrato **e** por que não há um.
 *
 * As duas metades andam juntas porque a ausência é tão informativa quanto a
 * presença. Antes, `resolver` devolvia `RespostaDoCadastro | null`, e o `null`
 * atravessava o fechamento inteiro carregando uma informação só — *não tem* —,
 * quando quem o produziu sabia exatamente qual das três portas havia fechado.
 */
export interface LeituraDoCadastro {
  /** O contrato, quando as três portas abriram. `null` quando alguma fechou. */
  resposta: RespostaDoCadastro | null;
  diagnostico: DiagnosticoDoCadastro;
}

/**
 * O problema e o conserto, em português, para o estado dado.
 *
 * Mora aqui, e não na tela, por duas razões. A primeira é que é regra: qual é
 * o conserto de "faltam três linhas obrigatórias" é conhecimento do domínio, e
 * escrevê-lo no `.tsx` faria a próxima tela escrever outro. A segunda é que
 * assim ele é testável sem navegador — e um texto que manda a pessoa ao lugar
 * errado é um defeito tão real quanto um número errado.
 *
 * Devolve `null` para `RESPONDEU`: não há o que destravar quando o cadastro
 * respondeu, e um texto ali seria ruído numa tela que já tem o número.
 */
export function comoDestravar(
  d: DiagnosticoDoCadastro,
): { problema: string; conserto: string } | null {
  const u = d.unidade;
  switch (d.estado) {
    case "RESPONDEU":
      return null;

    case "CANAL_SEM_CONTRATO":
      return {
        problema:
          "O contrato transcrito no cadastro é o da Rota — a própria aba Cadastro " +
          "escreve QUANTIDADE DE DOCUMENTOS EMITIDOS - ROTA %.",
        conserto:
          "Nada, deste lado: responder por outro canal com os parâmetros da Rota " +
          "inventaria um contrato. O devido deste canal depende de o painel dele ser " +
          "transcrito.",
      };

    case "UNIDADE_NAO_ENCONTRADA": {
      /*
        Os dois lados na mesma frase. "Nenhuma responde por X" manda procurar
        sem dizer onde; "esta competência procura X, e o que está cadastrado é
        Y" mostra a diferença e acaba a procura.
      */
      const cadastrados = u.codigosCadastrados;
      return {
        problema:
          `Esta competência procura o cadastro pelo código "${u.codigoProcurado}", e ` +
          (u.cadastradas === 0
            ? "nenhuma unidade foi cadastrada em Remuneração ainda."
            : cadastrados.length === 0
              ? `nenhuma das ${u.cadastradas} unidades cadastradas em Remuneração tem código.`
              : `o que está cadastrado em Remuneração é ${cadastrados.map((c) => `"${c}"`).join(", ")}` +
                (u.cadastradas > cadastrados.length
                  ? ` e mais ${u.cadastradas - cadastrados.length}.`
                  : ".")),
        conserto:
          "Os dois textos precisam ser iguais — é só isso que o fechamento compara. " +
          "Espaço em volta e máscara de CNPJ já não impedem o encontro. Se a unidade foi " +
          "cadastrada sem código, informe o código dela na lista de Remuneração; se foi " +
          "cadastrada com outro, é ele que precisa virar o desta competência.",
      };
    }

    case "UNIDADE_AMBIGUA":
      return {
        problema:
          `${u.candidatas} unidades cadastradas respondem pelo código ` +
          `"${u.codigoProcurado}", e escolher uma delas poria o contrato de uma unidade ` +
          "a responder pelo fechamento de outra.",
        conserto:
          "Abra Remuneração e deixe uma só com este código — apague a duplicada ou " +
          "corrija o código da que não é esta.",
      };

    case "SEM_VIGENCIA": {
      const v = d.vigencia;
      const todas = v?.todas ?? [];
      return {
        problema:
          todas.length === 0
            ? "A unidade está cadastrada e nenhuma vigência tem linha da aba digitada."
            : "A unidade está cadastrada e nenhuma vigência **deste mês** tem aba " +
              `digitada — o que existe é ${todas.join(", ")}.`,
        conserto:
          todas.length === 0
            ? "Abra a unidade em Remuneração e digite a aba Cadastro da vigência."
            : "Digite a aba da vigência deste mês. A aba de uma quinzena responde pela " +
              "outra metade do mesmo mês; de um mês para outro, não — a frota " +
              "contratada muda, e herdar entre meses inventaria um contrato.",
      };
    }

    case "CONTRATO_INCOMPLETO": {
      const c = d.contrato;
      const faltam = c?.faltam ?? [];
      const nomes = faltam.map((f) => f.rotulo);
      return {
        problema:
          `A aba de ${d.vigencia?.vigenteDe ?? "a vigência"} está digitada e faltam ` +
          `${faltam.length} das ${c?.lidas ?? 0} linhas que o contrato lê: ` +
          `${nomes.join(", ")}.`,
        conserto:
          "Digite estas linhas na aba de Remuneração. Completá-las com zero produziria " +
          "um número que ninguém contratou, e a diferença contra o demonstrativo " +
          "passaria a medir a nossa omissão em vez da divergência real.",
      };
    }
  }
}

/**
 * Quem sabe responder pelo contrato de um período.
 *
 * O módulo de cadastro implementa isto. Enquanto ele não existe,
 * {@link SEM_CADASTRO} responde a tudo com a primeira porta fechada — e o
 * fechamento se comporta exatamente como se comportava antes desta porta
 * existir, dizendo por quê.
 */
export interface FonteDeCadastro {
  resolver(pergunta: PerguntaAoCadastro): Promise<LeituraDoCadastro>;
}

/** A unidade que ninguém procurou, para os estados que param antes da primeira porta. */
function nenhumaUnidade(codigoProcurado: string, cadastradas = 0): PortaDaUnidade {
  return {
    codigoProcurado,
    cadastradas,
    candidatas: 0,
    comoCasou: null,
    codigoNoCadastro: null,
    codigosCadastrados: [],
  };
}

/** O diagnóstico de quem parou na primeira porta. */
export function paradoNaUnidade(
  codigoProcurado: string,
  porta: Partial<PortaDaUnidade> = {},
): DiagnosticoDoCadastro {
  const unidade = { ...nenhumaUnidade(codigoProcurado), ...porta };
  return {
    estado: unidade.candidatas > 1 ? "UNIDADE_AMBIGUA" : "UNIDADE_NAO_ENCONTRADA",
    unidade,
    vigencia: null,
    contrato: null,
  };
}

/**
 * A fonte que ainda não existe.
 *
 * Não é um placeholder a ser removido: é o comportamento correto de um
 * ambiente que ainda não cadastrou contrato nenhum, e continuará sendo depois
 * — para a unidade cujo contrato ninguém subiu. Por isso ela responde com a
 * primeira porta fechada em vez de lançar: a ausência de cadastro é um estado
 * do negócio, não um defeito de instalação.
 */
export const SEM_CADASTRO: FonteDeCadastro = {
  async resolver(pergunta) {
    return { resposta: null, diagnostico: paradoNaUnidade(pergunta.unidadeCodigo) };
  },
};

/**
 * Uma fonte que responde de uma lista em memória — para teste e para a
 * conferência contra a planilha.
 *
 * A resolução é a mesma regra que o módulo de verdade terá de seguir: **a
 * vigência precisa cobrir a quinzena inteira**. Uma vigência que começa no meio
 * não serve, e aqui ela é simplesmente ignorada em vez de rateada — ratear
 * inventaria um contrato que ninguém assinou.
 */
export function cadastroEmMemoria(
  registros: (RespostaDoCadastro & {
    unidadeCodigo: string;
    transportadoraCodigo: string;
    canal: Canal;
    vigenteAte: string | null;
  })[],
): FonteDeCadastro {
  return {
    async resolver(pergunta) {
      const daUnidade = registros.filter(
        (r) =>
          r.unidadeCodigo === pergunta.unidadeCodigo &&
          r.transportadoraCodigo === pergunta.transportadoraCodigo &&
          r.canal === pergunta.canal,
      );
      if (daUnidade.length === 0) {
        return {
          resposta: null,
          diagnostico: paradoNaUnidade(pergunta.unidadeCodigo, {
            cadastradas: registros.length,
          }),
        };
      }

      const unidade: PortaDaUnidade = {
        codigoProcurado: pergunta.unidadeCodigo,
        cadastradas: registros.length,
        candidatas: 1,
        comoCasou: "EXATO",
        codigoNoCadastro: pergunta.unidadeCodigo,
        codigosCadastrados: [],
      };

      const cobre = daUnidade.filter(
        (r) => r.vigenteDe <= pergunta.inicio && (r.vigenteAte === null || r.vigenteAte >= pergunta.fim),
      );
      /* A mais recente que cobre — vigências sobrepostas são erro de escrita. */
      const escolhida = cobre.sort((a, b) => b.vigenteDe.localeCompare(a.vigenteDe))[0];
      const todas = [...new Set(daUnidade.map((r) => r.vigenteDe))].sort();
      if (!escolhida) {
        return {
          resposta: null,
          diagnostico: {
            estado: "SEM_VIGENCIA",
            unidade,
            vigencia: { doMes: [], todas, vigenteDe: null, herdadaDaOutraQuinzena: false },
            contrato: null,
          },
        };
      }

      return {
        resposta: {
          parametros: escolhida.parametros,
          custoVariavelPrevistoPor25Viagens: escolhida.custoVariavelPrevistoPor25Viagens,
          cadastroId: escolhida.cadastroId,
          vigenteDe: escolhida.vigenteDe,
        },
        diagnostico: {
          estado: "RESPONDEU",
          unidade,
          vigencia: {
            doMes: todas,
            todas,
            vigenteDe: escolhida.vigenteDe,
            herdadaDaOutraQuinzena: false,
          },
          contrato: { faltam: [], assumidasComoZero: [], lidas: 0 },
        },
      };
    },
  };
}
