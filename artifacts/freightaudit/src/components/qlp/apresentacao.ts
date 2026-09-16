import { formatBrl, formatNumber } from "@/lib/format";
import type { ChangeRow } from "@/components/changes/change-table";
import type { AtributoDoQuadro, ValorDeFato } from "./tipos";

/**
 * As decisões de apresentação da tela de QLP Administrativo — funções puras,
 * testáveis sem DOM (`__tests__/apresentacao.test.ts`).
 *
 * Nada aqui calcula diferença, impacto ou semântica: diffs vêm prontos do
 * motor de comparação canônico, e a semântica vem curada na resposta da API.
 * O que mora aqui é só o rearranjo para leitura — qual formato um valor usa,
 * como um rótulo de entidade se separa em unidade e cargo, como as linhas de
 * um change-set se agrupam por unidade.
 */

/**
 * As colunas que a tabela do quadro destaca, na ordem. O resto dos 35
 * atributos continua inteiro no detalhe do cargo — destacar não é descartar.
 * A escolha vem do dicionário: efetivo, salário e despesa de ordenados são o
 * coração da tabela, e o benchmark é a régua da auditoria bimestral.
 */
export const COLUNAS_DESTACADAS = [
  "qlp_administrativo.quantidade_ordenados",
  "qlp_administrativo.salario_ordenados",
  "qlp_administrativo.despesa_ordenados",
  "qlp_administrativo.qlp_benchmark_quantidade",
  "qlp_administrativo.qlp_benchmark_salario",
] as const;

/**
 * O valor de uma célula, no formato que a semântica **curada** sustenta.
 *
 * Só vira R$ quando a curadoria confirmou que a coluna é montante — antes
 * disso o número aparece como número, porque chamar de dinheiro o que ninguém
 * confirmou é interpretação. Ausência é "—", nunca zero.
 */
export function formatarValor(
  valor: ValorDeFato,
  atributo: Pick<AtributoDoQuadro, "semantica"> | undefined,
): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "string") return valor;
  if (atributo?.semantica.status === "CONFIRMED" && atributo.semantica.isMonetary === true) {
    return formatBrl(valor);
  }
  return formatNumber(valor, Number.isInteger(valor) ? 0 : 2);
}

/**
 * `"07.526.557/0015-05 · ANALISTA ADM"` → as partes da identidade, cada uma no
 * seu campo.
 *
 * A chave legível é a emenda das colunas de identidade do tipo, na ordem em que
 * elas compõem a chave (`lib/ingest/src/tipos.ts`): unidade + cargo no QLP
 * Administrativo, unidade + cargo + turno no Operacional. Devolver as três
 * separadas é o que permite a tabela dar uma **coluna** a cada uma; emendá-las
 * num campo só faria o operacional ler
 * `"Cargo: MOTORISTA 28 · Cargo: EQUIPE ATIVA 8x16"` sob o cabeçalho "Cargo",
 * que é a mesma sopa que a chave normalizada, só que com pontos.
 *
 * Um quarto pedaço (um tipo novo, ou uma versão da chave com mais colunas) fica
 * junto do turno em vez de sumir: a tela não sabe como ele se chama, mas
 * esconder um pedaço da identidade é pior do que escrevê-lo sem nome próprio.
 */
export function separarRotulo(entityLabel: string): {
  unidade: string;
  cargo: string;
  turno: string;
} {
  const partes = entityLabel.split(" · ");
  if (partes.length === 1) return { unidade: "", cargo: entityLabel, turno: "" };
  return {
    unidade: partes[0],
    cargo: partes[1],
    turno: partes.slice(2).join(" · "),
  };
}

/** A máscara padrão de um CNPJ, sobre os 14 dígitos. Formato, não interpretação. */
function mascararCnpj(digitos: string): string {
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
}

/** A mesma dobra da identidade canônica: maiúsculas, só `[A-Z0-9]`. */
function chaveDeCargo(cargo: string): string {
  return cargo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** O que a série já sabe sobre um cargo — vem da resposta da evolução. */
export interface CargoConhecido {
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
}

export interface MovimentosDaUnidade {
  unidade: string;
  entraram: string[];
  sairam: string[];
}

/**
 * Entradas e saídas de cargos, agrupadas por unidade — apresentação sobre as
 * linhas `ENTITY_ADDED`/`ENTITY_REMOVED` que o change-set canônico já
 * calculou. Nenhuma diferença é recalculada aqui: linhas de outros tipos são
 * ignoradas, e a ordem é alfabética para a leitura ser estável.
 *
 * O motor grava nessas linhas a chave **normalizada** da entidade
 * (`20618821000799AUXILIARADM`), não a forma legível — é o rótulo que todo o
 * produto usa, herdado do `identifier_value` (a legível mora em
 * `identifier_value_raw`; dívida registrada em `lib/qlp/src/index.ts`). Para a
 * leitura, o `dicionario` da própria série — que a tela já tem, da evolução —
 * devolve o nome como o arquivo o escreveu; sem correspondência, a chave é
 * aberta pela forma dela (14 dígitos de CNPJ + cargo dobrado), que é menos
 * bonita e igualmente verdadeira.
 */
export function agruparMovimentos(
  rows: ChangeRow[],
  dicionario: CargoConhecido[] = [],
): MovimentosDaUnidade[] {
  const conhecidos = new Map(
    dicionario.map((c) => [c.unidadeCnpj + chaveDeCargo(c.cargo), c]),
  );

  const legibilizar = (entityLabel: string): { unidade: string; cargo: string } => {
    if (entityLabel.includes(" · ")) {
      /*
        A lista de entradas e saídas é de cargos, numa linha só: o turno volta
        para junto do cargo porque um "MOTORISTA 28" que entrou no 8x16 e outro
        que entrou no 12x36 são duas entradas, e escrever as duas como
        "MOTORISTA 28" faria a lista repetir o mesmo nome sem dizer por quê.
      */
      const { unidade, cargo, turno } = separarRotulo(entityLabel);
      return { unidade, cargo: turno ? `${cargo} · ${turno}` : cargo };
    }
    const chave = entityLabel.match(/^(\d{14})([A-Z0-9]*)$/);
    if (!chave) return { unidade: "", cargo: entityLabel };
    const conhecido = conhecidos.get(entityLabel);
    if (conhecido) {
      return { unidade: conhecido.unidadeCnpjLegivel, cargo: conhecido.cargo };
    }
    return { unidade: mascararCnpj(chave[1]), cargo: chave[2] };
  };

  const porUnidade = new Map<string, MovimentosDaUnidade>();
  for (const row of rows) {
    if (row.changeType !== "ENTITY_ADDED" && row.changeType !== "ENTITY_REMOVED") continue;
    if (!row.entityLabel) continue;
    const { unidade, cargo } = legibilizar(row.entityLabel);
    let grupo = porUnidade.get(unidade);
    if (!grupo) {
      grupo = { unidade, entraram: [], sairam: [] };
      porUnidade.set(unidade, grupo);
    }
    (row.changeType === "ENTITY_ADDED" ? grupo.entraram : grupo.sairam).push(cargo);
  }
  for (const grupo of porUnidade.values()) {
    grupo.entraram.sort((a, b) => a.localeCompare(b, "pt-BR"));
    grupo.sairam.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }
  return [...porUnidade.values()].sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR"));
}

/**
 * O rótulo de uma vigência do quadro no seletor. `periodLabel` sozinho não
 * serve aqui: duas quinzenas do mesmo mês compartilham "agosto/2026", e o
 * rótulo literal da fonte é o único nome que as distingue sem inventar nada.
 */
export function rotuloDaVigencia(v: { periodLabel: string; sourceLabels: string[] }): string {
  return v.sourceLabels.length > 0 ? v.sourceLabels.join(" · ") : v.periodLabel;
}
