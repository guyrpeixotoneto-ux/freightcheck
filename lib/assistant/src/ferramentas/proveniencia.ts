/**
 * PROVENIÊNCIA — de onde veio este número, até a célula do arquivo.
 *
 * **A capacidade que faltava, e ela já existia.** `coverage/proveniencia.ts`
 * percorre a cadeia inteira desde a F1 — `valor → fact → raw_cell → raw_row →
 * raw_sheet → import_run → source_file` —, e `fact.raw_cell_id` é `NOT NULL`:
 * nenhum fato canônico existe sem apontar a célula que o originou. Dentro do
 * próprio pacote do Assistente havia ainda `procedenciaDaAlteracao`, envolvendo
 * `getChangeProvenance`. Nenhuma das duas era chamada por caminho nenhum: a
 * primeira nunca foi exposta, e a segunda ficou órfã quando o caso PROCEDENCIA
 * do orquestrador passou a usar outras duas consultas.
 *
 * O efeito é que "de onde saiu esse R$ 327.503,60?" — a pergunta que uma
 * aplicação de auditoria existe para responder — não tinha caminho até o
 * arquivo. Esta ferramenta é esse caminho, e ela não calcula nada.
 *
 * **Um eixo, dois alvos.** `valor` responde de onde veio um número; `alteracao`
 * responde de onde vieram os dois lados de uma mudança. São a mesma pergunta em
 * dois tempos, e por isso um argumento e não duas ferramentas — a mesma regra
 * que fez `alteracoes` ter três níveis em vez de três nomes.
 *
 * **`verba` não entra aqui.** A proveniência de uma verba do fechamento
 * quinzenal pertence ao Assistente de Fechamento, que lê as seis fontes da
 * Ambev; este é o Assistente de Auditoria, e o que ele conhece é o cadastro
 * remunerado congelado por vigência. Declarar um alvo que devolve sempre "não
 * disponível" seria pior do que não o ter: a ferramenta prometeria uma resposta
 * que este assistente não tem como dar.
 */

import { provenienciaDoValor } from "@workspace/coverage";
import { getChangeProvenance } from "@workspace/comparison";
import { sql } from "drizzle-orm";
import type { Evidencia } from "../ferramentas";
import type { ContextoDaFerramenta, Ferramenta, SaidaDaFerramenta } from "./registro";

/**
 * A cadeia como evidência — e o que ela autoriza citar.
 *
 * `numeros` fica com o valor e a linha, que são as duas grandezas que uma
 * resposta de proveniência afirma. O nome do arquivo, a aba e a coluna vão nos
 * fatos, de onde a trava os lê como texto. A placa entra em `identificadores`,
 * pelo motivo de sempre: ela é um nome, não uma quantia.
 */
function comoEvidencia(
  titulo: string,
  fatos: { rotulo: string; valor: string; detalhe?: string }[],
  numeros: number[],
  identificadores: string[],
  origem: string,
): Evidencia {
  return {
    ferramenta: "proveniencia",
    titulo,
    fatos,
    numeros,
    identificadores,
    origem,
    tela: { label: "Importações", href: "/importacoes" },
  };
}

export const proveniencia: Ferramenta = {
  nome: "proveniencia",
  descricao:
    "De onde veio um número, até a célula do arquivo que o trouxe. Devolve a cadeia " +
    "completa: o valor, a vigência e a revisão, o arquivo importado com data e hash, e a " +
    "aba, a linha e a coluna exatas — com o texto bruto como estava na planilha. " +
    "`alvo='valor'` responde 'de onde saiu este número?'; `alvo='alteracao'` responde " +
    "'de onde vieram os dois lados desta mudança?', com a célula de origem de cada ponta. " +
    "Use sempre que a pergunta for sobre origem, arquivo, comprovação ou evidência de um " +
    "valor — e antes de afirmar que um número não tem origem conhecida. Quando o fato veio " +
    "herdado de uma revisão anterior, a resposta traz as duas vigências: a que o trouxe e a " +
    "que o carregou adiante.",
  argumentos: {
    alvo: {
      tipo: "texto",
      descricao:
        "'valor' para a origem de um número numa vigência; 'alteracao' para a origem das " +
        "duas pontas de uma mudança.",
      opcoes: ["valor", "alteracao"] as const,
      obrigatorio: true,
    },
    placa: {
      tipo: "texto",
      descricao:
        "A placa do veículo, como aparece nas consultas de alterações e de veículos.",
      obrigatorio: true,
    },
    atributo: {
      tipo: "texto",
      descricao:
        "O código do atributo, como devolvido por `parametros` ou pelo campo `atributo` de " +
        "um grupo de `alteracoes`. Não o adivinhe: consulte antes.",
      obrigatorio: true,
    },
    vigencia: {
      tipo: "texto",
      descricao:
        "A vigência, em AAAA-MM-DD, como devolvida por `recortes`. Omita para a mais " +
        "recente em que este veículo tem este parâmetro.",
    },
  },

  async executar(ctx: ContextoDaFerramenta, args): Promise<SaidaDaFerramenta> {
    const placa = String(args.placa ?? "").trim();
    const atributo = String(args.atributo ?? "").trim();
    const vigencia = typeof args.vigencia === "string" ? args.vigencia : undefined;

    if (args.alvo === "alteracao") return origemDaAlteracao(ctx, placa, atributo, vigencia);

    const achado = await provenienciaDoValor(ctx.db, {
      placa,
      atributo,
      vigencia: vigencia ?? ctx.periodo,
      ...(ctx.recorte.scopeHash ? { scopeHash: ctx.recorte.scopeHash } : {}),
    });

    if (!achado.achou) {
      /*
        As três formas de não achar saem nomeadas, e cada uma diz o próximo
        passo. Um `null` para as três faria o modelo concluir "não existe
        origem" — que é uma afirmação forte e, nos três casos, falsa.
      */
      const explicacao =
        achado.motivo === "PLACA_DESCONHECIDA"
          ? `Nenhum veículo com a placa ${achado.placa} foi importado. Confira a placa nas ` +
            "alterações ou nos veículos afetados antes de concluir."
          : achado.motivo === "SEM_VIGENCIA"
            ? `Não há vigência importada${achado.vigencia ? ` para ${achado.vigencia}` : ""} ` +
              "com fatos deste veículo."
            : `O veículo ${achado.placa} não tem o parâmetro "${achado.atributo}" em ` +
              `${achado.vigencia}. Nesta vigência ele tem: ` +
              `${achado.atributosDisponiveis.slice(0, 12).join(", ")}` +
              `${achado.atributosDisponiveis.length > 12 ? "…" : ""}.`;
      return { conteudo: { encontrado: false, motivo: achado.motivo, explicacao }, evidencias: [] };
    }

    const p = achado.proveniencia;
    const conteudo = {
      encontrado: true,
      valor: p.valor,
      /*
        Um fato nulo tem origem tanto quanto um fato com valor — e o motivo do
        nulo é informação: uma célula vazia e uma célula com "N/A" chegam aqui
        distinguíveis, e é isso que separa "não veio" de "veio vazio".
      */
      vazio: p.isNull,
      motivoDoVazio: p.nullReason,
      parametro: {
        codigo: p.atributo.code,
        nome: p.atributo.label,
        nomeNaOrigem: p.atributo.sourceName,
        equipamento: p.atributo.entityType,
      },
      veiculo: { placa: p.entidade.identificador, tipo: p.entidade.entityType },
      vigencia: {
        data: p.vigencia.effectiveDate,
        entrega: p.vigencia.sourceLabel,
        revisao: p.vigencia.revision,
        canal: p.vigencia.canal,
        unidade: p.vigencia.scopeLabel,
      },
      herdadoDe: p.herdadoDe,
      celula: {
        aba: p.celula.aba,
        linha: p.celula.linha,
        coluna: p.celula.coluna,
        cabecalho: p.celula.cabecalho,
        valorBruto: p.celula.valorBruto,
        textoFormatado: p.celula.textoFormatado,
      },
      arquivo: {
        nome: p.importacao.arquivo,
        sha256: p.importacao.contentSha256,
        recebidoEm: p.importacao.recebidoEm,
        recebidoPor: p.importacao.recebidoPor,
        importacao: p.importacao.importRunId,
        status: p.importacao.status,
      },
    };

    const numerico = Number(p.valor);
    const evidencia = comoEvidencia(
      `Origem de ${p.atributo.label} · ${p.entidade.identificador} · ${p.vigencia.effectiveDate}`,
      [
        { rotulo: "Valor", valor: p.isNull ? `vazio (${p.nullReason ?? "sem motivo"})` : String(p.valor) },
        {
          rotulo: "Arquivo",
          valor: p.importacao.arquivo,
          detalhe: `recebido em ${p.importacao.recebidoEm} · sha256 ${p.importacao.contentSha256.slice(0, 12)}…`,
        },
        {
          rotulo: "Célula",
          valor: `aba ${p.celula.aba}, linha ${p.celula.linha}, coluna ${p.celula.coluna}`,
          detalhe: p.celula.cabecalho
            ? `cabeçalho "${p.celula.cabecalho}" · bruto "${p.celula.valorBruto ?? ""}"`
            : `bruto "${p.celula.valorBruto ?? ""}"`,
        },
        {
          rotulo: "Vigência",
          valor: `${p.vigencia.effectiveDate} · revisão ${p.vigencia.revision}`,
          detalhe: p.herdadoDe
            ? `herdado de ${p.herdadoDe.effectiveDate} — o arquivo acima é o que de fato trouxe o valor`
            : p.vigencia.sourceLabel,
        },
      ],
      [
        ...(Number.isFinite(numerico) ? [numerico] : []),
        p.celula.linha,
        p.vigencia.revision,
      ],
      [p.entidade.identificador],
      `provenienciaDoValor(${p.entidade.identificador}, ${p.atributo.code}) · fato ${p.factId}`,
    );

    return { conteudo, evidencias: [evidencia] };
  },
};

/**
 * A origem dos dois lados de uma mudança.
 *
 * Envolve `getChangeProvenance`, que já devolve a célula de cada ponta. O que
 * esta função acrescenta é chegar até o `changeId` pelo vocabulário de quem
 * pergunta — placa, parâmetro e vigência —, porque o id não aparece em tela
 * nenhuma e o modelo não tem como tê-lo.
 */
async function origemDaAlteracao(
  ctx: ContextoDaFerramenta,
  placa: string,
  atributo: string,
  vigencia: string | undefined,
): Promise<SaidaDaFerramenta> {
  const periodo = vigencia ?? ctx.periodo;
  const { rows } = await ctx.db.execute<{ id: string; entity_label: string }>(sql`
    SELECT c.id::text AS id, c.entity_label
      FROM "alteracao_visivel" c
      JOIN change_set cs ON cs.id = c.change_set_id
      JOIN snapshot s    ON s.id = cs.snapshot_b_id
     WHERE c.attribute_code = ${atributo}
       AND upper(c.entity_label) = ${placa.toUpperCase()}
       ${periodo ? sql`AND s.effective_date = ${periodo}::date` : sql``}
       ${ctx.recorte.scopeHash ? sql`AND s.scope_hash = ${ctx.recorte.scopeHash}` : sql``}
     ORDER BY s.effective_date DESC
     LIMIT 1
  `);

  const changeId = rows[0]?.id;
  if (!changeId) {
    return {
      conteudo: {
        encontrado: false,
        motivo: "SEM_ALTERACAO",
        explicacao:
          `Não há alteração registrada de "${atributo}" no veículo ${placa}` +
          `${periodo ? ` na vigência ${periodo}` : ""}. ` +
          "Sem alteração não há duas pontas para comparar — a origem do valor corrente se " +
          "consulta com alvo='valor'.",
      },
      evidencias: [],
    };
  }

  const bruto = await getChangeProvenance(ctx.db, Number(changeId));
  if (!bruto) {
    return {
      conteudo: { encontrado: false, motivo: "SEM_ORIGEM", explicacao: "A alteração existe e a cadeia até a célula não pôde ser lida." },
      evidencias: [],
    };
  }

  const texto = (chave: string): string =>
    bruto[chave] === null || bruto[chave] === undefined ? "—" : String(bruto[chave]);
  const numero = (chave: string): number[] => {
    const n = Number(bruto[chave]);
    return Number.isFinite(n) ? [n] : [];
  };

  const evidencia = comoEvidencia(
    `Origem da alteração · ${texto("entity_label")} · ${atributo}`,
    [
      {
        rotulo: "Antes",
        valor: texto("value_before"),
        detalhe:
          `${texto("snapshot_before")} (${texto("period_before")}) · aba ${texto("sheet_before")}, ` +
          `linha ${texto("row_before")}, coluna ${texto("column_before")} · bruto "${texto("raw_before")}"`,
      },
      {
        rotulo: "Depois",
        valor: texto("value_after"),
        detalhe:
          `${texto("snapshot_after")} (${texto("period_after")}) · aba ${texto("sheet_after")}, ` +
          `linha ${texto("row_after")}, coluna ${texto("column_after")} · bruto "${texto("raw_after")}"`,
      },
    ],
    [
      ...numero("value_before"),
      ...numero("value_after"),
      ...numero("row_before"),
      ...numero("row_after"),
    ],
    [texto("entity_label")],
    `getChangeProvenance(${changeId})`,
  );

  return { conteudo: { encontrado: true, ...bruto }, evidencias: [evidencia] };
}
