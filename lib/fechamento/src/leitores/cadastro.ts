import * as XLSX from "xlsx";

import type { ParametrosDoCadastro } from "../mapa-rota";

/**
 * A aba `Cadastro` da planilha de remuneração — os parâmetros do contrato.
 *
 * **Por que esta fonte existe.** As cinco linhas de custo fixo do `RESUMO
 * GERAL` — que são dois terços do dinheiro do mês — não saem de nenhum dos seis
 * relatórios da Ambev. Elas são calculadas da frota contratada e da tarifa por
 * veículo, que vivem só aqui. Sem esta aba o fechamento não tem como
 * reconstruir o fixo; com ela, reconstrói ao centavo (ver
 * `__tests__/mapa-rota.test.ts`).
 *
 * **Por rótulo, e não por célula.** `Cadastro!C18` é onde a remuneração da
 * frota ativa está *nesta* cópia da planilha. Uma linha inserida acima move
 * todas as outras, e um leitor por endereço passaria a ler o número errado sem
 * reclamar — que é o modo de falhar mais caro que existe aqui. Procurar o
 * rótulo custa uma varredura e falha alto quando o rótulo muda.
 *
 * **Duas colunas, duas quinzenas.** O bloco da esquerda (rótulo em `B`, valor
 * em `C`) é a 1ª quinzena; o da direita (rótulo em `E`, valor em `F`) é a 2ª.
 * São os mesmos rótulos nos dois, e é por isso que a busca é por bloco: casar
 * só pelo texto acharia sempre o da esquerda.
 */

/** O rótulo pedido não existe na aba — com o que existe, para quem for corrigir. */
export class RotuloDoCadastroNaoEncontrado extends Error {
  constructor(
    readonly rotulo: string,
    readonly quinzena: 1 | 2,
  ) {
    super(
      `A aba Cadastro não traz "${rotulo}" na coluna da ${quinzena}ª quinzena. ` +
        `Sem ele o custo fixo da quinzena não pode ser reconstruído.`,
    );
    this.name = "RotuloDoCadastroNaoEncontrado";
  }
}

/** A aba não está na planilha enviada. */
export class CadastroNaoEncontrado extends Error {
  constructor(readonly abas: string[]) {
    super(
      `A planilha não tem a aba "Cadastro". Abas encontradas: ${abas.join(", ") || "nenhuma"}.`,
    );
    this.name = "CadastroNaoEncontrado";
  }
}

const NOME_DA_ABA = "Cadastro";

/** O mesmo rótulo, comparável: sem acento, sem caixa, sem espaço duplo, sem `=>`. */
function chaveDoRotulo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/=>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Os rótulos de um bloco, mapeados ao valor da coluna ao lado.
 *
 * Um rótulo repetido dentro do mesmo bloco não é resolvido por posição: a
 * primeira ocorrência vence e a segunda é ignorada, o que manteria um número
 * errado de pé em silêncio. Por isso a repetição é registrada e
 * {@link lerParametroDoCadastro} recusa lê-la.
 */
function blocoDe(
  aba: XLSX.WorkSheet,
  colunaDoRotulo: string,
  colunaDoValor: string,
): { valores: Map<string, unknown>; repetidos: Set<string> } {
  const valores = new Map<string, unknown>();
  const repetidos = new Set<string>();
  const referencia = aba["!ref"];
  if (!referencia) return { valores, repetidos };

  const area = XLSX.utils.decode_range(referencia);
  for (let linha = area.s.r; linha <= area.e.r; linha += 1) {
    const numero = linha + 1;
    const celulaDoRotulo = aba[`${colunaDoRotulo}${numero}`];
    if (!celulaDoRotulo || typeof celulaDoRotulo.v !== "string") continue;
    const chave = chaveDoRotulo(celulaDoRotulo.v);
    if (chave === "") continue;
    if (valores.has(chave)) {
      repetidos.add(chave);
      continue;
    }
    valores.set(chave, aba[`${colunaDoValor}${numero}`]?.v ?? null);
  }
  return { valores, repetidos };
}

/**
 * Os rótulos que o cadastro precisa ter, por campo.
 *
 * São os literais da planilha, acento por acento — a mesma disciplina do
 * de-para. `opcional` marca o que a planilha real deixa em branco: o lucro
 * operacional previsto e o marketing vêm vazios em julho/2026, e vazio ali é
 * zero de verdade (a linha existe e não valeu nada), não ausência de cadastro.
 */
const CAMPOS: {
  campo: keyof ParametrosDoCadastro | "custoVariavelPrevistoPor25Viagens" | "lucroOperacionalPrevisto";
  rotulo: string;
  opcional?: true;
}[] = [
  { campo: "frotaFixaAtiva", rotulo: "Total Frota Fixa Ativos" },
  { campo: "frotaFixaInativa", rotulo: "Total Frota Fixa Inativos" },
  { campo: "remuneracaoFixaDaFrotaAtiva", rotulo: "Remuneração Fixa - Frota Fixa Ativa" },
  { campo: "remuneracaoDaEquipeDeEntrega", rotulo: "Remuneração Fixa - Equipe Entrega" },
  { campo: "remuneracaoDoQlpAdministrativo", rotulo: "Remuneração Fixa - QLP Adm." },
  { campo: "remuneracaoDeOutrasDespesas", rotulo: "Remuneração - Outras Despesas" },
  { campo: "remuneracaoDaFrotaInativa", rotulo: "Remuneração Fixa - Frota Fixa Inativa" },
  { campo: "vansAtivas", rotulo: "Quantidade de Vans Ativas" },
  { campo: "custoFixoDaVan", rotulo: "Custo Fixo" },
  { campo: "custoDaEquipeDeEntregaDaVan", rotulo: "Custo Equipe Entrega" },
  { campo: "vansInativas", rotulo: "Quantidade de Vans Inativas" },
  { campo: "remuneracaoDasVansInativas", rotulo: "Remuneração Vans - Frota Vans Inativas" },
  { campo: "rotasNoturnas", rotulo: "Quantidade de Rotas Noturnas" },
  { campo: "custoDaNoturnaSemImposto", rotulo: "Custo Fixo sem impostos - Noturna" },
  { campo: "custoDeMarketingSemImposto", rotulo: "Custo Fixo sem impostos - Marketing", opcional: true },
  {
    campo: "custoVariavelPrevistoPor25Viagens",
    rotulo: "Custo Variável (para 25 viagens previstas)",
  },
  { campo: "lucroOperacionalPrevisto", rotulo: "Lucro Operacional Variável (previsto)", opcional: true },
];

const ALIQUOTAS: { campo: keyof ParametrosDoCadastro["aliquotas"]; rotulo: string }[] = [
  { campo: "pis", rotulo: "Alíquota PIS no Estado" },
  { campo: "cofins", rotulo: "Alíquota COFINS no Estado" },
  { campo: "icms", rotulo: "Alíquota ICMS no Estado" },
  { campo: "iss", rotulo: "Alíquota ISS no Município" },
];

const PARCELA_ISS = "% de viagens dentro do Município - ISS";

/** O que uma quinzena traz do cadastro — os parâmetros e o previsto do variável. */
export interface CadastroDaQuinzena {
  quinzena: 1 | 2;
  parametros: ParametrosDoCadastro;
  /**
   * `Custo Variável (para 25 viagens previstas)` mais o lucro previsto.
   *
   * Vai à parte dos parâmetros porque não é custo fixo: é o que
   * {@link somarVariavel} divide por 25 para achar o valor padrão de um
   * veículo. A planilha soma as duas células antes de dividir, e é por isso
   * que elas chegam somadas aqui.
   */
  custoVariavelPrevistoPor25Viagens: number;
}

function numero(valor: unknown, rotulo: string, quinzena: 1 | 2, opcional?: true): number {
  if (valor === null || valor === undefined || valor === "") {
    if (opcional) return 0;
    throw new RotuloDoCadastroNaoEncontrado(rotulo, quinzena);
  }
  const lido = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  if (!Number.isFinite(lido)) throw new RotuloDoCadastroNaoEncontrado(rotulo, quinzena);
  return lido;
}

/**
 * Lê as duas quinzenas da aba `Cadastro`.
 *
 * Devolve as duas sempre: a coluna da 2ª quinzena existe no arquivo desde o
 * início do mês, e recusá-la enquanto a quinzena não fecha esconderia do
 * usuário que o parâmetro já está lá — que é justamente o que ele precisa
 * conferir antes de a conta rodar.
 */
export function lerCadastro(arquivo: Buffer | ArrayBuffer): CadastroDaQuinzena[] {
  const pasta = XLSX.read(arquivo, { type: "buffer", sheets: [NOME_DA_ABA] });
  const aba = pasta.Sheets[NOME_DA_ABA];
  if (!aba) throw new CadastroNaoEncontrado(pasta.SheetNames ?? []);

  return ([1, 2] as const).map((quinzena) => {
    const { valores, repetidos } = blocoDe(
      aba,
      quinzena === 1 ? "B" : "E",
      quinzena === 1 ? "C" : "F",
    );

    const ler = (rotulo: string, opcional?: true) => {
      const chave = chaveDoRotulo(rotulo);
      if (repetidos.has(chave)) throw new RotuloDoCadastroNaoEncontrado(rotulo, quinzena);
      if (!valores.has(chave)) {
        if (opcional) return 0;
        throw new RotuloDoCadastroNaoEncontrado(rotulo, quinzena);
      }
      return numero(valores.get(chave), rotulo, quinzena, opcional);
    };

    const lidos = Object.fromEntries(
      CAMPOS.map(({ campo, rotulo, opcional }) => [campo, ler(rotulo, opcional)]),
    ) as Record<string, number>;

    /* Escrito campo a campo, e não por `fromEntries`: o compilador precisa ver
       que as quatro alíquotas existem — é ele quem pega a que for esquecida. */
    const porAliquota = new Map(ALIQUOTAS.map(({ campo, rotulo }) => [campo, ler(rotulo)]));
    const aliquotas: ParametrosDoCadastro["aliquotas"] = {
      pis: porAliquota.get("pis")!,
      cofins: porAliquota.get("cofins")!,
      icms: porAliquota.get("icms")!,
      iss: porAliquota.get("iss")!,
    };

    const parametros: ParametrosDoCadastro = {
      aliquotas,
      parcelaDentroDoMunicipio: ler(PARCELA_ISS),
      frotaFixaAtiva: lidos.frotaFixaAtiva!,
      frotaFixaInativa: lidos.frotaFixaInativa!,
      remuneracaoFixaDaFrotaAtiva: lidos.remuneracaoFixaDaFrotaAtiva!,
      remuneracaoDaEquipeDeEntrega: lidos.remuneracaoDaEquipeDeEntrega!,
      remuneracaoDoQlpAdministrativo: lidos.remuneracaoDoQlpAdministrativo!,
      remuneracaoDeOutrasDespesas: lidos.remuneracaoDeOutrasDespesas!,
      remuneracaoDaFrotaInativa: lidos.remuneracaoDaFrotaInativa!,
      vansAtivas: lidos.vansAtivas!,
      custoFixoDaVan: lidos.custoFixoDaVan!,
      custoDaEquipeDeEntregaDaVan: lidos.custoDaEquipeDeEntregaDaVan!,
      vansInativas: lidos.vansInativas!,
      remuneracaoDasVansInativas: lidos.remuneracaoDasVansInativas!,
      rotasNoturnas: lidos.rotasNoturnas!,
      custoDaNoturnaSemImposto: lidos.custoDaNoturnaSemImposto!,
      custoDeMarketingSemImposto: lidos.custoDeMarketingSemImposto!,
    };

    return {
      quinzena,
      parametros,
      custoVariavelPrevistoPor25Viagens:
        lidos.custoVariavelPrevistoPor25Viagens! + lidos.lucroOperacionalPrevisto!,
    };
  });
}
