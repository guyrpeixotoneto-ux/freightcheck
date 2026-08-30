import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { csvComoBlob, numeroParaCsv, paraNomeDeArquivo } from "@/lib/csv";
import {
  FILTROS_DA_EVOLUCAO,
  ORDENS_DA_EVOLUCAO,
  corDaCelula,
  intensidadeDaCelula,
  maiorCelulaAbsoluta,
  recorteDaMatriz,
  type AtivoNaEvolucao,
  type CelulaDaPlaca,
  type EvolucaoPorPlaca,
  type FiltroDaEvolucao,
  type OrdemDaEvolucao,
} from "@/lib/evolucao-por-placa";

/**
 * A matriz PLACA × TEMPO — o componente mais importante da tela.
 *
 * Cada linha é um ativo, cada coluna é uma vigência, e cada célula é o impacto
 * daquele ativo naquela comparação. Quatro estados, e nenhum deles se confunde
 * com outro:
 *
 * - **verde** ganhou; **vermelho** perdeu — a intensidade em três degraus, e
 *   não num gradiente contínuo (ver `intensidadeDaCelula`);
 * - **cinza com travessão** não houve alteração — e nunca "R$ 0";
 * - **âmbar** houve alteração e o impacto ainda não pôde ser apurado.
 *
 * **A primeira coluna e a do acumulado ficam presas.** É o que faz a leitura
 * funcionar no celular: as vigências rolam na horizontal, e a placa e o total
 * dela continuam à vista — sem isso, rolar até agosto significa não saber mais
 * de quem é a linha.
 *
 * A paginação é de dez placas, como a régua de leitura de uma tela executiva
 * pede; a ordem padrão é a do ranking de atenção, que é a resposta à pergunta
 * que traz alguém aqui.
 */

const POR_PAGINA = 10;

export function MatrizDaEvolucao({
  evolucao,
  filtro,
  ordem,
  busca,
  insight,
  selecionada,
  onFiltro,
  onOrdem,
  onBusca,
  onLimparInsight,
  onEscolherPlaca,
}: {
  evolucao: EvolucaoPorPlaca;
  filtro: FiltroDaEvolucao;
  ordem: OrdemDaEvolucao;
  busca: string;
  insight: { texto: string; entityIds: string[] } | null;
  selecionada: string | null;
  onFiltro: (filtro: FiltroDaEvolucao) => void;
  onOrdem: (ordem: OrdemDaEvolucao) => void;
  onBusca: (busca: string) => void;
  onLimparInsight: () => void;
  onEscolherPlaca: (entityId: string) => void;
}) {
  const [pagina, setPagina] = useState(0);

  const visiveis = useMemo(
    () =>
      recorteDaMatriz(evolucao.ativos, {
        filtro,
        busca,
        ordem,
        insight: insight?.entityIds ?? null,
      }),
    [evolucao.ativos, filtro, busca, ordem, insight],
  );

  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const naPagina = visiveis.slice(atual * POR_PAGINA, atual * POR_PAGINA + POR_PAGINA);
  const maior = useMemo(() => maiorCelulaAbsoluta(visiveis), [visiveis]);
  const sufixo = periodicitySuffix(evolucao.periodicidade);

  const trocar = (acao: () => void) => {
    acao();
    setPagina(0);
  };

  return (
    <section className="bg-card border rounded-xl shadow-sm p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold leading-tight">
          Impacto por placa ao longo do tempo{" "}
          <span className="font-normal text-muted-foreground">(R${sufixo})</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {evolucao.colunas.length}{" "}
          {evolucao.colunas.length === 1 ? "vigência comparada" : "vigências comparadas"} ·{" "}
          {evolucao.fromLabel} → {evolucao.toLabel}
        </p>
      </div>

      {/* ---- filtros rápidos, busca e exportação ---------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => trocar(() => onBusca(e.target.value))}
            placeholder="Buscar placa…"
            aria-label="Buscar placa"
            className="h-9 w-44 sm:w-56 rounded-lg border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTROS_DA_EVOLUCAO.map((opcao) => (
            <button
              key={opcao.chave}
              onClick={() => trocar(() => onFiltro(opcao.chave))}
              title={`${opcao.rotulo}: ${opcao.descricao}.`}
              aria-pressed={filtro === opcao.chave}
              className={cn(
                "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
                filtro === opcao.chave
                  ? CLASSE_DO_FILTRO_ATIVO[opcao.chave]
                  : "border-input text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="ordem-da-matriz">
            Ordenar por
          </label>
          <select
            id="ordem-da-matriz"
            value={ordem}
            onChange={(e) => trocar(() => onOrdem(e.target.value as OrdemDaEvolucao))}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            {ORDENS_DA_EVOLUCAO.map((o) => (
              <option key={o.chave} value={o.chave}>
                {o.rotulo}
              </option>
            ))}
          </select>
          <button
            onClick={() => exportar(evolucao, visiveis)}
            className="h-9 inline-flex items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
          >
            <Download className="w-4 h-4" />
            Exportar
          </button>
        </div>
      </div>

      {insight && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{insight.texto}</span>
          <span className="text-muted-foreground">
            A matriz está mostrando só essas placas.
          </span>
          <button
            onClick={() => trocar(onLimparInsight)}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            Limpar recorte ×
          </button>
        </div>
      )}

      {/* ---- a matriz ------------------------------------------------------- */}
      {visiveis.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nenhuma placa neste recorte. Troque o filtro ou limpe a busca.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[0.8125rem] border-collapse min-w-[38rem]">
            <thead>
              <tr className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-20 bg-card px-2 pb-2 text-left font-semibold shadow-[1px_0_0_0_hsl(var(--border))]">
                  Placa
                </th>
                {evolucao.colunas.map((coluna) => (
                  <th
                    key={coluna.period}
                    className="px-1.5 pb-2 text-center font-semibold whitespace-nowrap"
                    title={`${coluna.alteracoes} ${coluna.alteracoes === 1 ? "alteração" : "alterações"} nesta vigência, na frota inteira do recorte.`}
                  >
                    {coluna.label}
                  </th>
                ))}
                <th className="sticky right-0 z-20 bg-card px-2 pb-2 text-right font-semibold whitespace-nowrap shadow-[-1px_0_0_0_hsl(var(--border))]">
                  Acumulado
                  <span className="block font-normal normal-case">(R${sufixo})</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {naPagina.map((ativo) => (
                <LinhaDaPlaca
                  key={ativo.entityId}
                  ativo={ativo}
                  colunas={evolucao.colunas}
                  maior={maior}
                  sufixo={sufixo}
                  selecionada={selecionada === ativo.entityId}
                  onEscolher={() => onEscolherPlaca(ativo.entityId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- rodapé: paginação e legenda ------------------------------------ */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Mostrando {visiveis.length === 0 ? 0 : atual * POR_PAGINA + 1} a{" "}
          {Math.min(visiveis.length, (atual + 1) * POR_PAGINA)} de {visiveis.length}{" "}
          {visiveis.length === 1 ? "placa" : "placas"}
          {visiveis.length !== evolucao.ativos.length && ` (de ${evolucao.ativos.length})`}
        </span>
        {paginas > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={atual === 0}
              className="h-7 px-2 rounded-md border disabled:opacity-40"
            >
              ‹
            </button>
            <span className="tabular-nums px-2">
              {atual + 1} / {paginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={atual === paginas - 1}
              className="h-7 px-2 rounded-md border disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <Legenda />

      {evolucao.gaps.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {evolucao.gaps.length}{" "}
          {evolucao.gaps.length === 1
            ? "vigência do período não tem comparação"
            : "vigências do período não têm comparação"}{" "}
          ({evolucao.gaps.map((g) => g.label).join(", ")}). O que houve nelas não está
          somado — e não está contado como zero.
        </p>
      )}
    </section>
  );
}

const CLASSE_DO_FILTRO_ATIVO: Record<string, string> = {
  todos: "border-primary bg-primary text-primary-foreground",
  piorando: "border-red-300 bg-red-50 text-red-700",
  melhorando: "border-emerald-300 bg-emerald-50 text-emerald-700",
  "sem-valoracao": "border-amber-300 bg-amber-50 text-amber-700",
  recorrentes: "border-indigo-300 bg-indigo-50 text-indigo-700",
};

function LinhaDaPlaca({
  ativo,
  colunas,
  maior,
  sufixo,
  selecionada,
  onEscolher,
}: {
  ativo: AtivoNaEvolucao;
  colunas: { period: string; label: string }[];
  maior: number;
  sufixo: string;
  selecionada: boolean;
  onEscolher: () => void;
}) {
  const porPeriodo = new Map(ativo.celulas.map((c) => [c.period, c]));

  return (
    <tr
      onClick={onEscolher}
      className={cn(
        "cursor-pointer border-t hover:bg-muted/40",
        selecionada && "bg-primary/5",
      )}
    >
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 px-2 py-1.5 text-left font-semibold whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]",
          selecionada ? "bg-primary/5" : "bg-card",
        )}
      >
        {/*
          A placa é um botão, e não só uma célula clicável: a linha inteira
          responde ao mouse, mas quem navega por teclado precisa de um alvo
          focável — e o nome do ativo é o alvo certo, porque é ele que diz o que
          vai abrir.
        */}
        <button
          onClick={(evento) => {
            evento.stopPropagation();
            onEscolher();
          }}
          aria-expanded={selecionada}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
        >
          {ativo.rotulo}
        </button>
      </th>
      {colunas.map((coluna) => (
        <Celula
          key={coluna.period}
          placa={ativo.rotulo}
          coluna={coluna}
          celula={porPeriodo.get(coluna.period)}
          maior={maior}
          sufixo={sufixo}
        />
      ))}
      <td
        className={cn(
          "sticky right-0 z-10 px-2 py-2 text-right font-bold tabular-nums whitespace-nowrap shadow-[-1px_0_0_0_hsl(var(--border))]",
          selecionada ? "bg-primary/5" : "bg-card",
          ativo.acumulado === null
            ? "text-amber-700"
            : ativo.acumulado < 0
              ? "text-red-700"
              : ativo.acumulado > 0
                ? "text-emerald-700"
                : "text-muted-foreground",
        )}
        title={
          ativo.acumulado === null
            ? `${ativo.alteracoes} ${ativo.alteracoes === 1 ? "alteração" : "alterações"} sem impacto apurado nesta grandeza.`
            : `Soma das células desta linha: ${formatBrlShort(ativo.acumulado)}${sufixo}.`
        }
      >
        {ativo.acumulado === null ? "sem valoração" : formatBrlShort(ativo.acumulado)}
      </td>
    </tr>
  );
}

function Celula({
  placa,
  coluna,
  celula,
  maior,
  sufixo,
}: {
  placa: string;
  coluna: { period: string; label: string };
  celula: CelulaDaPlaca | undefined;
  maior: number;
  sufixo: string;
}) {
  const cor = corDaCelula(celula);
  const grau = intensidadeDaCelula(celula?.net ?? null, maior);

  return (
    <td
      className={cn(
        "px-1.5 py-1.5 text-center tabular-nums whitespace-nowrap",
        CLASSE_DA_CELULA[cor][grau - 1],
      )}
      title={dica(placa, coluna, celula, sufixo)}
    >
      {celula === undefined ? (
        <span className="text-muted-foreground/60">—</span>
      ) : celula.net === null ? (
        <span className="text-[0.6875rem] font-medium">{rotuloSemValor(celula)}</span>
      ) : (
        formatBrlShort(celula.net)
      )}
    </td>
  );
}

/**
 * Por que a célula não tem número — em duas palavras, na própria célula.
 *
 * As três razões são diferentes e a diferença importa: "sem valoração" é
 * trabalho a fazer (o impacto ainda não foi apurado), "outra grandeza" é uma
 * alteração que tem preço em R$/ano numa matriz desenhada em R$/mês, e "já
 * contada" é a parcela que a regra de dupla contagem tirou da soma porque o
 * total dela já entrou. Escrever "sem valoração" nas três chamaria de pendência
 * o que não é — e mandaria alguém procurar apuração que já existe.
 */
function rotuloSemValor(celula: CelulaDaPlaca): string {
  if (celula.semValoracao > 0) return "sem valoração";
  if (celula.outraPeriodicidade > 0) return "outra grandeza";
  return "já contada";
}

/**
 * Três degraus por cor, e o do meio é o mais usado.
 *
 * O primeiro degrau é quase branco de propósito: uma matriz em que toda célula
 * grita não deixa nenhuma ser lida.
 */
const CLASSE_DA_CELULA: Record<string, [string, string, string]> = {
  ganho: [
    "bg-emerald-50/60 text-emerald-800",
    "bg-emerald-100 text-emerald-900",
    "bg-emerald-200 text-emerald-950 font-semibold",
  ],
  perda: [
    "bg-red-50/60 text-red-800",
    "bg-red-100 text-red-900",
    "bg-red-200 text-red-950 font-semibold",
  ],
  /*
    A pendência tem um degrau só, e é o mais claro dos três.

    Ela não tem magnitude — "não sabemos quanto" não é grande nem pequeno —,
    então variar a intensidade seria inventar uma escala. E é clara de propósito:
    nos dados reais a maior parte das alterações ainda não tem preço, e um âmbar
    forte em oitenta por cento da matriz apagaria as células que têm dinheiro,
    que são as que alguém veio ver.
  */
  "sem-valoracao": [
    "bg-amber-50 text-amber-800",
    "bg-amber-50 text-amber-800",
    "bg-amber-50 text-amber-800",
  ],
  "sem-alteracao": ["", "", ""],
};

/**
 * O que o hover conta — a célula inteira, e não só o número que ela mostra.
 *
 * É aqui que "7 alterações" volta a fechar: apuradas, sem valoração, fora da
 * soma por dupla contagem e em outra grandeza, cada uma com o seu nome.
 */
function dica(
  placa: string,
  coluna: { label: string },
  celula: CelulaDaPlaca | undefined,
  sufixo: string,
): string {
  if (celula === undefined) {
    return `${placa} · ${coluna.label}\nSem alteração nesta vigência.`;
  }
  const linhas = [
    `${placa} · ${coluna.label}`,
    "",
    `${celula.alteracoes} ${celula.alteracoes === 1 ? "alteração" : "alterações"}`,
    `Ganhos: ${formatBrlShort(celula.ganho)}${sufixo}`,
    `Perdas: ${formatBrlShort(celula.perda)}${sufixo}`,
    `Sem valoração: ${celula.semValoracao}`,
  ];
  if (celula.foraDoTotal > 0) {
    linhas.push(`Fora da soma (já contadas nas parcelas): ${celula.foraDoTotal}`);
  }
  if (celula.outraPeriodicidade > 0) {
    linhas.push(`Em outra grandeza: ${celula.outraPeriodicidade}`);
  }
  linhas.push(
    celula.net === null
      ? "Impacto líquido: ainda sem valoração"
      : `Impacto líquido: ${formatBrlShort(celula.net)}${sufixo}`,
  );
  return linhas.join("\n");
}

function Legenda() {
  const itens = [
    { cor: "bg-emerald-200", texto: "Ganho" },
    { cor: "bg-red-200", texto: "Perda" },
    { cor: "bg-muted border", texto: "Sem alteração" },
    { cor: "bg-amber-50 border border-amber-200", texto: "Sem valoração" },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {itens.map((item) => (
        <span key={item.texto} className="inline-flex items-center gap-1.5">
          <span className={cn("w-3 h-3 rounded-sm", item.cor)} />
          {item.texto}
        </span>
      ))}
    </div>
  );
}

/**
 * A exportação — **exatamente o que está à vista**, e com os estados por extenso.
 *
 * Uma célula sem alteração sai vazia e uma sem valoração sai escrita: um CSV que
 * escrevesse 0 nas duas transformaria, na primeira soma que alguém fizesse no
 * Excel, ausência e pendência em dinheiro que ninguém mediu.
 */
function exportar(evolucao: EvolucaoPorPlaca, ativos: AtivoNaEvolucao[]): void {
  const cabecalho = [
    "Placa",
    "Tipo",
    ...evolucao.colunas.map((c) => c.label),
    `Acumulado (R$ ${evolucao.periodicidade.toLowerCase()})`,
    "Alterações",
    "Sem valoração",
    "Vigências afetadas",
    "Tendência",
    "Prioridade",
    "Score",
  ];

  const linhas = ativos.map((ativo) => {
    const porPeriodo = new Map(ativo.celulas.map((c) => [c.period, c]));
    return [
      ativo.rotulo,
      ativo.entityType ?? "",
      ...evolucao.colunas.map((coluna) => {
        const celula = porPeriodo.get(coluna.period);
        if (celula === undefined) return "";
        if (celula.net === null) return "sem valoração";
        return numeroParaCsv(celula.net);
      }),
      ativo.acumulado === null ? "sem valoração" : numeroParaCsv(ativo.acumulado),
      String(ativo.alteracoes),
      String(ativo.semValoracao),
      String(ativo.vigenciasAfetadas),
      ativo.tendencia,
      ativo.prioridade,
      numeroParaCsv(ativo.score),
    ];
  });

  const url = URL.createObjectURL(csvComoBlob([cabecalho, ...linhas]));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${paraNomeDeArquivo(
    `evolucao-por-placa-${evolucao.context.label}-${evolucao.fromLabel}-${evolucao.toLabel}`,
  )}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
