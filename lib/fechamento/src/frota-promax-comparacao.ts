import type { VeiculoDaFrotaPromax } from "./leitores/frota-promax";

/**
 * A CONFERÊNCIA DE FROTA — Promax contra o que o contrato declara.
 *
 * **Este módulo é puro, e não é financeiro.** Ele não soma dinheiro, não forma
 * devido, não demonstra pagamento — conta veículos, de um lado, e compara com
 * uma contagem de referência, do outro. Nenhuma função aqui é importada por
 * `apuracao.ts`, `reconciliacao.ts` ou `painel-referencia.ts`, e
 * `contaminacao.test.ts` prende essa fronteira: se um dia uma dessas rotinas
 * financeiras passar a importar este arquivo, o teste cai.
 *
 * **O sistema nunca decide sozinho qual número está certo.** Toda comparação
 * devolve os dois números — o do Promax e o da referência — e a diferença
 * entre eles. Não há "vence o maior", não há arredondamento para concordância:
 * a divergência é reportada, e quem resolve é uma pessoa.
 *
 * **Referências são uma lista nomeada, não um valor fixo.** A v1 só tem o
 * cadastro do contrato (`frotaFixaAtiva`, `frotaFixaInativa`, e as Vans quando
 * existirem), mas `Referencia.nome` é texto livre desde o início — o dia em
 * que o "Resumo SR Trans do FT" existir como segunda fonte, ele entra como
 * mais um item da lista, e nada neste arquivo muda de forma. Ver o TODO em
 * `dominio.ts` sobre a natureza exata desse resumo, ainda não confirmada com a
 * Rebeca.
 *
 * **Conflito não é resolvido escolhendo um valor.** Duas linhas do mesmo
 * arquivo, para o mesmo grupo (unidade + modelo + situação), com contagens
 * discordantes — por exemplo a mesma placa aparecendo duas vezes com
 * `situacao` diferente dentro do que deveria ser uma leitura consistente — não
 * produzem uma contagem: produzem `quantidadePromax: null` e a evidência das
 * linhas em disputa, no mesmo espírito de
 * `descontoDeDisponibilidadeDoMes` em `leitores/disponibilidade.ts`.
 */

export type SituacaoDaFrota = "ATIVA" | "INATIVA";

/** O mesmo vocabulário de `@workspace/remuneracao/comparacao.ts`, replicado — não importado.
 *
 * Replicado, e não importado, porque `@workspace/fechamento` não depende de
 * `@workspace/remuneracao`: o Fechamento lê o contrato pelos parâmetros já
 * resolvidos (`frotaFixaAtiva` etc.), nunca pelo motor de cadastro. Criar essa
 * dependência só para reaproveitar um `type` inverteria a direção que o resto
 * do módulo já respeita.
 */
export type Movimento =
  /** As duas pontas têm número, e é o mesmo. */
  | "IGUAL"
  /** As duas pontas têm número, e o do Promax é maior. */
  | "SUBIU"
  /** As duas pontas têm número, e o do Promax é menor. */
  | "DESCEU"
  /** A referência não tinha número e o Promax trouxe. */
  | "GANHOU_LASTRO"
  /** A referência tinha número e o Promax não trouxe nada para o grupo. */
  | "PERDEU_LASTRO"
  /** Uma das duas pontas não é comparável — sem referência, ou em conflito. */
  | "SEM_COMPARACAO";

/** Uma fonte de referência nomeada — o contrato hoje, e mais fontes amanhã. */
export interface Referencia {
  /** `"Cadastro do contrato"` — o que aparece na tela ao lado do número. */
  nome: string;
  /** A quantidade que esta referência declara para o grupo. `null`: não se aplica. */
  quantidade: number | null;
}

/** Duas linhas do Promax discordando dentro do mesmo grupo — sem total escolhido. */
export interface ConflitoDeFrotaPromax {
  unidade: string;
  modelo: string;
  situacao: SituacaoDaFrota;
  /** As linhas físicas em disputa, com a quantidade que cada uma sustentava. */
  evidencia: { linha: number; placa: string }[];
}

export interface GrupoDeFrotaComparado {
  unidade: string;
  /** O modelo/categoria, como o Promax escreve — agrupador, não fonte separada. */
  modelo: string;
  situacao: SituacaoDaFrota;
  /**
   * Quantos veículos distintos (por placa) o Promax lista neste grupo.
   *
   * `null` quando o grupo está em conflito — ver {@link ConflitoDeFrotaPromax}.
   * Zero é uma contagem **medida**: o grupo existe e não tem veículo nenhum.
   */
  quantidadePromax: number | null;
  /** As referências comparadas contra este grupo — hoje, o contrato; amanhã, mais de uma. */
  referencias: (Referencia & {
    diferenca: number | null;
    movimento: Movimento;
  })[];
}

export interface ComparacaoDeFrotaPromax {
  grupos: GrupoDeFrotaComparado[];
  conflitos: ConflitoDeFrotaPromax[];
}

/** O agrupador — o mesmo texto de unidade e de modelo é o mesmo grupo. */
function chaveDoGrupo(v: { unidade: string; modelo: string; situacao: SituacaoDaFrota }): string {
  return `${v.unidade.trim().toUpperCase()} ${v.modelo.trim().toUpperCase()} ${v.situacao}`;
}

/**
 * Agrupa os veículos do Promax por (unidade, modelo, situação) e conta placas
 * distintas — devolvendo conflito quando a mesma placa aparece em situações
 * incompatíveis dentro do mesmo agrupamento lógico de unidade+modelo.
 *
 * **O que conta como conflito aqui.** Não é a placa repetida dentro do mesmo
 * grupo — isso é o normal de duas remessas do mesmo relatório, e a contagem
 * por `Set` já a absorve sem dobrar. É a placa que aparece **como ativa e como
 * inativa** para a mesma unidade e o mesmo modelo dentro da leitura que está
 * sendo comparada: os dois arquivos (01.22.02.00 e 01.22.08.00) discordando
 * sobre o mesmo veículo. Resolver escolhendo um dos dois seria sortear —
 * exatamente o que este módulo se recusa a fazer.
 */
export function agruparFrotaPromax(
  veiculos: VeiculoDaFrotaPromax[],
): { contagens: Map<string, { unidade: string; modelo: string; situacao: SituacaoDaFrota; placas: Set<string> }>; conflitos: ConflitoDeFrotaPromax[] } {
  const porUnidadeModelo = new Map<
    string,
    Map<string, { linha: number; situacao: SituacaoDaFrota }[]>
  >();

  for (const v of veiculos) {
    const chaveUM = `${v.unidade.trim().toUpperCase()} ${v.modelo.trim().toUpperCase()}`;
    const porPlaca = porUnidadeModelo.get(chaveUM) ?? new Map();
    const ocorrencias = porPlaca.get(v.placa) ?? [];
    ocorrencias.push({ linha: v.linha, situacao: v.situacao });
    porPlaca.set(v.placa, ocorrencias);
    porUnidadeModelo.set(chaveUM, porPlaca);
  }

  const contagens = new Map<
    string,
    { unidade: string; modelo: string; situacao: SituacaoDaFrota; placas: Set<string> }
  >();
  const conflitos: ConflitoDeFrotaPromax[] = [];

  for (const v of veiculos) {
    const chaveUM = `${v.unidade.trim().toUpperCase()} ${v.modelo.trim().toUpperCase()}`;
    const porPlaca = porUnidadeModelo.get(chaveUM)!;
    const ocorrencias = porPlaca.get(v.placa)!;
    const situacoes = new Set(ocorrencias.map((o) => o.situacao));

    if (situacoes.size > 1) {
      /* A placa está em conflito para este (unidade, modelo). Registra uma vez
         por (unidade, modelo) — não uma vez por placa em conflito, para não
         repetir o mesmo grupo em conflito várias vezes na lista. */
      const chaveConflito = `${chaveUM} CONFLITO`;
      if (!contagens.has(chaveConflito)) {
        const placasEmConflito = [...porPlaca.entries()]
          .filter(([, ocs]) => new Set(ocs.map((o) => o.situacao)).size > 1)
          .flatMap(([placa, ocs]) => ocs.map((o) => ({ linha: o.linha, placa })));
        conflitos.push({
          unidade: v.unidade,
          modelo: v.modelo,
          situacao: "ATIVA", // grupo em conflito cobre as duas situações — ver `evidencia`
          evidencia: placasEmConflito,
        });
        contagens.set(chaveConflito, {
          unidade: v.unidade,
          modelo: v.modelo,
          situacao: "ATIVA",
          placas: new Set(),
        });
      }
      continue;
    }

    const chave = chaveDoGrupo(v);
    const grupo = contagens.get(chave) ?? {
      unidade: v.unidade,
      modelo: v.modelo,
      situacao: v.situacao,
      placas: new Set<string>(),
    };
    grupo.placas.add(v.placa);
    contagens.set(chave, grupo);
  }

  return { contagens, conflitos };
}

function compararQuantidade(
  promax: number | null,
  referencia: number | null,
): { diferenca: number | null; movimento: Movimento } {
  if (promax === null && referencia === null) return { diferenca: null, movimento: "SEM_COMPARACAO" };
  if (promax === null) return { diferenca: null, movimento: "SEM_COMPARACAO" };
  if (referencia === null) return { diferenca: null, movimento: "GANHOU_LASTRO" };
  const diferenca = promax - referencia;
  if (diferenca === 0) return { diferenca: 0, movimento: "IGUAL" };
  return { diferenca, movimento: diferenca > 0 ? "SUBIU" : "DESCEU" };
}

/**
 * Compara a frota lida do Promax contra uma lista de referências nomeadas.
 *
 * `referenciasPorGrupo` decide, para cada grupo (unidade, modelo, situação),
 * quais referências se aplicam — é o que permite ao chamador (hoje,
 * `persistencia.ts`, comparando contra `frotaFixaAtiva`/`frotaFixaInativa`/
 * Vans do contrato) decidir a que nível a comparação faz sentido, sem que este
 * módulo precise saber nada sobre o formato do contrato.
 */
export function compararFrotaPromax(
  veiculos: VeiculoDaFrotaPromax[],
  referenciasPorGrupo: (grupo: {
    unidade: string;
    modelo: string;
    situacao: SituacaoDaFrota;
  }) => Referencia[],
): ComparacaoDeFrotaPromax {
  const { contagens, conflitos } = agruparFrotaPromax(veiculos);

  const grupos: GrupoDeFrotaComparado[] = [];
  for (const [chave, g] of contagens) {
    if (chave.endsWith(" CONFLITO")) {
      const referencias = referenciasPorGrupo({
        unidade: g.unidade,
        modelo: g.modelo,
        situacao: g.situacao,
      });
      grupos.push({
        unidade: g.unidade,
        modelo: g.modelo,
        situacao: g.situacao,
        quantidadePromax: null,
        referencias: referencias.map((r) => ({ ...r, diferenca: null, movimento: "SEM_COMPARACAO" })),
      });
      continue;
    }
    const quantidadePromax = g.placas.size;
    const referencias = referenciasPorGrupo({
      unidade: g.unidade,
      modelo: g.modelo,
      situacao: g.situacao,
    });
    grupos.push({
      unidade: g.unidade,
      modelo: g.modelo,
      situacao: g.situacao,
      quantidadePromax,
      referencias: referencias.map((r) => ({
        ...r,
        ...compararQuantidade(quantidadePromax, r.quantidade),
      })),
    });
  }

  grupos.sort((a, b) =>
    a.unidade === b.unidade
      ? a.modelo === b.modelo
        ? a.situacao.localeCompare(b.situacao)
        : a.modelo.localeCompare(b.modelo)
      : a.unidade.localeCompare(b.unidade),
  );

  return { grupos, conflitos };
}
