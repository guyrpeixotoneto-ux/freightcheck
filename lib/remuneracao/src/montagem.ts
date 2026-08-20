import { COLUNA } from "./colunas";
import {
  BLOCOS_DO_CADASTRO,
  type BlocoDoCadastro,
  type LinhaDoCadastro,
  type Medida,
} from "./catalogo";
import {
  conferir,
  type Conferencia,
  type PlanilhaDeclarada,
  type ValorDeclarado,
} from "./informado";
import {
  contarFrota,
  medirAliquota,
  medirPisCofins,
  medirProporcaoDeDocumentos,
  resumoDeImpostos,
  type CavaloDaVigencia,
  type TrechoDaVigencia,
} from "./medicao";

/**
 * A montagem do cadastro: do material da vigência às linhas preenchidas.
 *
 * Função pura, como as de `medicao.ts` — recebe o que a vigência entregou e
 * devolve o cadastro montado. Quem vai ao banco é `leitura.ts`, e a separação é
 * o que permite testar as trinta linhas do cadastro contra material sintético,
 * sem Postgres.
 *
 * **A regra de ouro está em `resolver`: toda linha sai daqui com um estado
 * explícito.** Ou o número está lá com a memória de como se chegou nele, ou não
 * está e o motivo está escrito. Não existe terceira saída — nenhuma linha
 * devolve zero por não ter encontrado o dado, e nenhuma devolve número sem
 * dizer de onde veio.
 *
 * **O material tem duas metades, e elas não se misturam.** A primeira é o que a
 * vigência entregou — cavalos e trechos —, que produz linhas `APURADO`. A
 * segunda é o que alguém **declarou** ao cadastrar a planilha à mão, que produz
 * linhas `INFORMADO`. Onde as duas respondem a mesma linha, o valor da linha
 * continua sendo o medido e o declarado vira {@link Conferencia} ao lado dele:
 * a planilha de CAMAÇARI diz 56 cavalos ativos e o export da mesma vigência
 * traz 62, e é essa diferença — não um dos dois números sozinho — que quem
 * confere veio procurar.
 */

/** Como se chegou ao número. Sempre presente quando há número. */
export interface Procedencia {
  /** De onde saiu — "Trechos da vigência", "Frota de cavalos da vigência". */
  fonte: string;
  /** As colunas do export que o sustentam, pelo cabeçalho que a planilha usa. */
  colunas: string[];
  /** A regra aplicada, em português. */
  regra: string;
  /** Quantos registros entraram na conta. */
  registros: number;
}

/** Por que não há número. Sempre presente quando não há. */
export interface Ausencia {
  motivo: string;
  /** O que destravaria — sempre um dado ou uma decisão, nunca um prazo. */
  destrava: string;
  /** Onde olhar hoje, quando existe tela que chegue perto. */
  hoje?: { href: string; label: string; porque: string };
}

/**
 * Um número que vale para mais de uma linha ao mesmo tempo.
 *
 * Existe por causa de PIS e COFINS: o cadastro pede os dois em linhas
 * separadas e o export os traz somados. Rachar o par pela alíquota legal seria
 * simples e seria invenção; mostrar o par como par é a única leitura fiel.
 */
export interface Conjunto {
  /** "PIS + COFINS". */
  rotulo: string;
  /** As chaves que compartilham este número — todas, esta inclusive. */
  linhas: string[];
  valor: number;
  medida: Medida;
  procedencia: Procedencia;
  /**
   * A soma das partes declaradas contra o par medido.
   *
   * Só existe quando **todas** as partes foram informadas. Conferir o par
   * contra uma metade declarada compararia PIS + COFINS com PIS, e a
   * divergência resultante seria inteiramente artificial — a metade que falta.
   */
  conferencia: Conferencia | null;
}

export type EstadoDaLinha =
  /** O acervo sustenta esta linha, e o número está aqui. */
  | "APURADO"
  /**
   * O acervo não sustenta esta linha, e **alguém a informou** ao cadastrar a
   * planilha. O número é o declarado, com autor e data em `declarado`.
   */
  | "INFORMADO"
  /** O acervo sustenta a linha **junto com outra**, e o par está em `conjunto`. */
  | "EM_CONJUNTO"
  /** O acervo não sustenta esta linha. `ausencia` diz por quê. */
  | "SEM_LASTRO";

export interface LinhaApurada extends LinhaDoCadastro {
  estado: EstadoDaLinha;
  valor: number | null;
  procedencia: Procedencia | null;
  ausencia: Ausencia | null;
  conjunto: Conjunto | null;
  /**
   * O que a planilha declara para esta linha, quando alguém a preencheu.
   *
   * Independente do estado, e de propósito: numa linha `APURADO` ele é a
   * segunda opinião, e numa `INFORMADO` ele é a origem do próprio valor. Em
   * nenhum dos dois casos ele substitui o campo `valor` sem que a tela saiba.
   */
  declarado: ValorDeclarado | null;
  /** O medido contra o declarado. Só existe quando os dois respondem. */
  conferencia: Conferencia | null;
  /**
   * Se o **acervo** sustenta esta linha, independentemente do que a planilha
   * diga.
   *
   * Existe porque `estado` deixou de responder essa pergunta sozinho, e a
   * diferença é um defeito real que este campo previne: uma linha de PIS que o
   * export sustenta em par sai como `EM_CONJUNTO`, e passa a sair como
   * `INFORMADO` no dia em que alguém digitar a metade dela na aba. Deduzir a
   * cobertura do acervo a partir do estado faria a unidade **perder** lastro por
   * alguém ter preenchido a planilha — e a lista de unidades mandaria procurar
   * um arquivo que está lá.
   */
  lastroDoAcervo: boolean;
}

export interface BlocoApurado extends Omit<BlocoDoCadastro, "linhas"> {
  linhas: LinhaApurada[];
}

/** O material da vigência, já reduzido ao que o cadastro precisa. */
export interface MaterialDoCadastro {
  cavalos: CavaloDaVigencia[];
  trechos: TrechoDaVigencia[];
  /**
   * Se a vigência **declarou** entregar a série de trechos.
   *
   * Diferente de `trechos.length === 0`, e a diferença é a mesma que
   * `serieFoiEntregue` guarda na Frota: uma vigência que entregou a aba de
   * trechos vazia é dado; uma que não entregou a aba é a forma do arquivo. A
   * tela precisa dizer qual das duas aconteceu.
   */
  trechosEntregues: boolean;
  /**
   * O que alguém digitou da planilha desta vigência, por chave do catálogo.
   *
   * Opcional porque a montagem existia antes dela e continua respondendo sem
   * ela — um cadastro sem planilha informada é o cadastro de sempre, e é o que
   * os testes de medição exercitam.
   */
  declarados?: PlanilhaDeclarada;
}

export interface ResumoDoCadastro {
  linhas: number;
  apuradas: number;
  /** Linhas cujo número veio da planilha informada, e não do acervo. */
  informadas: number;
  emConjunto: number;
  /** Linhas sem número nenhum — nem medido, nem digitado. */
  semLastro: number;
  /**
   * Linhas que o **acervo** sustenta, sozinhas ou em par.
   *
   * Não é `apuradas + emConjunto`: uma linha do par que alguém informou sai
   * como `INFORMADO` e continua sendo sustentada pelo export. Ver
   * {@link LinhaApurada.lastroDoAcervo}.
   */
  comLastro: number;
  /** Linhas que o acervo e a planilha respondem — as que dá para conferir. */
  conferidas: number;
  /** Destas, quantas discordam. É o número que quem confere veio procurar. */
  divergentes: number;
}

export interface CadastroMontado {
  blocos: BlocoApurado[];
  resumo: ResumoDoCadastro;
}

/**
 * O que `resolver` devolve: o estado da linha e nada do catálogo.
 *
 * É um `Pick` e não um `Partial` de propósito. Com `Partial`, esquecer de
 * preencher `ausencia` numa linha sem lastro compilaria — e a tela receberia
 * uma linha muda, que é exatamente o defeito que este módulo existe para não
 * ter. Com os campos obrigatórios, o compilador cobra cada um.
 */
type Resolucao = Pick<
  LinhaApurada,
  "estado" | "valor" | "procedencia" | "ausencia" | "conjunto"
>;

const apurado = (valor: number, procedencia: Procedencia): Resolucao => ({
  estado: "APURADO",
  valor,
  procedencia,
  ausencia: null,
  conjunto: null,
});

const semLastro = (ausencia: Ausencia): Resolucao => ({
  estado: "SEM_LASTRO",
  valor: null,
  procedencia: null,
  ausencia,
  conjunto: null,
});

/** A ausência de quem depende dos trechos e não os tem. */
function semTrechos(oQue: string, trechosEntregues: boolean): Ausencia {
  return {
    motivo: trechosEntregues
      ? `A vigência entregou a série de trechos, mas nenhum deles traz as colunas em reais ` +
        `que ${oQue} exige — ${COLUNA.freteCtrc.cabecalho} e ${COLUNA.imposto.cabecalho}.`
      : `Esta vigência não entregou trechos. ${oQue} se mede sobre eles, e sobre nenhuma ` +
        "outra série do acervo.",
    destrava: trechosEntregues
      ? `As colunas ${COLUNA.freteCtrc.cabecalho} e ${COLUNA.imposto.cabecalho} importadas e ` +
        "classificadas na curadoria."
      : "A importação do export de frete desta unidade, na vigência aberta.",
    hoje: {
      href: "/importacoes",
      label: "Importações",
      porque: "O que já entrou no acervo desta unidade, arquivo a arquivo.",
    },
  };
}

/** A data do declarado, escrita como quem preenche a lê. */
function quando(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * A procedência de um número digitado — e ela nomeia quem digitou.
 *
 * "Informado no cadastro" sem autor seria a mesma frase vazia que este módulo
 * recusa nas ausências: quem confere precisa saber a quem perguntar. Quando a
 * conta não pôde ser identificada, a frase o diz, em vez de omitir o assunto.
 */
function procedenciaDoInformado(declarado: ValorDeclarado): Procedencia {
  const autor = declarado.autor ? `por ${declarado.autor}` : "por uma conta não identificada";
  return {
    fonte: "A planilha informada",
    colunas: [],
    regra:
      `Digitado no cadastro ${autor} em ${quando(declarado.informadoEm)}. Não é medida do ` +
      "acervo: nenhum arquivo desta vigência sustenta esta linha, e o número vale o que valer " +
      "a planilha de onde ele foi copiado." +
      (declarado.observacao ? ` Observação de quem informou: ${declarado.observacao}` : ""),
    registros: 0,
  };
}

/**
 * Monta o cadastro de uma vigência.
 *
 * A ordem dos blocos e das linhas é a do catálogo, que é a da planilha — e a
 * das somas depende disso: `Total Custo Frota Fixa sem imposto` lê as seis
 * linhas acima dela, que já passaram por aqui. Reordenar o catálogo quebraria a
 * soma, e é por isso que ela lê o mapa do que já foi resolvido em vez de
 * recalcular as parcelas por conta própria.
 */
export function montarCadastro(material: MaterialDoCadastro): CadastroMontado {
  const { cavalos, trechos, trechosEntregues } = material;
  const declarados: PlanilhaDeclarada = material.declarados ?? new Map();

  const frota = contarFrota(cavalos);
  const icms = medirAliquota(trechos, "ICMS");
  const iss = medirAliquota(trechos, "ISS");
  const pisCofins = medirPisCofins(trechos);
  const proporcao = medirProporcaoDeDocumentos(trechos);

  const FONTE_TRECHO = "Trechos da vigência";
  const FONTE_FROTA = "Frota de cavalos da vigência";

  const declaradoDe = (chave: string): number | null => declarados.get(chave)?.valor ?? null;

  /*
    O resumo de impostos é aritmética sobre as alíquotas **do próprio
    cadastro** — e o cadastro passou a ter duas fontes de alíquota. Quando a
    planilha declara PIS, COFINS, ICMS ou ISS, é o declarado que entra na conta,
    porque é o que a aba de fato usou para gerar o valor do documento naquela
    quinzena; é ele que reproduz o 84,85% impresso na planilha.

    O par PIS + COFINS só se forma da planilha quando **as duas** metades foram
    informadas. Com uma só, somar a metade declarada seria subestimar o tributo
    e inflar o divisor do gross-up — o erro cairia direto no valor de cada
    documento, e nada na tela diria de onde veio.
  */
  const pisDeclarado = declaradoDe("aliquota_pis");
  const cofinsDeclarado = declaradoDe("aliquota_cofins");
  const parDeclarado =
    pisDeclarado !== null && cofinsDeclarado !== null ? pisDeclarado + cofinsDeclarado : null;

  const aliquotaEfetiva = {
    pisCofins: parDeclarado ?? pisCofins?.percentual ?? null,
    icms: declaradoDe("aliquota_icms") ?? icms?.percentual ?? null,
    iss: declaradoDe("aliquota_iss") ?? iss?.percentual ?? null,
  };
  /** Se a alíquota que entrou na conta veio da planilha, e não do acervo. */
  const aliquotaInformada = {
    pisCofins: parDeclarado !== null,
    icms: declaradoDe("aliquota_icms") !== null,
    iss: declaradoDe("aliquota_iss") !== null,
  };
  const resumo = resumoDeImpostos(aliquotaEfetiva);

  const conjuntoPisCofins: Conjunto | null =
    pisCofins === null
      ? null
      : {
          rotulo: "PIS + COFINS",
          linhas: ["aliquota_pis", "aliquota_cofins"],
          valor: pisCofins.percentual,
          medida: "PERCENTUAL",
          procedencia: {
            fonte: FONTE_TRECHO,
            colunas: [COLUNA.pisCofins.cabecalho, COLUNA.freteCtrc.cabecalho],
            regra:
              `${COLUNA.pisCofins.cabecalho} somado sobre ${COLUNA.freteCtrc.cabecalho} somado, ` +
              "em todos os trechos da vigência. O export não separa PIS de COFINS.",
            registros: pisCofins.trechos,
          },
          conferencia:
            parDeclarado === null
              ? null
              : conferir(pisCofins.percentual, parDeclarado, "PERCENTUAL"),
        };

  const resolvidas = new Map<string, LinhaApurada>();

  const blocos: BlocoApurado[] = BLOCOS_DO_CADASTRO.map((bloco) => ({
    ...bloco,
    linhas: bloco.linhas.map((linha) => {
      const apuradaLinha: LinhaApurada = {
        ...linha,
        ...comOInformado(linha, resolver(linha)),
      };
      resolvidas.set(linha.chave, apuradaLinha);
      return apuradaLinha;
    }),
  }));

  return { blocos, resumo: contarResumo(blocos) };

  /**
   * A resolução do cadastro, somada ao que a planilha declara.
   *
   * Uma regra só, e ela é a decisão inteira deste arquivo: **quem já tem número
   * fica com ele.** Se o cadastro chegou a um valor sem a planilha — medindo o
   * acervo, ou derivando de linhas que o mediram —, esse valor continua sendo o
   * da linha e o declarado vira {@link Conferencia} ao lado. Só onde o cadastro
   * não chegou a número nenhum é que o declarado passa a ser o valor, e aí a
   * linha vira `INFORMADO`, com a procedência que nomeia quem digitou.
   *
   * Deixar o digitado ganhar do apurado apagaria a divergência, que é o achado:
   * a planilha de CAMAÇARI diz 56 cavalos ativos e o export da mesma vigência
   * traz 62. E a regra vale também para as linhas derivadas, que é onde ela
   * rende mais — o `Total Custo Frota Fixa sem imposto` que a soma das seis
   * parcelas produz, conferido contra o total impresso na aba, é a prova de que
   * a planilha inteira foi transcrita certa.
   *
   * Quando a linha vira `INFORMADO`, a ausência sai — ela deixou de descrever a
   * linha, que agora tem número. O que ela dizia sobre o **acervo** continua
   * verdadeiro, e continua na tela pela procedência, que diz por extenso que
   * este número não é medida.
   */
  function comOInformado(
    linha: LinhaDoCadastro,
    resolucao: Resolucao,
  ): Resolucao & Pick<LinhaApurada, "declarado" | "conferencia" | "lastroDoAcervo"> {
    /*
      A cobertura do acervo é lida **antes** da fusão, e é a única forma de ela
      sobreviver a ela: depois, `INFORMADO` não distingue a linha que o export
      sustentava em par da que ele nunca sustentou.
    */
    const lastroDoAcervo =
      resolucao.estado === "APURADO" || resolucao.estado === "EM_CONJUNTO";

    const declarado = declarados.get(linha.chave) ?? null;
    if (declarado === null) {
      return { ...resolucao, declarado: null, conferencia: null, lastroDoAcervo };
    }

    if (resolucao.valor !== null) {
      return {
        ...resolucao,
        declarado,
        conferencia: conferir(resolucao.valor, declarado.valor, linha.medida),
        lastroDoAcervo,
      };
    }

    return {
      estado: "INFORMADO",
      valor: declarado.valor,
      procedencia: procedenciaDoInformado(declarado),
      ausencia: null,
      /*
        O par medido continua junto quando existe: numa linha de PIS declarada,
        o `EM_CONJUNTO` que ela era é a segunda medida da mesma coisa, e a
        conferência do par contra as duas metades declaradas vive lá dentro.
      */
      conjunto: resolucao.conjunto,
      declarado,
      conferencia: null,
      lastroDoAcervo,
    };
  }

  function resolver(linha: LinhaDoCadastro): Resolucao {
    const { origem } = linha;

    switch (origem.tipo) {
      case "CONTAGEM_DE_FROTA": {
        if (frota.total === 0) {
          return semLastro({
            motivo: "Esta vigência não entregou cavalos — não há frota a contar.",
            destrava: "A importação do export de equipamento desta unidade, na vigência aberta.",
            hoje: {
              href: "/importacoes",
              label: "Importações",
              porque: "O que já entrou no acervo desta unidade, arquivo a arquivo.",
            },
          });
        }
        /*
          Sem a coluna `ativo`, os três recortes desabam juntos: ativos e
          inativos ficariam sem critério e a operação viraria a contagem bruta,
          que é o número certo com o significado errado.
        */
        if (frota.operacao === 0) {
          return semLastro({
            motivo:
              `Os ${frota.total} cavalos da vigência chegaram sem a coluna ` +
              `${COLUNA.ativo.cabecalho}. Sem ela não há como separar frota ativa de parada, e ` +
              "a contagem bruta diria outra coisa sob este rótulo.",
            destrava:
              `A coluna ${COLUNA.ativo.cabecalho} no export de equipamento, classificada na ` +
              "curadoria.",
            hoje: {
              href: "/frota-360",
              label: "Frota 360°",
              porque: "A frota inteira da vigência, veículo a veículo.",
            },
          });
        }

        const valor =
          origem.recorte === "ATIVOS"
            ? frota.ativos
            : origem.recorte === "INATIVOS"
              ? frota.inativos
              : frota.operacao;

        const ressalva =
          frota.semResposta > 0
            ? ` ${frota.semResposta} de ${frota.total} não trouxeram a coluna e ficaram fora ` +
              "dos três recortes — não foram contados como inativos."
            : "";

        return apurado(valor, {
          fonte: FONTE_FROTA,
          colunas: [COLUNA.ativo.cabecalho],
          regra:
            origem.recorte === "OPERACAO"
              ? `Ativos mais inativos.${ressalva}`
              : `Cavalos da vigência com ${COLUNA.ativo.cabecalho} ` +
                `${origem.recorte === "ATIVOS" ? "verdadeiro" : "falso"}.${ressalva}`,
          registros: frota.total,
        });
      }

      case "ALIQUOTA_DECLARADA": {
        const medida = origem.tributo === "ICMS" ? icms : iss;
        if (medida === null) {
          return semLastro(
            semTrechos(`A alíquota de ${origem.tributo}`, trechosEntregues),
          );
        }
        const divergencia =
          medida.declarados.length > 1
            ? ` A coluna ${COLUNA.percentualDeclarado.cabecalho} traz ${medida.declarados.length} ` +
              "valores distintos nestes trechos: a alíquota varia por trecho, e a medida acima é " +
              "a do conjunto, ponderada pelo valor de cada documento."
            : "";
        return apurado(medida.percentual, {
          fonte: FONTE_TRECHO,
          colunas: [
            COLUNA.imposto.cabecalho,
            COLUNA.freteCtrc.cabecalho,
            COLUNA.tributo.cabecalho,
          ],
          regra:
            `${COLUNA.imposto.cabecalho} somado sobre ${COLUNA.freteCtrc.cabecalho} somado, nos ` +
            `trechos com ${COLUNA.tributo.cabecalho} = ${origem.tributo}. Medida em reais, e ` +
            `não lida de ${COLUNA.percentualDeclarado.cabecalho}, porque uma coluna de ` +
            "percentual não diz se vem em pontos ou em fração." +
            divergencia,
          registros: medida.trechos,
        });
      }

      case "ALIQUOTA_CONJUNTA_PIS_COFINS": {
        if (conjuntoPisCofins === null) {
          return semLastro(semTrechos(`A alíquota de ${origem.parte}`, trechosEntregues));
        }
        return {
          estado: "EM_CONJUNTO",
          valor: null,
          procedencia: null,
          conjunto: conjuntoPisCofins,
          ausencia: {
            motivo:
              `O export soma PIS e COFINS em ${COLUNA.pisCofins.cabecalho}, e nenhuma coluna ` +
              `traz ${origem.parte} isolado. O par foi medido e está acima; rachá-lo pela ` +
              "alíquota da lei federal traria para dentro do produto uma premissa que nenhum " +
              "arquivo do cliente sustenta.",
            destrava:
              "Duas colunas separadas no export de frete, ou a alíquota de um dos dois " +
              "informada no cadastro da planilha — que é o que este produto passou a aceitar.",
          },
        };
      }

      case "PROPORCAO_DE_DOCUMENTOS": {
        if (proporcao === null) {
          return semLastro({
            motivo: trechosEntregues
              ? `Nenhum trecho desta vigência declara ${COLUNA.tributo.cabecalho}; sem ele não ` +
                "há dentro nem fora do município a proporcionar."
              : "Esta vigência não entregou trechos, e a proporção se conta sobre eles.",
            destrava: `A coluna ${COLUNA.tributo.cabecalho} importada e classificada na curadoria.`,
            hoje: {
              href: "/importacoes",
              label: "Importações",
              porque: "O que já entrou no acervo desta unidade, arquivo a arquivo.",
            },
          });
        }
        const porViagens = proporcao.criterio === "VIAGENS_PREVISTAS";
        const ressalva =
          proporcao.semTributo > 0
            ? ` ${proporcao.semTributo} trecho(s) ficaram fora por não declarar ` +
              `${COLUNA.tributo.cabecalho}.`
            : "";
        return apurado(origem.dentroDoMunicipio ? proporcao.dentro : proporcao.fora, {
          fonte: FONTE_TRECHO,
          colunas: porViagens
            ? [COLUNA.tributo.cabecalho, COLUNA.previsaoViagens.cabecalho]
            : [COLUNA.tributo.cabecalho],
          regra: porViagens
            ? `Viagens previstas dos trechos com ${COLUNA.tributo.cabecalho} = ` +
              `${origem.dentroDoMunicipio ? "ISS" : "ICMS"} sobre o total de viagens previstas. ` +
              "É a medida que a planilha pede — quantidade de documentos, não de rotas." +
              ressalva
            : `Trechos com ${COLUNA.tributo.cabecalho} = ` +
              `${origem.dentroDoMunicipio ? "ISS" : "ICMS"} sobre o total de trechos. Contados ` +
              `por cabeça, e não por documento, porque ${COLUNA.previsaoViagens.cabecalho} não ` +
              "veio em todos — a rota de quarenta viagens pesa o mesmo que a de duas." +
              ressalva,
          registros: trechos.length - proporcao.semTributo,
        });
      }

      case "RESUMO_DE_IMPOSTOS": {
        const valor = origem.tributo === "ISS" ? resumo.dentro : resumo.fora;
        if (valor === null) {
          const faltando = [
            aliquotaEfetiva.pisCofins === null ? "PIS + COFINS" : null,
            origem.tributo === "ISS"
              ? aliquotaEfetiva.iss === null
                ? "ISS"
                : null
              : aliquotaEfetiva.icms === null
                ? "ICMS"
                : null,
          ].filter((x): x is string => x !== null);
          return semLastro({
            motivo:
              `Esta linha é aritmética sobre as alíquotas do próprio cadastro, e ` +
              `${faltando.join(" e ")} não pôde ser medida nem informada nesta vigência.`,
            destrava:
              "As alíquotas do bloco ALÍQUOTAS, acima — medidas pelo acervo ou informadas na " +
              "planilha. Resolvido lá, este resolve junto.",
          });
        }

        /*
          Quando qualquer das alíquotas da conta veio da planilha, o resultado
          herda a natureza dela: é `INFORMADO`, e não `APURADO`. Chamar de
          apurado um percentual construído sobre um número digitado seria
          exatamente a mistura que o estado existe para impedir — e é o número
          por onde todo valor líquido passa para virar valor de documento.
        */
        const daPlanilha = [
          aliquotaInformada.pisCofins ? "PIS + COFINS" : null,
          origem.tributo === "ISS"
            ? aliquotaInformada.iss
              ? "ISS"
              : null
            : aliquotaInformada.icms
              ? "ICMS"
              : null,
        ].filter((x): x is string => x !== null);

        const procedencia: Procedencia = {
          fonte:
            daPlanilha.length > 0 ? "As alíquotas deste cadastro, informadas" : "As alíquotas deste cadastro",
          colunas: daPlanilha.length > 0 ? [] : [COLUNA.pisCofins.cabecalho, COLUNA.imposto.cabecalho],
          regra:
            `100% menos PIS + COFINS menos ${origem.tributo} — os tributos são por dentro, ` +
            "então é por este percentual que o valor líquido é dividido para virar valor de " +
            "documento." +
            (daPlanilha.length > 0
              ? ` ${daPlanilha.join(" e ")} ${daPlanilha.length === 1 ? "veio" : "vieram"} da ` +
                "planilha informada, e não do acervo."
              : ""),
          registros: 0,
        };

        return daPlanilha.length > 0
          ? { estado: "INFORMADO", valor, procedencia, ausencia: null, conjunto: null }
          : apurado(valor, procedencia);
      }

      case "SOMA_DE_LINHAS": {
        /*
          A parcela conta para o total quando tem número, medido ou informado. O
          contrário — exigir que as seis sejam apuradas — deixaria o total em
          branco na planilha inteira preenchida à mão, que é justamente o caso
          em que ele importa.
        */
        const parcelas = origem.parcelas.map((chave) => resolvidas.get(chave));
        const comNumero = (linha: LinhaApurada | undefined) =>
          linha?.estado === "APURADO" || linha?.estado === "INFORMADO";

        const faltando = origem.parcelas.filter((chave) => !comNumero(resolvidas.get(chave)));
        if (faltando.length > 0) {
          const rotulos = faltando
            .map((chave) => resolvidas.get(chave)?.rotulo ?? chave)
            .map((r) => `"${r}"`);
          return semLastro({
            motivo:
              `Um total só fecha quando as suas parcelas fecham. ${faltando.length} das ` +
              `${origem.parcelas.length} continuam sem número: ${rotulos.join(", ")}.`,
            destrava:
              "As parcelas acima — medidas pelo acervo ou informadas na planilha. Somar as que " +
              "existem daria um total menor do que o real.",
          });
        }

        const informadas = parcelas.filter((p) => p?.estado === "INFORMADO").length;
        const valor = parcelas.reduce((soma, p) => soma + (p?.valor ?? 0), 0);
        const procedencia: Procedencia = {
          fonte: "Este cadastro",
          colunas: [],
          regra:
            `A soma das ${origem.parcelas.length} linhas deste bloco.` +
            (informadas > 0
              ? ` ${informadas} ${informadas === 1 ? "delas veio" : "delas vieram"} da planilha ` +
                "informada, e o total herda isso: um total sobre número digitado é número " +
                "digitado."
              : ""),
          registros: origem.parcelas.length,
        };
        const arredondado = Math.round((valor + Number.EPSILON) * 100) / 100;

        return informadas > 0
          ? {
              estado: "INFORMADO",
              valor: arredondado,
              procedencia,
              ausencia: null,
              conjunto: null,
            }
          : apurado(arredondado, procedencia);
      }

      case "SEM_ORIGEM":
        return semLastro({
          motivo: origem.motivo,
          destrava: origem.destrava,
          ...(origem.hoje ? { hoje: origem.hoje } : {}),
        });
    }
  }
}

function contarResumo(blocos: BlocoApurado[]): ResumoDoCadastro {
  const linhas = blocos.flatMap((b) => b.linhas);
  const conferidas = linhas.filter((l) => l.conferencia !== null);

  /*
    O par PIS + COFINS conta como **uma** conferência, e não como duas.

    As duas linhas carregam o mesmo `conjunto`, e portanto a mesma conferência:
    contá-la por linha diria "duas divergentes" sobre um desacordo só, e o
    placar da tela — que é o que decide se alguém vai investigar — passaria a
    exagerar exatamente na linha em que o produto pede confiança. A
    deduplicação é pelo rótulo do par, que é o que identifica o conjunto.
  */
  const conjuntos = new Map(
    linhas
      .filter((l) => l.conjunto?.conferencia)
      .map((l) => [l.conjunto!.rotulo, l.conjunto!.conferencia!]),
  );

  return {
    linhas: linhas.length,
    apuradas: linhas.filter((l) => l.estado === "APURADO").length,
    informadas: linhas.filter((l) => l.estado === "INFORMADO").length,
    emConjunto: linhas.filter((l) => l.estado === "EM_CONJUNTO").length,
    semLastro: linhas.filter((l) => l.estado === "SEM_LASTRO").length,
    comLastro: linhas.filter((l) => l.lastroDoAcervo).length,
    conferidas: conferidas.length + conjuntos.size,
    divergentes:
      conferidas.filter((l) => l.conferencia?.bate === false).length +
      [...conjuntos.values()].filter((c) => !c.bate).length,
  };
}
