import { cn } from "@/lib/utils";
import { LinhaDeLista } from "@/components/panorama/linha-de-lista";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  FILTROS_DE_MUDANCA,
  ROTULO_DO_FILTRO,
  type FiltroDeMudanca,
} from "@/lib/impacto-apurado";
import {
  GRAOS_DO_RANKING,
  ROTULO_DO_GRAO,
  type GraoDoRanking,
  type LinhaDoRanking,
} from "@/lib/panorama";

/**
 * Dobra 2 — *"onde o dinheiro se mexeu?"*, em dois grãos e num cartão só.
 *
 * Este cartão substitui três: os dois pódios de família (o que somou, o que
 * tirou) e a lista de parâmetros. Os três liam a mesma resposta, tinham a mesma
 * forma de linha e respondiam a mesma pergunta em recortes diferentes — e
 * empilhados de largura inteira custavam duas telas de rolagem para, num
 * recorte de uma família, mostrar três linhas de conteúdo. O que os separava
 * eram duas escolhas, e escolha é chave, não cartão:
 *
 * - **o grão** — família (o agregado) ou parâmetro (o degrau abaixo);
 * - **o lado** — todos, ganhos ou perdas.
 *
 * As duas viajam no endereço, e é por isso que elas podem ser chaves: um link
 * colado abre exatamente o recorte que quem colou estava lendo. É a mesma regra
 * do filtro que a lista de parâmetros já tinha (`?mudancas=`), agora com
 * `?grao=` ao lado.
 *
 * **Nada aqui calcula.** As linhas chegam prontas de `rankingPorFamilia` e
 * `rankingPorParametro` (`lib/panorama.ts`), que projetam a mesma lista de
 * famílias que a ponte ao lado desenha, na mesma periodicidade. Dois grãos que
 * somassem por conta própria seriam duas verdades sobre a mesma vigência.
 */
export function Ranking({
  linhas,
  grao,
  filtro,
  periodicidade,
  contagens,
  chaveAberta,
  onGrao,
  onFiltro,
  onAbrir,
  nota,
  className,
}: {
  linhas: LinhaDoRanking[];
  grao: GraoDoRanking;
  filtro: FiltroDeMudanca;
  /** A periodicidade da vigência — a mesma do veredito e da ponte. */
  periodicidade: string | null;
  /** Quantas linhas cada lado tem, para o botão vazio nascer desabilitado. */
  contagens: Record<FiltroDeMudanca, number>;
  /** A gaveta aberta (família ou parâmetro), para a linha ficar marcada atrás dela. */
  chaveAberta: string | null;
  onGrao: (grao: GraoDoRanking) => void;
  onFiltro: (filtro: FiltroDeMudanca) => void;
  /**
   * `null` quando não há gaveta a abrir — a Visão Geral soma unidades e não tem
   * a quem perguntar de onde vem o número. Sem destino a linha deixa de ser
   * botão, em vez de virar um botão que não leva a lugar nenhum.
   */
  onAbrir: ((chave: string) => void) | null;
  /** A ressalva de quem chama, no lugar da promessa de clique. */
  nota?: string;
  className?: string;
}) {
  const sufixo = periodicitySuffix(periodicidade);

  return (
    <section
      className={cn("superficie px-6 py-5", className)}
      aria-label="Onde o dinheiro se mexeu"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold">Onde o dinheiro se mexeu</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Maior impacto financeiro{sufixo ? ` (R$${sufixo})` : ""}, por{" "}
            {grao === "familia" ? "família da remuneração" : "parâmetro"}
          </p>
        </div>
        {/*
          O grão é um par de pastilhas, e não um `select`: são duas opções, as
          duas curtas, e o que se quer é ver as duas de uma vez — trocar de grão
          é a leitura, não uma configuração da tela.
        */}
        <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Grão da lista">
          {GRAOS_DO_RANKING.map((opcao) => (
            <Pastilha
              key={opcao}
              ativa={grao === opcao}
              onClick={() => onGrao(opcao)}
              rotulo={ROTULO_DO_GRAO[opcao]}
            />
          ))}
        </div>
      </div>

      <div
        className="flex items-center gap-1 mt-3 border-t pt-3"
        role="group"
        aria-label="Recorte da lista"
      >
        {FILTROS_DE_MUDANCA.map((opcao) => (
          <Pastilha
            key={opcao}
            ativa={filtro === opcao}
            /* O lado vazio não vira um clique que esvazia a lista. "Todos" nunca
               desabilita: é para onde se volta. */
            desabilitada={contagens[opcao] === 0 && opcao !== "todos"}
            onClick={() => onFiltro(opcao)}
            rotulo={ROTULO_DO_FILTRO[opcao]}
            miuda
          />
        ))}
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          {contagens.todos === 0
            ? "Nenhuma alteração desta vigência tem valor apurado — não há o que ranquear."
            : "Nenhuma linha neste recorte."}
        </p>
      ) : (
        <ol className="mt-1 divide-y">
          {linhas.map((linha, indice) => (
            <Linha
              key={linha.chave}
              posicao={indice + 1}
              linha={linha}
              sufixo={sufixo}
              aberta={chaveAberta === linha.chave}
              onAbrir={onAbrir}
            />
          ))}
        </ol>
      )}

      {nota && <p className="text-xs text-muted-foreground mt-4">{nota}</p>}
    </section>
  );
}

function Pastilha({
  ativa,
  desabilitada = false,
  onClick,
  rotulo,
  miuda = false,
}: {
  ativa: boolean;
  desabilitada?: boolean;
  onClick: () => void;
  rotulo: string;
  miuda?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      disabled={desabilitada}
      className={cn(
        "rounded-lg font-bold transition-colors",
        miuda ? "px-2.5 py-1 text-[0.6875rem]" : "px-3 py-1.5 text-xs",
        ativa
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {rotulo}
    </button>
  );
}

/**
 * A cor e a palavra de cada classificação — as mesmas da lista de parâmetros,
 * porque é a mesma régua lida no mesmo cartão.
 */
const TOM_DA_LINHA: Record<
  LinhaDoRanking["classificacao"],
  { rotulo: string; selo: string; barra: string; valor: string }
> = {
  ganho: {
    rotulo: "Ganho",
    selo: "bg-emerald-50 text-emerald-700",
    barra: "bg-emerald-600",
    valor: "text-emerald-700",
  },
  perda: {
    rotulo: "Perda",
    selo: "bg-red-50 text-red-700",
    barra: "bg-red-600",
    valor: "text-red-700",
  },
  compensado: {
    rotulo: "Compensado",
    selo: "bg-muted text-muted-foreground",
    barra: "bg-muted-foreground/60",
    valor: "text-foreground",
  },
};

/**
 * Uma linha — e ela é a **mesma** nos dois grãos, e a mesma do cartão ao lado.
 *
 * Nome, contexto, barra e valor: o que troca entre família e parâmetro é o que
 * `LinhaDoRanking` já resolveu lá na leitura. Dois desenhos de linha, um por
 * grão, é onde os três cartões antigos começaram a divergir — e o desenho em si
 * saiu deste arquivo por causa do terceiro ranking da tela, o dos tipos de
 * ativo: `LinhaDeLista` é a forma, e cada lista decide o que entra em cada
 * lugar dela.
 */
function Linha({
  posicao,
  linha,
  sufixo,
  aberta,
  onAbrir,
}: {
  posicao: number;
  linha: LinhaDoRanking;
  sufixo: string;
  aberta: boolean;
  onAbrir: ((chave: string) => void) | null;
}) {
  const tom = TOM_DA_LINHA[linha.classificacao];

  return (
    <LinhaDeLista
      posicao={posicao}
      nome={linha.nome}
      contexto={linha.contexto}
      selo={{ rotulo: tom.rotulo, classe: tom.selo }}
      proporcao={linha.proporcao}
      corDaBarra={tom.barra}
      valor={formatBrlShort(linha.valor)}
      corDoValor={tom.valor}
      /*
        O líquido embaixo só nos recortes de um lado, onde o número de cima é
        uma parcela: a família que somou R$ 40 mil e tirou R$ 39 mil se leria,
        sem ele, como dois acontecimentos enormes e independentes. No recorte
        inteiro o de cima já **é** o líquido, e repeti-lo diria duas vezes a
        mesma coisa — sobra o sufixo da periodicidade, que nunca some.
      */
      subvalor={linha.liquido !== null ? `líquido ${formatBrlShort(linha.liquido)}` : sufixo}
      aberta={aberta}
      titulo={onAbrir ? `De onde vem o impacto de ${linha.nome}` : undefined}
      onAbrir={onAbrir ? () => onAbrir(linha.chave) : null}
    />
  );
}
