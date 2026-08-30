/**
 * A matriz da frota — a frota inteira em linhas, o que se compra em colunas.
 *
 * É a porta da aba Frota. O balcão por placa continua existindo e continua
 * respondendo à pergunta de quem já sabe o veículo; esta tabela responde à
 * outra, que chega com a mesma frequência e não tem placa nenhuma: **quanto a
 * Ambev remunera pneu na frota, e em quais veículos?**
 *
 * **Três decisões de leitura, e o que cada uma impede:**
 *
 * 1. **A ressalva mora no cabeçalho da coluna, e a coluna inteira fica marcada.**
 *    Numa tabela não há espaço para a frase em cada célula, e sem ela a coluna
 *    de *Pneus* seria oitenta traços que se lêem como "a Ambev não remunera
 *    pneu". O texto completo sai na legenda abaixo da tabela, onde cabe.
 * 2. **O rodapé só soma o que é somável.** Uma coluna com valores em gavetas
 *    diferentes sai sem total, escrevendo o motivo no lugar do número — a
 *    mesma recusa que o rodapé da Composição faz, e pela mesma razão: um
 *    número embaixo da palavra "total" vira orçamento na reunião seguinte.
 * 3. **Cada vazio diz de qual vazio se trata.** São quatro marcas, e a legenda
 *    as explica. Um traço só para "não tem coluna", "a coluna veio vazia" e
 *    "há duas colunas que medem coisas diferentes" faria a matriz parecer
 *    esburacada onde ela está sendo exata.
 *
 * **O CSV sai daqui, e não do servidor.** É o mesmo `linhas`/`colunas` que a
 * tabela desenha, com o mesmo filtro aplicado: é a única forma de garantir que
 * o arquivo que a pessoa manda por e-mail é o que ela estava vendo. Uma rota de
 * exportação seria uma segunda montagem da mesma matriz — e a primeira vez que
 * as duas divergissem, quem recebeu o arquivo teria um número que a tela nega.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Download, Info, TriangleAlert } from "lucide-react";
import { csvComoBlob, numeroParaCsv, paraNomeDeArquivo } from "@/lib/csv";
import { salvarArquivo } from "@/lib/api";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SUFIXO_DA_GAVETA } from "@/components/composicao/tipos";
import {
  MARCA_DA_CELULA_VAZIA,
  ROTULO_DA_CELULA_VAZIA,
  ROTULO_CURTO_DA_CELULA_VAZIA,
  ROTULO_DA_NATUREZA,
  ROTULO_DA_RESSALVA,
  ROTULO_SEM_TOTAL,
  type ColunaDaMatriz,
  type LinhaDaMatriz,
  type MatrizDaFrota,
  type MotivoDaCelulaVazia,
} from "./tipos";
import { FiltroDeTipo } from "./filtro-de-tipo";
import { totalizarColuna } from "./totais";

export function TabelaDaMatriz({
  matriz,
  termo,
  contexto,
}: {
  matriz: MatrizDaFrota;
  /** O que foi digitado na busca de placa — filtra a lista enquanto se digita. */
  termo: string;
  /** O contexto que viaja na URL, para o link de cada placa. */
  contexto: string;
}) {
  const [tipo, setTipo] = useState<string | null>(null);

  const linhas = useMemo(() => {
    const alvo = termo.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return matriz.linhas.filter((l) => {
      if (tipo !== null && l.entityType !== tipo) return false;
      if (alvo === "") return true;
      return `${l.placa ?? ""}${l.chassi ?? ""}`.toUpperCase().includes(alvo);
    });
  }, [matriz.linhas, termo, tipo]);

  /*
    Os totais são **do recorte**, e o cabeçalho diz isso em vez de mostrar dois
    números. É o contrário da escolha da Frota 360°, onde o resumo descreve a
    frota inteira e não o filtro — e a diferença é o gesto: lá o resumo é um
    cartão que fica parado enquanto se filtra; aqui ele é o rodapé da coluna
    que se está lendo, e um rodapé que ignora o filtro em cima dele mente.
  */
  const colunas = useMemo(
    () => matriz.colunas.map((coluna, i) => totalizarColuna(coluna, linhas, i)),
    [matriz.colunas, linhas],
  );

  const comRessalva = matriz.colunas.filter((c) => c.produto.ressalva);
  const marcasUsadas = new Set<MotivoDaCelulaVazia>();
  for (const linha of linhas) {
    for (const celula of linha.celulas) if (celula.vazio) marcasUsadas.add(celula.vazio);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FiltroDeTipo matriz={matriz} tipo={tipo} onEscolher={setTipo} />
        <span className="text-xs text-muted-foreground">
          {linhas.length === matriz.linhas.length
            ? `${linhas.length} ${linhas.length === 1 ? "veículo" : "veículos"}`
            : `${linhas.length} de ${matriz.linhas.length} veículos`}
        </span>
        <button
          type="button"
          onClick={() => exportar(matriz, colunas, linhas)}
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
                Veículo
              </th>
              {matriz.colunas.map((coluna) => (
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
                  <span className="block font-normal normal-case tracking-normal text-[0.625rem] opacity-70">
                    {ROTULO_DA_NATUREZA[coluna.produto.natureza]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.entityId} className="hover:bg-muted/30 transition-colors">
                <td className="sticky left-0 z-10 bg-card px-4 py-2 border-b whitespace-nowrap">
                  {linha.placa ? (
                    <Link
                      href={`/remunerado?aba=frota&placa=${linha.placa}${contexto ? `&${contexto}` : ""}`}
                      className="font-mono font-medium tracking-wider text-brand hover:underline"
                    >
                      {linha.placa}
                    </Link>
                  ) : (
                    /*
                      Sem placa **aparece**, e aparece dizendo o que é. Somê-lo
                      faria o total da coluna não fechar com a contagem de
                      veículos logo acima dela, e um ativo sem identificador
                      corrente é exatamente o tipo de coisa que uma tela de
                      auditoria não pode engolir.
                    */
                    <span className="font-mono text-muted-foreground" title={linha.entityId}>
                      sem placa
                    </span>
                  )}
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {linha.rotuloDoTipo}
                  </span>
                </td>
                {linha.celulas.map((celula, i) => (
                  <td
                    key={matriz.colunas[i]!.produto.chave}
                    className={cn(
                      "px-3 py-2 border-b text-right tabular-nums whitespace-nowrap",
                      matriz.colunas[i]!.produto.ressalva && "bg-amber-50/40 dark:bg-amber-950/15",
                    )}
                  >
                    {celula.valor !== null ? (
                      <>
                        {formatValue(celula.valor, celula.unit)}
                        {celula.gaveta && (
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {SUFIXO_DA_GAVETA[celula.gaveta]}
                          </span>
                        )}
                      </>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title={ROTULO_DA_CELULA_VAZIA[celula.vazio!]}
                      >
                        {MARCA_DA_CELULA_VAZIA[celula.vazio!]}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}

            {linhas.length === 0 && (
              <tr>
                <td
                  colSpan={matriz.colunas.length + 1}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhum veículo neste recorte.
                </td>
              </tr>
            )}
          </tbody>

          {linhas.length > 0 && (
            <tfoot>
              <tr className="bg-muted/40 text-xs">
                <th className="sticky left-0 z-10 bg-muted/60 text-left font-bold px-4 py-2.5 uppercase tracking-wider text-[0.625rem] text-muted-foreground">
                  Total do recorte
                </th>
                {colunas.map((coluna) => (
                  <td
                    key={coluna.produto.chave}
                    className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                  >
                    {coluna.total !== null ? (
                      <>
                        <span className="font-bold text-sm">
                          {formatValue(coluna.total, "BRL")}
                          {coluna.gaveta && (
                            <span className="text-[0.6875rem] font-normal text-muted-foreground">
                              {SUFIXO_DA_GAVETA[coluna.gaveta]}
                            </span>
                          )}
                        </span>
                        <span className="block text-[0.625rem] text-muted-foreground">
                          {coluna.veiculosComValor} de {linhas.length}
                        </span>
                      </>
                    ) : (
                      <span className="text-[0.625rem] text-muted-foreground">
                        sem total — {ROTULO_SEM_TOTAL[coluna.semTotal!]}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

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

      {marcasUsadas.size > 0 && (
        <p className="text-xs text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
          {(Object.keys(MARCA_DA_CELULA_VAZIA) as MotivoDaCelulaVazia[])
            .filter((m) => marcasUsadas.has(m))
            .map((m) => (
              <span key={m}>
                <span className="font-mono font-bold mr-1.5">{MARCA_DA_CELULA_VAZIA[m]}</span>
                {ROTULO_DA_CELULA_VAZIA[m]}
              </span>
            ))}
        </p>
      )}

      {matriz.foraDoCatalogo.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {matriz.foraDoCatalogo.reduce((n, r) => n + r.colunas, 0)} colunas desta frota
          descrevem o ativo e não correspondem a nada que se compre — elas não estão nesta
          tabela. Abra uma placa para vê-las.
        </p>
      )}
    </div>
  );
}

/**
 * O arquivo — a mesma tabela, na ordem em que ela está na tela.
 *
 * Duas escolhas que valem nomear:
 *
 * - **O preâmbulo com vigência e contexto.** Um CSV de remuneração sem a
 *   vigência dentro é uma planilha que, daqui a dois meses, ninguém sabe de que
 *   mês é — e o nome do arquivo não sobrevive a um encaminhamento de e-mail.
 * - **A célula vazia leva o motivo em duas palavras, e não um branco.** Uma
 *   célula em branco na planilha lê-se como zero; o rótulo não soma (o Excel
 *   ignora texto em `SOMA`) e responde à pergunta que o branco deixaria no ar.
 *   A frase inteira vai uma vez só, na legenda do fim — repetida em oitenta
 *   linhas ela afogaria os números que a planilha existe para mostrar.
 */
function exportar(
  matriz: MatrizDaFrota,
  colunas: ColunaDaMatriz[],
  linhas: LinhaDaMatriz[],
): void {
  const conteudo: string[][] = [
    ["Remunerado da frota", matriz.periodLabel, matriz.contextLabel],
    [],
    [
      "Placa",
      "Equipamento",
      ...matriz.colunas.map((c) =>
        c.gaveta ? `${c.produto.rotulo} (${SUFIXO_DA_GAVETA[c.gaveta].replace("/", "")})` : c.produto.rotulo,
      ),
    ],
    ...linhas.map((linha) => [
      linha.placa ?? "sem placa",
      linha.rotuloDoTipo,
      ...linha.celulas.map((c) =>
        c.valor !== null ? numeroParaCsv(c.valor) : ROTULO_CURTO_DA_CELULA_VAZIA[c.vazio!],
      ),
    ]),
    [],
    [
      "Total do recorte",
      "",
      ...colunas.map((c) =>
        c.total !== null ? numeroParaCsv(c.total) : `sem total — ${ROTULO_SEM_TOTAL[c.semTotal!]}`,
      ),
    ],
    [],
    ...(Object.keys(ROTULO_CURTO_DA_CELULA_VAZIA) as MotivoDaCelulaVazia[])
      .filter((m) => linhas.some((l) => l.celulas.some((c) => c.vazio === m)))
      .map((m) => [ROTULO_CURTO_DA_CELULA_VAZIA[m], ROTULO_DA_CELULA_VAZIA[m]]),
    ...matriz.colunas
      .filter((c) => c.produto.ressalva)
      .map((c) => [
        `Ressalva — ${c.produto.rotulo}`,
        `${ROTULO_DA_RESSALVA[c.produto.ressalva!.motivo]}: ${c.produto.ressalva!.texto}`,
      ]),
  ];

  salvarArquivo(
    csvComoBlob(conteudo),
    `remunerado-frota-${paraNomeDeArquivo(matriz.periodLabel)}-${paraNomeDeArquivo(matriz.contextLabel)}.csv`,
  );
}
