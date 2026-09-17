import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  TriangleAlert,
  Upload,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  EXPLICACAO_DA_SITUACAO,
  NOME_DA_SITUACAO,
  situacaoDaQuinzena,
  tipoJaEntrou,
  type LinhaDaQuinzena,
  type RunComVigencias,
  type SituacaoDaQuinzena,
} from "@/lib/quinzenas-do-acervo";
import { MES_LONGO } from "@/lib/calendario";
import { cn } from "@/lib/utils";

/**
 * A GRADE DAS QUINZENAS DE UM TIPO — o calendário ao lado do acervo.
 *
 * **A forma é a das duas Visões Gerenciais**, a da Auditoria e a do Fechamento:
 * uma casa por quinzena, na ordem do calendário, com etiqueta de situação,
 * legenda em cima e a casa vazia ocupando o mesmo espaço da cheia. Isso não é
 * imitação — é o que permite ler o ano de relance em qualquer uma das três sem
 * reaprender a leitura, e a casa vazia só aparece como buraco porque tem o
 * mesmo tamanho da casa que tem conteúdo.
 *
 * **O que muda em relação às outras duas é o significado**, e por isso o
 * vocabulário é próprio (`SituacaoDaQuinzena`, em `lib/quinzenas-do-acervo.ts`).
 * Lá a casa cheia é a competência encerrada ou a vigência comparada; aqui é a
 * planilha que entrou. E há uma situação que só existe aqui: a do tipo que esta
 * unidade **nunca** entregou, que é ausência e não falta — ver o cabeçalho do
 * módulo da régua.
 *
 * **A ação mora na casa vazia**, como o "Abrir agora" do Fechamento: é o botão
 * que declara a quinzena no envio, e é por ele que a importação passa a poder
 * conferir a declaração contra o rótulo de dentro do arquivo.
 */

/**
 * A aparência de cada situação — a etiqueta, e a casa.
 *
 * `SEM_ENVIO` é âmbar e não vermelho de propósito. No Fechamento o vermelho é
 * de "vencida em aberto", e ele é honesto lá porque a competência **devia** ter
 * sido aberta: alguém a declarou esperada. Aqui ninguém declarou que esta
 * unidade entrega quinzenalmente — o que se afirma é que a quinzena existe e
 * nada entrou nela. Âmbar é o tamanho certo dessa afirmação; vermelho cobraria
 * uma dívida que o produto não registrou.
 */
export const APARENCIA_DA_SITUACAO: Record<
  SituacaoDaQuinzena,
  { casa: string; etiqueta: string; celula: string; icon: LucideIcon }
> = {
  ENTROU: {
    casa: "bg-card",
    etiqueta: "border-emerald-200 bg-emerald-50 text-emerald-700",
    celula: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle2,
  },
  SEM_ENVIO: {
    casa: "bg-amber-50/60 border-amber-200 border-dashed",
    etiqueta: "border-amber-300 bg-amber-100 text-amber-900",
    celula: "border-amber-300 border-dashed bg-amber-50 text-amber-900",
    icon: TriangleAlert,
  },
  EM_CURSO: {
    casa: "bg-card border-primary/30",
    etiqueta: "border-primary/30 bg-primary/10 text-primary",
    celula: "border-primary/30 bg-primary/5 text-primary",
    icon: CircleDashed,
  },
  NUNCA_ENTREGUE: {
    casa: "bg-muted/20 border-dashed",
    etiqueta: "border-border border-dashed bg-muted text-muted-foreground",
    celula: "border-border border-dashed bg-muted/40 text-muted-foreground",
    icon: CircleSlash,
  },
};

/** A situação por extenso, na etiqueta da casa. */
export function EtiquetaDaSituacao({
  situacao,
  className,
}: {
  situacao: SituacaoDaQuinzena;
  className?: string;
}) {
  const { etiqueta, icon: Icone } = APARENCIA_DA_SITUACAO[situacao];
  return (
    <span
      title={EXPLICACAO_DA_SITUACAO[situacao]}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide whitespace-nowrap",
        etiqueta,
        className,
      )}
    >
      <Icone className="w-3 h-3" />
      {NOME_DA_SITUACAO[situacao]}
    </span>
  );
}

/** A legenda das quatro situações, para quem lê a grade pela primeira vez. */
export function LegendaDasSituacoes({ className }: { className?: string }) {
  const situacoes: SituacaoDaQuinzena[] = [
    "ENTROU",
    "SEM_ENVIO",
    "EM_CURSO",
    "NUNCA_ENTREGUE",
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {situacoes.map((situacao) => (
        <li
          key={situacao}
          title={EXPLICACAO_DA_SITUACAO[situacao]}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            className={cn(
              "w-3 h-3 rounded-[3px] border",
              APARENCIA_DA_SITUACAO[situacao].celula,
            )}
          />
          {NOME_DA_SITUACAO[situacao]}
        </li>
      ))}
    </ul>
  );
}

/*
  A casa nomeia o arquivo, então o que ela recebe é um pouco mais do que a régua
  pede: `RunComVigencias` responde *em que quinzena isto caiu*, e a casa também
  precisa dizer *qual arquivo foi*. É a menor extensão possível — o nome, e nada
  além dele.
*/

/** `2026-09-16` vira `16/09/2026` — o ano entra porque a grade cruza anos. */
const emDia = (iso: string): string =>
  `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Uma quinzena do calendário, para um tipo.
 *
 * A casa vazia continua ocupando o mesmo espaço da cheia — é o que permite ler
 * a série de relance e ver onde ela falha, exatamente como na grade do ano do
 * Fechamento.
 */
function CasaDaQuinzena<T extends RunComVigencias & { filename: string }>({
  linha,
  tipo,
  situacao,
  onAbrir,
  onEnviar,
  enviando,
}: {
  linha: LinhaDaQuinzena<T>;
  tipo: { code: string; rotulo: string };
  situacao: SituacaoDaQuinzena;
  onAbrir: (importRunId: string) => void;
  onEnviar: (inicioDaQuinzena: string) => void;
  enviando: boolean;
}) {
  const envios = linha.porTipo.get(tipo.code) ?? [];
  const aparencia = APARENCIA_DA_SITUACAO[situacao];

  return (
    <div
      className={cn("rounded-lg border p-4 flex flex-col gap-3", aparencia.casa)}
      data-testid={`quinzena-${linha.periodo.chave}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-bold">
            {linha.periodo.quinzena}ª de {MES_LONGO[linha.periodo.mes - 1]}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {emDia(linha.periodo.inicio)} a {emDia(linha.periodo.fim)}
          </span>
        </span>
        <EtiquetaDaSituacao situacao={situacao} />
      </div>

      {envios.length > 0 ? (
        <div className="space-y-0.5">
          {envios.map(({ run, label }) => (
            <button
              key={run.importRunId}
              onClick={() => onAbrir(run.importRunId)}
              title={`Abrir o cartão de ${run.filename}`}
              className="w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 -mx-2 hover:bg-muted/60 transition-colors text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">
                  {run.filename}
                </span>
                <span className="block text-xs text-muted-foreground font-mono">
                  {label}
                </span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {situacao === "EM_CURSO"
              ? `A quinzena ainda está correndo, e nada de ${tipo.rotulo.toLowerCase()} entrou nela até agora.`
              : situacao === "SEM_ENVIO"
                ? `A quinzena terminou e nenhuma planilha de ${tipo.rotulo.toLowerCase()} entrou nela.`
                : `Nada de ${tipo.rotulo.toLowerCase()} entrou nesta unidade, em quinzena nenhuma.`}
          </p>
          {/*
            O envio da casa — e é ele que declara a quinzena.

            Enviar por aqui diz "esta quinzena", como a aba diz "este tipo", e a
            importação confere as duas contra o conteúdo antes de deixar entrar:
            o arquivo cujo rótulo diz outra quinzena é recusado por
            `QUINZENA_DIVERGE_DA_DECLARACAO`, em vez de entrar calado na vigência
            que ele nomeia.
          */}
          <button
            onClick={() => onEnviar(linha.periodo.inicio)}
            disabled={enviando}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline",
              enviando && "opacity-50 cursor-not-allowed no-underline",
            )}
          >
            <Upload className="w-3.5 h-3.5" />
            Enviar esta quinzena
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * As quinzenas de um tipo, na ordem do calendário — a grade inteira.
 *
 * Quatro colunas no monitor largo, uma no telefone, como a grade do ano do
 * Fechamento: são as mesmas casas, lidas do mesmo jeito.
 */
export function GradeDeQuinzenas<T extends RunComVigencias & { filename: string }>({
  linhas,
  tipo,
  onAbrir,
  onEnviar,
  enviando,
}: {
  linhas: LinhaDaQuinzena<T>[];
  tipo: { code: string; rotulo: string };
  onAbrir: (importRunId: string) => void;
  onEnviar: (inicioDaQuinzena: string) => void;
  enviando: boolean;
}) {
  const jaEntrou = tipoJaEntrou(linhas, tipo.code);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {linhas.map((linha) => (
        <CasaDaQuinzena
          key={linha.periodo.chave}
          linha={linha}
          tipo={tipo}
          situacao={situacaoDaQuinzena(linha, tipo.code, jaEntrou)}
          onAbrir={onAbrir}
          onEnviar={onEnviar}
          enviando={enviando}
        />
      ))}
    </div>
  );
}
