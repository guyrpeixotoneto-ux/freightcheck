import { Link } from "wouter";
import {
  ArrowRight,
  ChevronRight,
  Coins,
  FileText,
  Layers,
  ListFilter,
  SlidersVertical,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  ComposicaoDasAlteracoes as Composicao,
  FatiaDeAlteracoes,
  FocoDeAlteracoes,
} from "@/lib/visao-geral";
import {
  linkDeAlteracoes,
  paramsDoRecorte,
  RECORTE_VAZIO,
  type Recorte,
} from "@/lib/recorte";

/**
 * De onde vêm as alterações detectadas — o painel que o segundo cartão abre.
 *
 * O cartão publicava "267" com uma frase que o contradiz: *"cada valor que
 * mudou entre a vigência anterior e esta"*. Medido em CAMAÇARI · EMPURRADA,
 * agosto/2026, **62 das 267 não são valor que mudou** — são troca de formato
 * pura, em que os dois lados valem o mesmo e o que mudou foi a forma de
 * exportar a coluna. Um quarto do número mais lido da tela descrevia outra
 * coisa, e nada na tela dizia isso.
 *
 * O painel abre **sobre** a tela pela mesma razão que os outros três desta
 * pasta: o número continua atrás, e o painel é a conta dele.
 *
 * A ordem das seções é a ordem em que a pergunta chega:
 *
 * 1. **O que aconteceu com o valor** — mexeu, ou só a forma mudou. É a partição
 *    que muda a leitura do número, e por isso vem primeiro.
 * 2. **De que tipo foi o sinal** — o selo que o motor já deu a cada ponto.
 * 3. **O que a apuração fez com elas** — virou dinheiro, saiu por dupla
 *    contagem, ficou sem preço. É a ponte para o cartão de Impacto líquido.
 * 4. **Os pontos tocados**, o de mais alterações primeiro, cada um abrindo a sua
 *    própria gaveta. É a lista que responde *quais*.
 * 5. **As portas** — a lista completa e o Acompanhamento, que é quem responde a
 *    pergunta que este painel de propósito não responde: por onde começar.
 *
 * Três recusas que valem aqui:
 *
 * - **Unidade única.** Tudo conta alterações, do topo ao fim. O Acompanhamento
 *   publica o mesmo panorama em pontos porque lá a fila é de pontos; trocar de
 *   unidade no meio faria as partições pararem de fechar com o número de cima.
 * - **Cada partição soma o total.** As três somam 267 — não são recortes
 *   parciais, e é por isso que podem ficar na mesma tela sem se contradizer.
 * - **Fatia sem filtro exato não vira link.** "Viraram dinheiro: 7" não abre
 *   `impactConfidence=CALCULATED`, que devolveria 19; o caminho até elas é a
 *   lista de pontos, onde cada um abre as suas próprias linhas.
 */
export function ComposicaoDasAlteracoes({
  composicao,
  periodLabel,
  period,
  recorte = RECORTE_VAZIO,
  onAbrirPonto,
  onTrocarFoco,
  onFechar,
}: {
  composicao: Composicao | null;
  periodLabel: string | null;
  period: string;
  recorte?: Recorte;
  /** Abre a conta de um ponto. Ver `DetalheDaAlteracao`. */
  onAbrirPonto: (chave: string) => void;
  /** Recorta a lista de pontos — nunca as partições acima dela. */
  onTrocarFoco: (foco: FocoDeAlteracoes) => void;
  onFechar: () => void;
}) {
  if (!composicao) return null;

  const daVigencia: Recorte = { ...recorte, period };

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {periodLabel ?? "Esta vigência"}
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
            De onde vêm as alterações detectadas
          </SheetTitle>

          <p className="text-[2rem] font-extrabold tabular-nums leading-none mt-4">
            {inteiro(composicao.total)}
            <span className="ml-2 text-base font-semibold text-muted-foreground">
              em {contar(composicao.pontos, "ponto da remuneração", "pontos da remuneração")}
            </span>
          </p>

          {/*
            A frase não conta as seções ("três leituras"): a primeira delas some
            nas vigências sem troca de formato, e um número escrito à mão aqui
            passaria a contradizer o que está logo abaixo.
          */}
          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            Cada leitura abaixo soma exatamente o número acima — são recortes do mesmo
            conjunto, e não fatias dele. Tudo aqui conta alterações; o Acompanhamento lê
            este mesmo panorama em pontos, porque lá a pergunta é por onde começar.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          {composicao.porEfeito.length > 0 && (
            <Particao
              icone={SlidersVertical}
              titulo="O que aconteceu com o valor"
              legenda="A partição que muda a leitura do número: nem toda alteração detectada é um valor diferente."
              fatias={composicao.porEfeito}
              destaque={composicao.foco === "todas" ? null : composicao.foco}
              cores={COR_DO_EFEITO}
              aoClicar={(chave) =>
                onTrocarFoco(
                  composicao.foco === chave ? "todas" : (chave as FocoDeAlteracoes),
                )
              }
            />
          )}

          <Particao
            icone={ListFilter}
            titulo="De que tipo foi o sinal"
            legenda="O selo que o motor deu a cada ponto, contado nas alterações dele."
            fatias={composicao.porNatureza}
            separada={composicao.porEfeito.length > 0}
          />

          <Particao
            icone={Coins}
            titulo="O que a apuração fez com elas"
            legenda="A ponte para o Impacto líquido: o que virou dinheiro, o que já estava contado noutro lugar, e o que ainda não tem preço."
            fatias={composicao.porApuracao}
            separada
          />

          <PontosTocados
            composicao={composicao}
            onAbrirPonto={onAbrirPonto}
            onTrocarFoco={onTrocarFoco}
          />

          <section className="flex flex-wrap gap-3 border-t pt-6">
            <Link
              href={linkDeAlteracoes({ recorte: daVigencia })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
            >
              Ver a lista completa, linha a linha
              <ArrowRight className="w-4 h-4" />
            </Link>
            {/*
              O Acompanhamento fica aqui porque este painel de propósito não
              responde "por onde começo": a criticidade conta pontos, e uma
              seção em pontos no meio de três em alterações faria as partições
              pararem de fechar com o número do topo. A fila é de lá.
            */}
            <Link
              href={`/vigencia?${paramsDoRecorte(daVigencia)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-5 py-2.5 text-sm font-bold hover:bg-accent transition-colors"
            >
              Abrir o Acompanhamento
              <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Uma partição
// ---------------------------------------------------------------------------

/**
 * Uma das três leituras — as fatias com a barra, o número e a nota.
 *
 * A barra é da fatia sobre o **total da vigência**, e não sobre a maior fatia
 * da lista: as três seções precisam ser lidas uma contra a outra, e uma escala
 * por seção faria "62 só formato" e "248 sem preço" terminarem no mesmo lugar.
 *
 * Fatia que abre alguma coisa vira link; fatia com `aoClicar` vira botão; as
 * demais são texto, e a nota diz o que elas são. Nenhuma delas inventa destino:
 * a razão de uma fatia não abrir nada está escrita em `FatiaDeAlteracoes.href`.
 */
function Particao({
  icone: Icone,
  titulo,
  legenda,
  fatias,
  cores,
  destaque,
  separada,
  aoClicar,
}: {
  icone: typeof FileText;
  titulo: string;
  legenda: string;
  fatias: FatiaDeAlteracoes[];
  cores?: Record<string, string>;
  destaque?: string | null;
  separada?: boolean;
  aoClicar?: (chave: string) => void;
}) {
  if (fatias.length === 0) return null;

  return (
    <section className={cn(separada && "border-t pt-6")}>
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <Icone className="w-4 h-4 text-muted-foreground" />
        {titulo}
      </h3>
      <p className="text-sm text-muted-foreground mt-1.5">{legenda}</p>

      <ul className="mt-4 space-y-2.5">
        {fatias.map((f) => {
          const corpo = (
            <>
              <span className="w-56 shrink-0 min-w-0">
                <span className="block text-sm font-semibold truncate" title={f.rotulo}>
                  {f.rotulo}
                </span>
                {f.pontos !== null && (
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {contar(f.pontos, "ponto", "pontos")}
                  </span>
                )}
              </span>
              <span className="flex-1 h-2.5 min-w-8 bg-muted overflow-hidden rounded-full">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    cores?.[f.chave] ?? "bg-brand",
                  )}
                  style={{ width: `${Math.max(2, f.proporcao * 100)}%` }}
                />
              </span>
              <span className="text-sm font-bold tabular-nums shrink-0 text-right w-28 whitespace-nowrap">
                {inteiro(f.alteracoes)}
                <span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">
                  {escreverPercentual(f.proporcao)}
                </span>
              </span>
            </>
          );

          const marcada = destaque === f.chave;

          return (
            <li key={f.chave}>
              {f.href !== null ? (
                <Link
                  href={f.href}
                  className="w-full flex items-center gap-3 rounded-lg px-2 -mx-2 py-1.5 -my-1.5 hover:bg-muted/60 transition-colors group"
                >
                  {corpo}
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                </Link>
              ) : aoClicar ? (
                <button
                  type="button"
                  onClick={() => aoClicar(f.chave)}
                  aria-pressed={marcada}
                  title={
                    marcada
                      ? "Ver os pontos de toda a vigência"
                      : `Ver os pontos em que ${f.rotulo.toLowerCase()}`
                  }
                  className={cn(
                    "w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    marcada ? "bg-accent" : "hover:bg-muted/60",
                  )}
                >
                  {corpo}
                  <ChevronRight
                    className={cn(
                      "w-4 h-4 shrink-0 text-muted-foreground transition-opacity",
                      marcada ? "opacity-100" : "opacity-40",
                    )}
                  />
                </button>
              ) : (
                <div className="w-full flex items-center gap-3 px-2 -mx-2 py-1.5 -my-1.5">
                  {corpo}
                  <span className="w-4 shrink-0" aria-hidden />
                </div>
              )}
              {f.nota !== null && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1 pl-2">{f.nota}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const COR_DO_EFEITO: Record<string, string> = {
  valor: "bg-brand",
  // Ardósia, e não âmbar: o que este selo diz é que **não** houve mudança
  // contratual. Vesti-lo de alerta reporia pela cor o susto que a
  // classificação acabou de tirar — a mesma decisão do selo FORMATO.
  formato: "bg-slate-400",
};

// ---------------------------------------------------------------------------
// Os pontos tocados
// ---------------------------------------------------------------------------

/**
 * A lista que responde *quais* — um ponto por linha, o de mais alterações
 * primeiro, cada um abrindo a própria gaveta.
 *
 * É a única seção que o foco recorta, e ela diz isso com todas as letras
 * quando recorta: as três partições acima continuam sobre a vigência inteira,
 * porque uma partição filtrada deixaria de somar o número do topo e o painel
 * passaria a se contradizer no meio de si mesmo.
 */
function PontosTocados({
  composicao,
  onAbrirPonto,
  onTrocarFoco,
}: {
  composicao: Composicao;
  onAbrirPonto: (chave: string) => void;
  onTrocarFoco: (foco: FocoDeAlteracoes) => void;
}) {
  const recortada = composicao.foco !== "todas";

  return (
    <section className="border-t pt-6">
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <Layers className="w-4 h-4 text-muted-foreground" />
        Os pontos tocados
      </h3>
      <p className="text-sm text-muted-foreground mt-1.5">
        {recortada ? (
          <>
            {contar(composicao.tocados.length, "ponto", "pontos")} de{" "}
            {inteiro(composicao.tocadosNoTotal)}, recortados em{" "}
            <strong className="text-foreground">
              {composicao.foco === "formato" ? "só o formato mudou" : "mexeram no valor"}
            </strong>
            .{" "}
            <button
              type="button"
              onClick={() => onTrocarFoco("todas")}
              className="font-semibold text-brand hover:underline"
            >
              Ver todos
            </button>
            .
          </>
        ) : (
          <>
            {contar(composicao.tocados.length, "ponto", "pontos")} da remuneração, o de mais
            alterações primeiro. Cada um abre a sua própria conta.
          </>
        )}
      </p>

      {composicao.tocados.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground border rounded-lg px-5 py-4">
          Nenhum ponto neste recorte.
        </p>
      ) : (
        <ol className="mt-4 space-y-2.5">
          {composicao.tocados.map((ponto) => (
            <li key={ponto.chave}>
              <button
                type="button"
                onClick={() => onAbrirPonto(ponto.chave)}
                title={`De onde vem ${ponto.titulo} — ${ponto.equipamento}`}
                className="w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors group"
              >
                <span className="flex-1 min-w-0">
                  <span
                    className="block text-sm font-semibold truncate group-hover:underline"
                    title={ponto.titulo}
                  >
                    {ponto.titulo}{" "}
                    <span className="font-normal text-muted-foreground">
                      — {ponto.equipamento}
                    </span>
                  </span>
                  <span className="block text-[0.6875rem] text-muted-foreground truncate">
                    {ponto.badgeLabel} · {contar(ponto.veiculos, "ativo", "ativos")}
                  </span>
                </span>
                <span className="w-28 sm:w-40 shrink-0 h-2.5 bg-muted overflow-hidden rounded-full">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      ponto.formatOnly ? "bg-slate-400" : "bg-brand",
                    )}
                    style={{ width: `${Math.max(2, ponto.proporcao * 100)}%` }}
                  />
                </span>
                <span className="text-sm font-bold tabular-nums shrink-0 text-right w-24 whitespace-nowrap">
                  {inteiro(ponto.alteracoes)}
                  <span className="ml-1 text-[0.6875rem] font-normal text-muted-foreground">
                    {ponto.alteracoes === 1 ? "alteração" : "alt."}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
              </button>
            </li>
          ))}
        </ol>
      )}

    </section>
  );
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

/** `23%` — arredondado ao inteiro, que é a precisão que uma proporção destas tem. */
function escreverPercentual(proporcao: number): string {
  return `${Math.round(proporcao * 100).toLocaleString("pt-BR")}%`;
}

/** `3 pontos`, `1 ponto` — o número por extenso com a palavra que ele rege. */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${inteiro(quantidade)} ${quantidade === 1 ? singular : plural}`;
}
