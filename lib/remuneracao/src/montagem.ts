import { COLUNA } from "./colunas";
import {
  BLOCOS_DO_CADASTRO,
  type BlocoDoCadastro,
  type LinhaDoCadastro,
  type Medida,
} from "./catalogo";
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
}

export type EstadoDaLinha =
  /** O acervo sustenta esta linha, e o número está aqui. */
  | "APURADO"
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
}

export interface ResumoDoCadastro {
  linhas: number;
  apuradas: number;
  emConjunto: number;
  semLastro: number;
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
 * ter. Com os cinco campos obrigatórios, o compilador cobra cada um.
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

  const frota = contarFrota(cavalos);
  const icms = medirAliquota(trechos, "ICMS");
  const iss = medirAliquota(trechos, "ISS");
  const pisCofins = medirPisCofins(trechos);
  const proporcao = medirProporcaoDeDocumentos(trechos);
  const resumo = resumoDeImpostos({
    pisCofins: pisCofins?.percentual ?? null,
    icms: icms?.percentual ?? null,
    iss: iss?.percentual ?? null,
  });

  const FONTE_TRECHO = "Trechos da vigência";
  const FONTE_FROTA = "Frota de cavalos da vigência";

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
        };

  const resolvidas = new Map<string, LinhaApurada>();

  const blocos: BlocoApurado[] = BLOCOS_DO_CADASTRO.map((bloco) => ({
    ...bloco,
    linhas: bloco.linhas.map((linha) => {
      const apuradaLinha: LinhaApurada = { ...linha, ...resolver(linha) };
      resolvidas.set(linha.chave, apuradaLinha);
      return apuradaLinha;
    }),
  }));

  return { blocos, resumo: contarResumo(blocos) };

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
              "registrada como parâmetro da unidade.",
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
            pisCofins === null ? "PIS + COFINS" : null,
            origem.tributo === "ISS"
              ? iss === null
                ? "ISS"
                : null
              : icms === null
                ? "ICMS"
                : null,
          ].filter((x): x is string => x !== null);
          return semLastro({
            motivo:
              `Esta linha é aritmética sobre as alíquotas do próprio cadastro, e ` +
              `${faltando.join(" e ")} não pôde ser medida nesta vigência.`,
            destrava: "As alíquotas do bloco ALÍQUOTAS, acima — resolvido lá, este resolve junto.",
          });
        }
        return apurado(valor, {
          fonte: "As alíquotas deste cadastro",
          colunas: [COLUNA.pisCofins.cabecalho, COLUNA.imposto.cabecalho],
          regra:
            `100% menos PIS + COFINS menos ${origem.tributo} — os tributos são por dentro, ` +
            "então é por este percentual que o valor líquido é dividido para virar valor de " +
            "documento.",
          registros: 0,
        });
      }

      case "SOMA_DE_LINHAS": {
        const parcelas = origem.parcelas.map((chave) => resolvidas.get(chave));
        const faltando = origem.parcelas.filter(
          (chave) => resolvidas.get(chave)?.estado !== "APURADO",
        );
        if (faltando.length > 0) {
          const rotulos = faltando
            .map((chave) => resolvidas.get(chave)?.rotulo ?? chave)
            .map((r) => `"${r}"`);
          return semLastro({
            motivo:
              `Um total só fecha quando as suas parcelas fecham. ${faltando.length} das ` +
              `${origem.parcelas.length} continuam sem lastro: ${rotulos.join(", ")}.`,
            destrava: "As parcelas acima. Somar as que existem daria um total menor do que o real.",
          });
        }
        const valor = parcelas.reduce((soma, p) => soma + (p?.valor ?? 0), 0);
        return apurado(Math.round((valor + Number.EPSILON) * 100) / 100, {
          fonte: "Este cadastro",
          colunas: [],
          regra: `A soma das ${origem.parcelas.length} linhas deste bloco.`,
          registros: origem.parcelas.length,
        });
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
  return {
    linhas: linhas.length,
    apuradas: linhas.filter((l) => l.estado === "APURADO").length,
    emConjunto: linhas.filter((l) => l.estado === "EM_CONJUNTO").length,
    semLastro: linhas.filter((l) => l.estado === "SEM_LASTRO").length,
  };
}
