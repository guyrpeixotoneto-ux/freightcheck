import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Fuel,
  Layers,
  Route,
  Warehouse,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  TicketChangeTable,
  emptyTicketFilters,
  toTicketQuery,
  type TicketChangeRow,
} from "@/components/changes/ticket-table";

/**
 * Chamados por tipo de valor — a segunda visão da aba.
 *
 * O Resumo responde *quais alterações existem*, ordenadas por materialidade.
 * Esta responde a pergunta que vem antes dela na cabeça de quem confere o mês:
 * **o que isso mexeu** — o valor fixo, o variável, o diesel. São três dinheiros
 * distintos, e uma lista única, por mais bem ordenada que esteja, não separa
 * um do outro.
 *
 * A árvore desce em três níveis, e nenhum deles é decoração:
 *
 * - **classe** responde "o mês mexeu em quê";
 * - **parâmetro** responde "em que exatamente";
 * - **assunto** responde "por qual motivo" — é a coluna que o chamado traz e a
 *   que explica um número como 1.041 alterações no mesmo parâmetro.
 *
 * Abrir uma folha carrega as alterações de verdade, com a mesma tabela do
 * Resumo. Deliberadamente a mesma: a linha de um chamado tem proveniência,
 * marca de valor inferido e o chamado inteiro atrás de um clique, e uma
 * segunda tabela "resumida" aqui perderia tudo isso justamente no ponto em que
 * alguém foi conferir.
 *
 * **Os quatro números do topo não somam o total, e a tela diz isso.** Um
 * parâmetro pode mexer em dois valores — `cavaloEmpurrada` mexe no fixo e no
 * variável —, então ele conta nos dois. Esconder a diferença faria a soma
 * parecer errada; escrevê-la é o que a torna conferível.
 */

export interface TicketSubjectRollup {
  subject: string | null;
  changes: number;
  calculated: number;
  impactSum: number | null;
}

export interface TicketParameterInClass {
  parameterLabel: string;
  attributeCode: string | null;
  changes: number;
  calculated: number;
  impactSum: number | null;
  porque: string | null;
  tambemEm: string[];
  subjects: TicketSubjectRollup[];
}

export interface TicketClassRollup {
  classe: string;
  nome: string;
  descricao: string;
  changes: number;
  calculated: number;
  impactSum: number | null;
  parameters: TicketParameterInClass[];
}

export interface TicketClassificationResponse {
  import: { id: string; filename: string } | null;
  classes: TicketClassRollup[];
  changes: number;
  overlap: number;
  unclassified: number;
}

const brl0 = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const numero = (valor: number) => valor.toLocaleString("pt-BR");

/**
 * A cara de cada classe.
 *
 * Cor e ícone são fixos por classe e não pela posição na tela: quem abre esta
 * aba todo mês reconhece o bloco do fixo pela cor antes de ler o título, e uma
 * paleta que se realoca conforme o tamanho de cada caixa destruiria isso.
 */
const APARENCIA: Record<
  string,
  { icone: React.ReactNode; bolha: string; barra: string; anel: string }
> = {
  FIXO: {
    icone: <Warehouse className="w-5 h-5" />,
    bolha: "bg-blue-50 text-blue-600",
    barra: "bg-blue-600",
    anel: "ring-blue-300 bg-blue-50/60",
  },
  VARIAVEL: {
    icone: <Route className="w-5 h-5" />,
    bolha: "bg-emerald-50 text-emerald-600",
    barra: "bg-emerald-600",
    anel: "ring-emerald-300 bg-emerald-50/60",
  },
  VARIAVEL_DIESEL: {
    icone: <Fuel className="w-5 h-5" />,
    bolha: "bg-amber-50 text-amber-600",
    barra: "bg-amber-500",
    anel: "ring-amber-300 bg-amber-50/60",
  },
  NAO_CLASSIFICADO: {
    icone: <CircleHelp className="w-5 h-5" />,
    bolha: "bg-slate-100 text-slate-500",
    barra: "bg-slate-400",
    anel: "ring-slate-300 bg-slate-50",
  },
};

const aparenciaDe = (classe: string) =>
  APARENCIA[classe] ?? APARENCIA.NAO_CLASSIFICADO;

export function TicketClassification({ envio }: { envio: string | null }) {
  const [aberta, setAberta] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["tickets", "classificacao", envio],
    queryFn: () =>
      fetchJson<TicketClassificationResponse>(
        `/tickets/classification${envio ? `?ticketImportId=${envio}` : ""}`,
      ),
  });

  const data = query.data;

  if (query.isLoading) {
    return (
      <Card className="rounded-2xl p-6">
        <p className="text-sm text-muted-foreground">Classificando…</p>
      </Card>
    );
  }

  if (!data || data.changes === 0) {
    return (
      <Card className="rounded-2xl p-6">
        <p className="text-sm text-muted-foreground">
          Nenhuma alteração de chamado para classificar neste envio.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {data.classes.map((c) => (
          <CartaoDeClasse
            key={c.classe}
            classe={c}
            total={data.changes}
            ativo={aberta === c.classe}
            onClick={() =>
              setAberta((atual) => (atual === c.classe ? null : c.classe))
            }
          />
        ))}
      </div>

      <Conciliacao
        changes={data.changes}
        overlap={data.overlap}
        unclassified={data.unclassified}
      />

      {data.classes.map((c) => (
        <BlocoDeClasse
          key={c.classe}
          classe={c}
          envio={envio}
          aberto={aberta === null || aberta === c.classe}
        />
      ))}
    </div>
  );
}

/** Um dos quatro números do topo. Clicar nele isola o bloco daquela classe. */
function CartaoDeClasse({
  classe,
  total,
  ativo,
  onClick,
}: {
  classe: TicketClassRollup;
  total: number;
  ativo: boolean;
  onClick: () => void;
}) {
  const aparencia = aparenciaDe(classe.classe);
  const fatia = total > 0 ? Math.round((classe.changes / total) * 100) : 0;

  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      title={classe.descricao}
      className={cn(
        "rounded-2xl border bg-card shadow-sm px-5 py-4 text-left transition-colors",
        ativo ? cn("ring-2", aparencia.anel) : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-xl grid place-content-center shrink-0",
            aparencia.bolha,
          )}
        >
          {aparencia.icone}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-muted-foreground truncate">
            {classe.nome}
          </div>
          <div className="text-2xl font-bold tracking-tight tabular-nums">
            {numero(classe.changes)}
          </div>
        </div>
      </div>

      {/* A barra é a fatia sobre o total do envio, e não sobre a maior classe:
          é a leitura que responde "quanto do mês foi isto". */}
      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", aparencia.barra)}
          style={{ width: `${fatia}%` }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {classe.parameters.length} parâmetro
          {classe.parameters.length === 1 ? "" : "s"} · {fatia}%
        </span>
        <ImpactoCurto soma={classe.impactSum} apuradas={classe.calculated} />
      </div>
    </button>
  );
}

/**
 * O impacto de um nó, ou o motivo de não haver.
 *
 * Nunca um zero no lugar de "não apurado": zero é a afirmação de que mexeram e
 * nada mudou, e é falsa quando a verdade é que ninguém conseguiu medir.
 */
function ImpactoCurto({
  soma,
  apuradas,
}: {
  soma: number | null;
  apuradas: number;
}) {
  if (soma === null || apuradas === 0) {
    return (
      <span className="text-muted-foreground" title="nenhuma delas tem impacto apurado">
        sem impacto apurado
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-mono tabular-nums font-medium",
        soma < 0 ? "text-red-600" : soma > 0 ? "text-emerald-700" : "text-muted-foreground",
      )}
      title={`${numero(apuradas)} alterações entram nesta soma`}
    >
      {soma > 0 ? "+" : ""}
      {brl0(soma)}
    </span>
  );
}

/**
 * A conta que não fecha, escrita antes que alguém a descubra somando.
 *
 * As quatro caixas somam mais do que o envio inteiro sempre que um parâmetro
 * mexe em dois valores. É informação, e não erro — mas só depois de dita.
 */
function Conciliacao({
  changes,
  overlap,
  unclassified,
}: {
  changes: number;
  overlap: number;
  unclassified: number;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {numero(changes)} alterações no envio.{" "}
      {overlap > 0 ? (
        <>
          <strong className="text-foreground">{numero(overlap)}</strong> contam em
          mais de uma classe — o mesmo parâmetro mexe em dois valores —, por isso
          as quatro caixas somam {numero(changes + overlap)} e não{" "}
          {numero(changes)}.{" "}
        </>
      ) : (
        <>Nenhuma conta em mais de uma classe neste envio. </>
      )}
      {unclassified > 0 ? (
        <>
          <strong className="text-foreground">{numero(unclassified)}</strong> ainda
          não têm classe: estão listadas pelo nome em “Não classificado”, e é de lá
          que sai o que falta acrescentar à tabela de classificação.
        </>
      ) : (
        <>Todos os parâmetros deste envio estão classificados.</>
      )}
    </p>
  );
}

/** Uma classe inteira: o cabeçalho e os parâmetros que caíram nela. */
function BlocoDeClasse({
  classe,
  envio,
  aberto,
}: {
  classe: TicketClassRollup;
  envio: string | null;
  aberto: boolean;
}) {
  if (!aberto) return null;
  const aparencia = aparenciaDe(classe.classe);

  return (
    <Card className="rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div
          className={cn(
            "h-10 w-10 rounded-xl grid place-content-center shrink-0",
            aparencia.bolha,
          )}
        >
          {aparencia.icone}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold tracking-tight">{classe.nome}</h3>
          <p className="text-xs text-muted-foreground">{classe.descricao}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums">
            {numero(classe.changes)}
          </div>
          <div className="text-xs text-muted-foreground">alterações</div>
        </div>
      </div>

      {classe.parameters.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {classe.classe === "NAO_CLASSIFICADO"
            ? "Todos os parâmetros deste envio estão classificados."
            : "Nenhum chamado deste envio mexeu neste valor. É uma resposta, e não uma tela vazia — o mês não tocou aqui."}
        </p>
      ) : (
        <ul>
          {classe.parameters.map((p) => (
            <LinhaDeParametro
              key={p.parameterLabel}
              parametro={p}
              classe={classe.classe}
              maior={classe.parameters[0]?.changes ?? p.changes}
              envio={envio}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Um parâmetro dentro de uma classe. Abre nos assuntos que o pediram. */
function LinhaDeParametro({
  parametro,
  classe,
  maior,
  envio,
}: {
  parametro: TicketParameterInClass;
  classe: string;
  maior: number;
  envio: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const aparencia = aparenciaDe(classe);
  const largura = maior > 0 ? Math.max(2, (parametro.changes / maior) * 100) : 0;

  return (
    <li className="border-b last:border-b-0">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        {aberto ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            {/*
              A justificativa mora no próprio nome, com sublinhado pontilhado:
              um "por quê" ao lado de cada parâmetro repetia a mesma palavra
              vinte vezes na mesma tela e competia com o que a pessoa veio ler.
            */}
            <span
              className={cn(
                "font-medium truncate",
                parametro.porque && "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 cursor-help",
              )}
              title={parametro.porque ?? undefined}
            >
              {parametro.parameterLabel}
            </span>
            {parametro.tambemEm.length > 0 && (
              <span
                className="text-[11px] rounded-full border px-1.5 py-0 text-muted-foreground"
                title="este parâmetro mexe em mais de um valor da remuneração, e por isso conta nas duas classes"
              >
                também no {rotuloCurto(parametro.tambemEm[0])}
              </span>
            )}
          </div>
          {/* Barra com trilho à vista: sem o trilho, o preenchido some debaixo
              do nome e vira sublinhado em vez de proporção. */}
          <div className="mt-2 h-1.5 rounded-full bg-muted/80 overflow-hidden max-w-xs">
            <div
              className={cn("h-full rounded-full", aparencia.barra)}
              style={{ width: `${largura}%` }}
            />
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-bold tabular-nums">{numero(parametro.changes)}</div>
          <div className="text-xs">
            <ImpactoCurto
              soma={parametro.impactSum}
              apuradas={parametro.calculated}
            />
          </div>
        </div>
      </button>

      {aberto && (
        <ul className="bg-muted/20 border-t">
          {parametro.subjects.map((s) => (
            <LinhaDeAssunto
              key={s.subject ?? "__sem_assunto__"}
              assunto={s}
              parameterLabel={parametro.parameterLabel}
              envio={envio}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const ROTULO_CURTO: Record<string, string> = {
  FIXO: "fixo",
  VARIAVEL: "variável",
  VARIAVEL_DIESEL: "variável diesel",
  NAO_CLASSIFICADO: "não classificado",
};

const rotuloCurto = (classe: string) => ROTULO_CURTO[classe] ?? classe.toLowerCase();

/**
 * Um assunto dentro de um parâmetro — a folha, e o ponto em que se vê o dado.
 *
 * O assunto é o texto que o chamado trouxe, e é ele que explica um número como
 * 1.041 alterações no mesmo parâmetro: não foram mil pedidos diferentes, foi um
 * ajuste em massa com o mesmo motivo escrito mil vezes.
 */
function LinhaDeAssunto({
  assunto,
  parameterLabel,
  envio,
}: {
  assunto: TicketSubjectRollup;
  parameterLabel: string;
  envio: string | null;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <li className="border-b last:border-b-0">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-3 pl-12 pr-5 py-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        {aberto ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "flex-1 truncate text-sm",
            assunto.subject === null && "italic text-muted-foreground",
          )}
        >
          {assunto.subject ?? "chamados sem assunto"}
        </span>
        <span className="text-xs">
          <ImpactoCurto soma={assunto.impactSum} apuradas={assunto.calculated} />
        </span>
        <span className="tabular-nums text-sm font-medium w-16 text-right shrink-0">
          {numero(assunto.changes)}
        </span>
      </button>

      {aberto && (
        <div className="border-t bg-card">
          <AlteracoesDaFolha
            parameterLabel={parameterLabel}
            subject={assunto.subject}
            envio={envio}
          />
        </div>
      )}
    </li>
  );
}

interface TicketsResponse {
  total: number;
  rows: TicketChangeRow[];
}

/**
 * As alterações de uma folha, com a tabela do Resumo.
 *
 * A mesma tabela, e não uma versão enxuta: é aqui que alguém veio conferir, e é
 * aqui que a proveniência do "antes", a marca do valor inferido e o chamado
 * inteiro precisam continuar a um clique de distância.
 *
 * Só busca quando a folha abre — uma árvore com cinquenta folhas não pode
 * carregar cinquenta listas para mostrar uma.
 */
function AlteracoesDaFolha({
  parameterLabel,
  subject,
  envio,
}: {
  parameterLabel: string;
  subject: string | null;
  envio: string | null;
}) {
  const filtros = {
    ...emptyTicketFilters,
    parameterLabel,
    subject: subject ?? "",
    subjectMissing: subject === null,
  };

  const query = useQuery({
    queryKey: ["tickets", "folha", envio, parameterLabel, subject],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/tickets?${toTicketQuery(filtros, envio ? { ticketImportId: envio } : {})}`,
      ),
  });

  if (query.isLoading) {
    return <p className="px-5 py-4 text-sm text-muted-foreground">Lendo…</p>;
  }
  if (!query.data) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground">
        Não foi possível carregar as alterações desta folha.
      </p>
    );
  }

  return (
    <TicketChangeTable rows={query.data.rows} total={query.data.total} />
  );
}
