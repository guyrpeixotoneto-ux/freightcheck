/**
 * A matriz do QLP — os cargos em linhas, os produtos em colunas.
 *
 * O balcão empilha sete tabelas, uma por produto, e cada uma delas é completa.
 * É a forma certa para quem chegou com uma nota de uniforme na mão. Não é a
 * forma para "quanto a Ambev remunera de uniforme na estrutura, e em quais
 * cargos" — que hoje se responde rolando sete tabelas e comparando cargos que
 * aparecem em ordens diferentes em cada uma.
 *
 * **O seletor de papel é o que torna a matriz possível.** Cada produto do QLP
 * tem até três colunas — preço de um, quantos o modelo reconhece, e a despesa
 * que as duas produzem — e mostrar as três de uma vez daria vinte e uma colunas
 * de tabela. A tela mostra um papel de cada vez, e a troca é instantânea porque
 * a célula já traz os três: é a mesma resposta lida de três jeitos, nunca três
 * consultas.
 *
 * **A recusa que a inversão do eixo poderia ter perdido: unitário não se soma.**
 * O rodapé soma quantidade e despesa; na visão de valor unitário ele escreve o
 * motivo no lugar do número. Somar o preço de um uniforme com o de outro cargo
 * não responde pergunta nenhuma, e o número embaixo de "total" seria lido como
 * o que a Ambev paga.
 *
 * **A conferência sobrevive.** `despesa ≟ unitário × quantidade` é a única
 * conta que este balcão faz — a fonte contra ela mesma —, e ela continua
 * marcada na célula de despesa. O número exibido continua sendo o da fonte:
 * a conferência informa, não corrige.
 */

import { useMemo, useState } from "react";
import { CircleAlert, Download, TriangleAlert } from "lucide-react";
import { csvComoBlob, numeroParaCsv, paraNomeDeArquivo } from "@/lib/csv";
import { salvarArquivo } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatarValor } from "@/components/qlp/apresentacao";
import {
  ROTULO_DA_RESSALVA,
  ROTULO_DO_PAPEL,
  ROTULO_SEM_TOTAL_QLP,
  type CelulaDoProduto,
  type LinhaDaMatrizQlp,
  type MatrizDoQlp,
  type Papel,
} from "./tipos";

/** A ordem em que os papéis se lêem — a mesma do balcão. */
const PAPEIS: Papel[] = ["UNITARIO", "QUANTIDADE", "DESPESA"];

export function TabelaDaMatrizQlp({ matriz }: { matriz: MatrizDoQlp }) {
  /*
    Abre no valor unitário porque é a pergunta que traz alguém a esta tela: o
    pedido na mesa é de um uniforme, não do uniforme do ano inteiro. A despesa
    está a um clique, e é ela que soma.
  */
  const [papel, setPapel] = useState<Papel>("UNITARIO");
  const [busca, setBusca] = useState("");

  const linhas = useMemo(() => {
    const alvo = busca.trim().toUpperCase();
    if (alvo === "") return matriz.linhas;
    return matriz.linhas.filter((l) =>
      `${l.cargo} ${l.unidadeNome ?? l.unidadeCnpjLegivel}`.toUpperCase().includes(alvo),
    );
  }, [matriz.linhas, busca]);

  /* As colunas que respondem a este papel. Um produto que não o entrega sai da
     tela **com nome**, na frase abaixo da tabela: sumir sem dizer faria parecer
     que o produto não existe, quando o que não existe é aquela coluna. */
  const visiveis = matriz.colunas.filter((c) => c.papeis.includes(papel));
  const ausentes = matriz.colunas.filter((c) => !c.papeis.includes(papel));
  const comRessalva = visiveis.filter((c) => c.produto.ressalva);

  const totais = useMemo(
    () =>
      visiveis.map((coluna) => {
        const i = matriz.colunas.indexOf(coluna);
        const celulas = linhas
          .map((l) => l.celulas[i]!.celulas.find((c) => c.papel === papel))
          .filter((c): c is CelulaDoProduto => numeroDe(c?.valor) !== null);
        /*
          A amostra existe para o **formato**, e não para o valor: o total é
          escrito pela mesma régua das células que o formaram, que é a semântica
          curada da coluna. Inventar aqui um `{ isMonetary: true }` para pôr
          cifrão no rodapé seria chamar de dinheiro o que ninguém confirmou —
          exatamente o que `formatarValor` existe para impedir.
        */
        const amostra = celulas[0];
        if (papel === "UNITARIO") {
          return {
            cargos: celulas.length,
            total: null,
            amostra,
            semTotal: "UNITARIO_NAO_SOMA" as const,
          };
        }
        if (celulas.length === 0) {
          return { cargos: 0, total: null, amostra, semTotal: "SEM_VALOR" as const };
        }
        return {
          cargos: celulas.length,
          total: Number(
            celulas.reduce((s, c) => s + (numeroDe(c.valor) ?? 0), 0).toFixed(2),
          ),
          amostra,
          semTotal: null,
        };
      }),
    [visiveis, linhas, papel, matriz.colunas],
  );

  return (
    <div className="space-y-4">
      {matriz.registrosFaltando > 0 && (
        <p className="flex items-start gap-2 text-xs text-brand-red">
          <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          {matriz.registrosFaltando}{" "}
          {matriz.registrosFaltando === 1 ? "registro ficou" : "registros ficaram"} em quarentena
          nesta vigência. Esta matriz está incompleta — ver Inconsistências em QLP
          Administrativo.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {PAPEIS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPapel(p)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors",
                papel === p
                  ? "border-brand text-brand bg-brand/5"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {ROTULO_DO_PAPEL[p]}
            </button>
          ))}
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Cargo ou unidade"
          aria-label="Filtrar por cargo ou unidade"
          className="h-8 px-3 rounded-md border bg-background text-xs w-56"
        />

        <span className="text-xs text-muted-foreground">
          {linhas.length === matriz.linhas.length
            ? `${linhas.length} ${linhas.length === 1 ? "cargo" : "cargos"} · ${matriz.resumo.unidades} ${matriz.resumo.unidades === 1 ? "unidade" : "unidades"}`
            : `${linhas.length} de ${matriz.linhas.length} cargos`}
        </span>

        <button
          type="button"
          onClick={() => exportar(matriz, papel, linhas)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>
      </div>

      <div className="bg-card border rounded-md overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/60 text-left font-bold px-4 py-2 border-b">
                Cargo
              </th>
              {visiveis.map((coluna) => (
                <th
                  key={coluna.produto.chave}
                  className={cn(
                    "text-right font-bold px-3 py-2 border-b bg-muted/40 whitespace-nowrap",
                    coluna.produto.ressalva && "bg-amber-50/80 dark:bg-amber-950/30",
                  )}
                >
                  <span className="flex items-center justify-end gap-1.5">
                    {coluna.produto.ressalva && (
                      <TriangleAlert className="w-3 h-3 text-amber-600 dark:text-amber-500" />
                    )}
                    {coluna.produto.rotulo}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.entityId} className="hover:bg-muted/30 transition-colors">
                <td className="sticky left-0 z-10 bg-card px-4 py-2 border-b whitespace-nowrap">
                  <span className="font-medium">{linha.cargo}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {linha.unidadeNome ?? linha.unidadeCnpjLegivel}
                  </span>
                </td>
                {visiveis.map((coluna) => {
                  const i = matriz.colunas.indexOf(coluna);
                  const celula = linha.celulas[i]!;
                  const valor = celula.celulas.find((c) => c.papel === papel);
                  const divergente =
                    papel === "DESPESA" &&
                    celula.conferencia !== null &&
                    !celula.conferencia.fecha;
                  return (
                    <td
                      key={coluna.produto.chave}
                      className={cn(
                        "px-3 py-2 border-b text-right tabular-nums whitespace-nowrap",
                        coluna.produto.ressalva && "bg-amber-50/40 dark:bg-amber-950/15",
                      )}
                    >
                      {valor === undefined || valor.valor === null ? (
                        <span
                          className="text-muted-foreground"
                          title="Este cargo não tem número deste produto nesta vigência"
                        >
                          —
                        </span>
                      ) : (
                        <span className={cn(divergente && "text-brand-red")}>
                          {formatarValor(valor.valor, valor)}
                          {divergente && (
                            <span
                              className="ml-1 text-[0.625rem]"
                              title={`Esperado ${formatNumber(celula.conferencia!.esperado)} pelo unitário × quantidade; a fonte declara ${formatNumber(celula.conferencia!.declarado)}.`}
                            >
                              não fecha
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {linhas.length === 0 && (
              <tr>
                <td
                  colSpan={visiveis.length + 1}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhum cargo neste recorte.
                </td>
              </tr>
            )}
          </tbody>

          {linhas.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/60 text-left font-bold px-4 py-2.5 uppercase tracking-wider text-[0.625rem] text-muted-foreground">
                  Total do recorte
                </th>
                {totais.map((total, i) => (
                  <td
                    key={visiveis[i]!.produto.chave}
                    className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                  >
                    {total.total !== null ? (
                      <>
                        <span className="font-bold text-sm">
                          {formatarValor(total.total, total.amostra)}
                        </span>
                        <span className="block text-[0.625rem] text-muted-foreground">
                          {total.cargos} de {linhas.length}
                        </span>
                      </>
                    ) : (
                      <span className="text-[0.625rem] text-muted-foreground">
                        sem total — {ROTULO_SEM_TOTAL_QLP[total.semTotal!]}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {ausentes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Sem {ROTULO_DO_PAPEL[papel].toLowerCase()} nesta vigência:{" "}
          {ausentes.map((c) => c.produto.rotulo).join(", ")} —{" "}
          {ausentes.every((c) => c.semColuna)
            ? "o export não trouxe coluna nenhuma destes produtos."
            : "a fonte entrega estes produtos com outros papéis."}
        </p>
      )}

      {papel === "DESPESA" && matriz.resumo.cargosComDivergencia > 0 && (
        <p className="text-xs text-brand-red">
          {matriz.resumo.cargosComDivergencia}{" "}
          {matriz.resumo.cargosComDivergencia === 1 ? "cargo tem" : "cargos têm"} despesa que não
          fecha com unitário × quantidade. O número exibido continua sendo o da fonte — é ele que
          a Ambev paga.
        </p>
      )}

      {comRessalva.length > 0 && (
        <section className="rounded-md border border-l-[4px] border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20 px-5 py-4">
          <h3 className="text-xs font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2">
            <TriangleAlert className="w-3.5 h-3.5" />
            Antes de ler estas colunas
          </h3>
          <ul className="mt-2.5 space-y-2">
            {comRessalva.map((c) => (
              <li key={c.produto.chave} className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">{c.produto.rotulo}</strong> —{" "}
                {ROTULO_DA_RESSALVA[c.produto.ressalva!.motivo]}: {c.produto.ressalva!.texto}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const numeroDe = (valor: CelulaDoProduto["valor"] | undefined): number | null =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : null;

/**
 * O arquivo — o papel que está na tela, com o recorte que está na tela.
 *
 * Leva o papel no preâmbulo e no nome do arquivo: três planilhas de "QLP" na
 * pasta de downloads, uma de unitário e duas de despesa, são indistinguíveis
 * pelo conteúdo — os números têm a mesma cara e significam coisas diferentes.
 */
function exportar(matriz: MatrizDoQlp, papel: Papel, linhas: LinhaDaMatrizQlp[]): void {
  const visiveis = matriz.colunas.filter((c) => c.papeis.includes(papel));

  const conteudo: string[][] = [
    [`Remunerado do QLP — ${ROTULO_DO_PAPEL[papel]}`, matriz.periodLabel, matriz.contextLabel],
    [],
    ["Cargo", "Unidade", ...visiveis.map((c) => c.produto.rotulo)],
    ...linhas.map((linha) => [
      linha.cargo,
      linha.unidadeNome ?? linha.unidadeCnpjLegivel,
      ...visiveis.map((coluna) => {
        const celula = linha.celulas[matriz.colunas.indexOf(coluna)]!;
        const valor = numeroDe(celula.celulas.find((c) => c.papel === papel)?.valor);
        if (valor === null) return "sem valor";
        const naoFecha =
          papel === "DESPESA" && celula.conferencia !== null && !celula.conferencia.fecha;
        return naoFecha ? `${numeroParaCsv(valor)} (não fecha)` : numeroParaCsv(valor);
      }),
    ]),
  ];

  if (papel !== "UNITARIO") {
    conteudo.push(
      [],
      [
        "Total",
        "",
        ...visiveis.map((coluna) => {
          const i = matriz.colunas.indexOf(coluna);
          const valores = linhas
            .map((l) => numeroDe(l.celulas[i]!.celulas.find((c) => c.papel === papel)?.valor))
            .filter((v): v is number => v !== null);
          return valores.length === 0
            ? "sem valor"
            : numeroParaCsv(valores.reduce((s, v) => s + v, 0));
        }),
      ],
    );
  } else {
    conteudo.push([], ["Total", ROTULO_SEM_TOTAL_QLP.UNITARIO_NAO_SOMA]);
  }

  for (const coluna of visiveis.filter((c) => c.produto.ressalva)) {
    conteudo.push([
      `Ressalva — ${coluna.produto.rotulo}`,
      `${ROTULO_DA_RESSALVA[coluna.produto.ressalva!.motivo]}: ${coluna.produto.ressalva!.texto}`,
    ]);
  }

  salvarArquivo(
    csvComoBlob(conteudo),
    `remunerado-qlp-${paraNomeDeArquivo(ROTULO_DO_PAPEL[papel])}-${paraNomeDeArquivo(matriz.periodLabel)}.csv`,
  );
}
