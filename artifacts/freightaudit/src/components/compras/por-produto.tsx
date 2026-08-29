/**
 * Por produto — um produto de cada vez, a frota inteira ordenada por ele.
 *
 * A matriz responde "como está a frota"; esta visão responde à pergunta que
 * chega com o pedido na mão: **escolhi recapagem, quanto a Ambev remunera de
 * pneu, em quais veículos, e quanto é a régua da frota?** Numa matriz de nove
 * colunas essa resposta existe, mas está espalhada por uma coluna que se lê de
 * lado; aqui ela é a tela inteira.
 *
 * **Ela não busca nada.** Come da mesma `MatrizDaFrota` que a tabela já
 * carregou — é uma leitura da mesma resposta, não uma segunda pergunta ao
 * servidor. Trocar de produto é instantâneo e, mais importante, os dois
 * desenhos nunca podem discordar: não há duas respostas para comparar.
 *
 * **Os veículos sem número aparecem, contados por motivo.** Uma lista que
 * mostrasse só quem tem valor responderia "62 cavalos têm IPVA" e deixaria a
 * pessoa concluir que a frota tem 62 veículos. O bloco do rodapé fecha a
 * conta — quem tem número, mais quem não tem e por quê, é a frota.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Download, TriangleAlert } from "lucide-react";
import { csvComoBlob, numeroParaCsv, paraNomeDeArquivo } from "@/lib/csv";
import { salvarArquivo } from "@/lib/api";
import { formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SUFIXO_DA_GAVETA } from "@/components/composicao/tipos";
import {
  MARCA_DA_CELULA_VAZIA,
  ROTULO_CURTO_DA_CELULA_VAZIA,
  ROTULO_DA_CELULA_VAZIA,
  ROTULO_DA_NATUREZA,
  ROTULO_DA_RESSALVA,
  ROTULO_SEM_TOTAL,
  type CelulaDaMatriz,
  type LinhaDaMatriz,
  type MatrizDaFrota,
  type MotivoDaCelulaVazia,
} from "./tipos";
import { totalizarColuna } from "./totais";
import { FiltroDeTipo } from "./filtro-de-tipo";

export function VisaoPorProduto({
  matriz,
  termo,
  contexto,
  chave,
  onEscolherProduto,
}: {
  matriz: MatrizDaFrota;
  termo: string;
  contexto: string;
  /** O produto escolhido — viaja na URL, para que o link compartilhado abra nele. */
  chave: string;
  onEscolherProduto: (chave: string) => void;
}) {
  const [tipo, setTipo] = useState<string | null>(null);

  const indice = Math.max(
    0,
    matriz.colunas.findIndex((c) => c.produto.chave === chave),
  );
  const coluna = matriz.colunas[indice]!;

  const doRecorte = useMemo(() => {
    const alvo = termo.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return matriz.linhas.filter((l) => {
      if (tipo !== null && l.entityType !== tipo) return false;
      if (alvo === "") return true;
      return `${l.placa ?? ""}${l.chassi ?? ""}`.toUpperCase().includes(alvo);
    });
  }, [matriz.linhas, termo, tipo]);

  /*
    Ordenado pelo valor, do maior para o menor — é a régua que quem libera um
    pedido procura: onde este veículo cai em relação aos outros. A ordem por
    placa continua existindo na matriz, que é onde se procura *um* veículo.
  */
  const comValor = doRecorte
    .map((linha) => ({ linha, celula: linha.celulas[indice]! }))
    .filter((x) => x.celula.valor !== null)
    .sort((a, b) => (b.celula.valor ?? 0) - (a.celula.valor ?? 0));

  const semValor = doRecorte
    .map((linha) => ({ linha, celula: linha.celulas[indice]! }))
    .filter((x) => x.celula.valor === null);

  const total = totalizarColuna(coluna, doRecorte, indice);
  const valores = comValor.map((x) => x.celula.valor!);
  const porMotivo = new Map<MotivoDaCelulaVazia, number>();
  for (const { celula } of semValor) {
    porMotivo.set(celula.vazio!, (porMotivo.get(celula.vazio!) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <SeletorDeProduto matriz={matriz} chave={coluna.produto.chave} onEscolher={onEscolherProduto} />

      <div className="bg-card border rounded-md px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              {coluna.produto.rotulo}
              <span className="text-[0.625rem] font-normal normal-case tracking-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {ROTULO_DA_NATUREZA[coluna.produto.natureza]}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              {coluna.produto.compra}
            </p>
          </div>

          {/*
            Três números, e nenhum deles é média: o maior, o menor e o total.
            Uma média de remuneração por veículo convida à conta que este
            produto recusa desde o catálogo — multiplicar por uma frota para
            estimar o que a Ambev paga, quando o que ela paga é a soma dos
            valores que ela declarou, veículo a veículo.
          */}
          {valores.length > 0 && (
            <dl className="flex gap-8 shrink-0 text-right">
              <div>
                <dt className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                  Menor
                </dt>
                <dd className="text-base font-semibold tabular-nums">
                  {formatValue(Math.min(...valores), "BRL")}
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                  Maior
                </dt>
                <dd className="text-base font-semibold tabular-nums">
                  {formatValue(Math.max(...valores), "BRL")}
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                  Total do recorte
                </dt>
                <dd className="text-xl font-bold tabular-nums">
                  {total.total !== null ? (
                    <>
                      {formatValue(total.total, "BRL")}
                      {total.gaveta && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {SUFIXO_DA_GAVETA[total.gaveta]}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">
                      sem total — {ROTULO_SEM_TOTAL[total.semTotal!]}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {coluna.produto.ressalva && (
          <div className="mt-4 flex gap-2.5 rounded-md border border-l-[4px] border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-amber-800 dark:text-amber-400">
                {ROTULO_DA_RESSALVA[coluna.produto.ressalva.motivo]}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {coluna.produto.ressalva.texto}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FiltroDeTipo matriz={matriz} tipo={tipo} onEscolher={setTipo} />
        <span className="text-xs text-muted-foreground">
          {comValor.length} de {doRecorte.length}{" "}
          {doRecorte.length === 1 ? "veículo" : "veículos"} com valor
        </span>
        <button
          type="button"
          onClick={() => exportar(matriz, coluna, comValor, semValor)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>
      </div>

      {comValor.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-card border rounded-md px-6 py-10 text-center">
          Nenhum veículo deste recorte tem número de {coluna.produto.rotulo.toLowerCase()} nesta
          vigência.
        </p>
      ) : (
        <div className="bg-card border rounded-md divide-y">
          {comValor.map(({ linha, celula }, i) => (
            <div key={linha.entityId} className="flex items-baseline gap-4 px-6 py-2.5">
              <span className="w-8 text-xs tabular-nums text-muted-foreground shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 min-w-0">
                {linha.placa ? (
                  <Link
                    href={`/remunerado?aba=frota&placa=${linha.placa}${contexto ? `&${contexto}` : ""}`}
                    className="font-mono font-medium tracking-wider text-brand hover:underline"
                  >
                    {linha.placa}
                  </Link>
                ) : (
                  <span className="font-mono text-muted-foreground">sem placa</span>
                )}
                <span className="ml-3 text-xs text-muted-foreground">{linha.rotuloDoTipo}</span>
              </span>
              <span className="text-base font-semibold tabular-nums shrink-0">
                {formatValue(celula.valor, celula.unit)}
                {celula.gaveta && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {SUFIXO_DA_GAVETA[celula.gaveta]}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {semValor.length > 0 && (
        <section className="bg-card border border-dashed rounded-md px-6 py-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            E os outros {semValor.length}
          </h3>
          <ul className="mt-2.5 space-y-1.5">
            {[...porMotivo.entries()].map(([motivo, quantos]) => (
              <li key={motivo} className="text-xs text-muted-foreground">
                <span className="font-mono font-bold mr-2">{MARCA_DA_CELULA_VAZIA[motivo]}</span>
                <span className="tabular-nums font-semibold text-foreground">{quantos}</span>{" "}
                {quantos === 1 ? "veículo" : "veículos"} — {ROTULO_DA_CELULA_VAZIA[motivo]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * O seletor de produto — todos, sempre, inclusive os que esta frota não responde.
 *
 * A lista é a do catálogo, como em toda esta tela: um produto escondido por não
 * ter número faria a tela responder "a Ambev não remunera isto" com um silêncio,
 * que é a resposta que este balcão inteiro existe para não dar. O que o produto
 * sem número ganha é a contagem ao lado, para que a escolha seja informada antes
 * do clique.
 */
function SeletorDeProduto({
  matriz,
  chave,
  onEscolher,
}: {
  matriz: MatrizDaFrota;
  chave: string;
  onEscolher: (chave: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {matriz.colunas.map((coluna) => (
        <button
          key={coluna.produto.chave}
          type="button"
          onClick={() => onEscolher(coluna.produto.chave)}
          className={cn(
            "px-3 py-2 text-xs font-semibold rounded-md border transition-colors text-left",
            coluna.produto.chave === chave
              ? "border-brand text-brand bg-brand/5"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          <span className="flex items-center gap-1.5">
            {coluna.produto.ressalva && (
              <TriangleAlert className="w-3 h-3 text-amber-600 dark:text-amber-500" />
            )}
            {coluna.produto.rotulo}
          </span>
          <span className="block font-normal text-[0.625rem] opacity-70">
            {coluna.veiculosComValor > 0
              ? `${coluna.veiculosComValor} com valor`
              : "sem valor nesta vigência"}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * O arquivo desta visão: a lista ordenada, e os que ficaram de fora contados.
 *
 * Os sem valor entram como linha, com o rótulo curto no lugar do número, pela
 * mesma razão da matriz: uma planilha só com quem tem valor faz o destinatário
 * contar a frota errado.
 */
function exportar(
  matriz: MatrizDaFrota,
  coluna: MatrizDaFrota["colunas"][number],
  comValor: { linha: LinhaDaMatriz; celula: CelulaDaMatriz }[],
  semValor: { linha: LinhaDaMatriz; celula: CelulaDaMatriz }[],
): void {
  const cabecalho = coluna.gaveta
    ? `${coluna.produto.rotulo} (${SUFIXO_DA_GAVETA[coluna.gaveta].replace("/", "")})`
    : coluna.produto.rotulo;

  const conteudo: string[][] = [
    [`Remunerado — ${coluna.produto.rotulo}`, matriz.periodLabel, matriz.contextLabel],
    [],
    ["Placa", "Equipamento", cabecalho],
    ...comValor.map(({ linha, celula }) => [
      linha.placa ?? "sem placa",
      linha.rotuloDoTipo,
      numeroParaCsv(celula.valor!),
    ]),
    ...semValor.map(({ linha, celula }) => [
      linha.placa ?? "sem placa",
      linha.rotuloDoTipo,
      ROTULO_CURTO_DA_CELULA_VAZIA[celula.vazio!],
    ]),
    ...(coluna.produto.ressalva
      ? [
          [],
          [
            `Ressalva — ${coluna.produto.rotulo}`,
            `${ROTULO_DA_RESSALVA[coluna.produto.ressalva.motivo]}: ${coluna.produto.ressalva.texto}`,
          ],
        ]
      : []),
  ];

  salvarArquivo(
    csvComoBlob(conteudo),
    `remunerado-${paraNomeDeArquivo(coluna.produto.rotulo)}-${paraNomeDeArquivo(matriz.periodLabel)}.csv`,
  );
}
