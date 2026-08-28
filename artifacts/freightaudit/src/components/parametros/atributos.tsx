/**
 * A grade de atributos — o que mudou nesta quinzena, arrumado por escopo.
 *
 * O espelho do Freightech continua sendo a outra aba desta tela, e continua
 * fiel. Esta aqui responde a outra pergunta, que é a de quem audita: **de qual
 * coisa** quero ver o que mudou. As gavetas de lá não têm essa divisão — CAVALO
 * e CARRETA são dois cartões dentro de FROTA, entre COMBUSTÍVEL e PRAZO FINAME,
 * que valem para os dois — e por isso encontrar "tudo o que mexeu nas carretas"
 * exigia abrir cartão por cartão e somar de cabeça.
 *
 * Três coisas mudam de lugar aqui, e as três vêm da mesma reclamação:
 *
 * 1. **O cartão é o atributo**, e não a gaveta. `carreta.finame` é um cartão, e
 *    abre nos veículos daquela unidade naquela quinzena — o degrau seguinte da
 *    hierarquia VISÃO GERAL → ESCOPO → ATRIBUTO → VEÍCULO → EVIDÊNCIA. Antes ele
 *    era uma linha de tabela dentro de um cartão, a três cliques da grade.
 * 2. **O escopo é a navegação principal**, na fileira de pastilhas do topo.
 * 3. **A busca procura no que a pessoa tem na mão** — o rótulo, o código, o
 *    parâmetro, a família.
 *
 * **A forma é a das telas novas**, e não a da grade do Freightech: cartão
 * `rounded-xl` com sombra, ladrilho de ícone colorido pelo que a linha é, número
 * grande e o miolo em corpos de letra distintos, em vez de seis linhas do mesmo
 * tamanho em que o olho não tem onde pousar. A grade do espelho continua com a
 * forma de lá, porque lá a forma **é** o ponto; aqui o ponto é ler rápido.
 *
 * As recusas continuam de pé, e uma delas fica mais visível aqui: **nunca somar
 * periodicidades**. A ordenação por impacto ordena pelo tamanho do movimento
 * dentro da periodicidade de cada linha e empurra para o fim o que não tem
 * preço — sem preço não é zero, e tratá-lo como zero o esconderia justamente de
 * quem precisa saber que ele existe.
 */

import { useMemo } from "react";
import {
  Briefcase,
  ChevronRight,
  CircleHelp,
  Combine,
  Container,
  Info,
  Lock,
  Minus,
  Route,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  X,
} from "lucide-react";
import { BeforeAfter, GroupCard } from "@/components/inicio/group-card";
import { AlteracaoPorUnidade } from "@/components/parametros/visao-geral";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useFavoritos } from "@/lib/favoritos";
import { formatBrlCompacto, periodicitySuffix } from "@/lib/format";
import type { Recorte } from "@/lib/recorte";
import {
  ESCOPOS,
  ORDENS,
  combina,
  contarPorEscopo,
  escopoDe,
  escoposImportados,
  ordenar,
  type AtributoRender,
  type EscopoCode,
  type OrdemCode,
} from "@/lib/escopos";
import type { ChangeGroup, FamiliesView } from "@/components/inicio/types";

/** A estrela dos atributos mora numa chave própria — ver `useFavoritos`. */
const CHAVE_FAVORITOS = "freightcheck:parametros-atributos-favoritos";

/** O ícone de cada escopo, para o cabeçalho da seção e a pastilha. */
const ICONE_DO_ESCOPO: Record<EscopoCode, React.ReactNode> = {
  CAVALO: <Truck className="w-5 h-5" />,
  CARRETA: <Container className="w-5 h-5" />,
  CONJUNTO: <Combine className="w-5 h-5" />,
  TRECHO: <Route className="w-5 h-5" />,
  QLP_ADMINISTRATIVO: <Briefcase className="w-5 h-5" />,
  QLP_OPERACIONAL: <Users className="w-5 h-5" />,
  SEM_ESCOPO: <CircleHelp className="w-5 h-5" />,
};

/**
 * O ladrilho do cartão — o mesmo vocabulário de cor dos `MetricCard` das outras
 * telas.
 *
 * **Uma dimensão de cor por cartão, e é esta.** O escopo já está dito pela seção
 * em que o cartão está; pintar os dois faria duas escalas competirem pelo mesmo
 * olhar, e nenhuma das duas seria lida.
 */
const LADRILHO: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-600",
  red: "bg-red-50 text-red-600",
  orange: "bg-orange-50 text-orange-600",
  blue: "bg-blue-50 text-blue-600",
  purple: "bg-violet-50 text-violet-600",
  slate: "bg-slate-100 text-slate-500",
};

/**
 * Qual ladrilho cada atributo recebe.
 *
 * O dinheiro manda primeiro, e pelo **sinal**: uma perda e um ganho são as duas
 * coisas que quem abre esta tela está procurando, e são as únicas que merecem
 * verde e vermelho. O resto sai do selo que o servidor já calculou — não de uma
 * segunda classificação escrita aqui, que um dia discordaria dele.
 */
function ladrilhoDe(grupo: ChangeGroup): { tom: string; icone: React.ReactNode } {
  const valor = grupo.impact.amount;
  if (valor !== null && valor !== 0) {
    return valor < 0
      ? { tom: "red", icone: <TrendingDown className="w-5 h-5" /> }
      : { tom: "green", icone: <TrendingUp className="w-5 h-5" /> };
  }
  switch (grupo.badge) {
    case "RUPTURA":
      return { tom: "orange", icone: <CircleHelp className="w-5 h-5" /> };
    case "COBERTURA":
      return { tom: "blue", icone: <Truck className="w-5 h-5" /> };
    case "MOVIMENTO":
      return { tom: "purple", icone: <TrendingUp className="w-5 h-5" /> };
    case "TRAVADO":
      return { tom: "slate", icone: <Lock className="w-5 h-5" /> };
    case "FORMATO":
      return { tom: "slate", icone: <Info className="w-5 h-5" /> };
    default:
      return { tom: "slate", icone: <Minus className="w-5 h-5" /> };
  }
}

export function GradeDeAtributos({
  recorte,
  view,
  atributos,
  escopo,
  busca,
  ordem,
  atributoAberto,
  carregando,
  temCartao,
  onEscopo,
  onBusca,
  onOrdem,
  onAbrir,
  onIrParaCartao,
}: {
  /** De quem é a grade — unidade e canal, que o nível 2 do cartão precisa. */
  recorte: Recorte;
  view: FamiliesView | null;
  atributos: AtributoRender[];
  /** `null` é "todos" — a grade sai partida por escopo, na ordem de peso. */
  escopo: EscopoCode | null;
  busca: string;
  ordem: OrdemCode;
  atributoAberto: string | null;
  /** Enquanto a vigência carrega, um endereço que ainda não achou não é ausência. */
  carregando: boolean;
  /** Se a gaveta do Freightech que contém aquele parâmetro existe nesta vigência. */
  temCartao: (parametroChave: string) => boolean;
  onEscopo: (valor: EscopoCode | null) => void;
  onBusca: (valor: string) => void;
  onOrdem: (valor: OrdemCode) => void;
  onAbrir: (chave: string | null) => void;
  onIrParaCartao: (parametroChave: string) => void;
}) {
  const { favoritos, alternar } = useFavoritos(CHAVE_FAVORITOS);

  const importados = useMemo(() => escoposImportados(view), [view]);

  /*
    As contagens da fileira saem da lista **inteira**, e não da filtrada.

    É deliberado: ela é o mapa do que existe, e um mapa que se redesenha a cada
    letra digitada deixa de dizer onde as coisas estão. Digitar "finame" com
    CAVALO selecionado precisa continuar mostrando que há finame em CARRETA e em
    CONJUNTO — senão a busca esconde exatamente o que ela deveria ajudar a achar.
    Quantos sobram da busca é outra pergunta, respondida logo abaixo.
  */
  const contagens = useMemo(() => contarPorEscopo(atributos), [atributos]);
  const contagemPorEscopo = useMemo(
    () => new Map(contagens.map((c) => [c.escopo.code, c])),
    [contagens],
  );

  const filtrados = useMemo(
    () =>
      atributos
        .filter((a) => (escopo === null ? true : a.escopo === escopo))
        .filter((a) => combina(a, busca)),
    [atributos, escopo, busca],
  );

  const ordenados = useMemo(() => ordenar(filtrados, ordem), [filtrados, ordem]);

  const aberto = useMemo(
    () => atributos.find((a) => a.chave === atributoAberto) ?? null,
    [atributos, atributoAberto],
  );

  const marcados = useMemo(
    () => ordenados.filter((a) => favoritos.includes(a.chave)),
    [ordenados, favoritos],
  );

  /*
    Com um atributo aberto, a grade sai da tela.

    O detalhe traz gráfico, proveniência e a lista de veículos — é uma tela
    inteira, e empilhá-la sobre uma grade de duzentos cartões faria a rolagem
    perder o assunto. A grade volta intacta no VOLTAR: escopo, busca e ordem
    moram na URL, não neste componente.
  */
  if (aberto) {
    return (
      <DetalheDoAtributo
        atributo={aberto}
        period={view?.period ?? ""}
        recorte={recorte}
        temCartao={temCartao}
        onVoltar={() => onAbrir(null)}
        onIrParaCartao={onIrParaCartao}
      />
    );
  }

  /*
    O endereço que aponta para um atributo que este recorte não tem.

    Vem de trocar de unidade ou de vigência com um atributo aberto — o que é
    justamente o que se quer fazer ali dentro ("e em Manaus, o finame mexeu?").
    Cair de volta na grade sem dizer nada faria parecer erro de clique, quando a
    informação é a oposta e é de auditoria: **naquele recorte aquele atributo
    não se mexeu.**
  */
  if (atributoAberto !== null && !carregando) {
    return (
      <AtributoAusente chave={atributoAberto} view={view} onVoltar={() => onAbrir(null)} />
    );
  }

  /*
    Seção vazia não entra — nem com um escopo escolhido. A caixa acima já diz
    por que não há nada, e um título com "0 atributos" embaixo dele repete a
    mesma resposta ocupando o dobro do espaço.
  */
  const secoes = (
    escopo === null
      ? [...ESCOPOS, escopoDe("SEM_ESCOPO")].map((e) => ({
          escopo: e,
          itens: ordenados.filter((a) => a.escopo === e.code),
        }))
      : [{ escopo: escopoDe(escopo), itens: ordenados }]
  ).filter((s) => s.itens.length > 0);

  return (
    <>
      <BarraDeEscopos
        escopo={escopo}
        contagens={contagens}
        importados={importados}
        total={atributos.length}
        onEscopo={onEscopo}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[18rem] max-w-2xl">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={busca}
            onChange={(event) => onBusca(event.target.value)}
            placeholder="Buscar por rótulo, código da coluna, parâmetro ou família"
            aria-label="Buscar atributo por rótulo, código, parâmetro ou família"
            className="h-11 w-full rounded-full border border-input bg-background pl-9 pr-9 text-sm outline-none transition-colors focus:border-brand"
          />
          {busca && (
            <button
              type="button"
              onClick={() => onBusca("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <Select value={ordem} onValueChange={(v) => onOrdem(v as OrdemCode)}>
          <SelectTrigger
            aria-label="Ordenar os atributos"
            className="w-48 h-11 rounded-full bg-background"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDENS.map((o) => (
              <SelectItem key={o.code} value={o.code}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResumoDoRecorte
        total={atributos.length}
        filtrados={ordenados}
        escopo={escopo}
        busca={busca}
      />

      {ordenados.length === 0 && (
        <Vazio
          escopo={escopo}
          busca={busca}
          /*
            Sem escopo escolhido, "importado" é "chegou alguma coisa". Ler isto
            como verdadeiro no caso vazio punha a tela dizendo "o arquivo chegou
            e a comparação foi feita" num banco onde não há vigência nenhuma. A
            frase certa ali é a oposta, e a diferença entre as duas é o que
            decide se alguém vai cobrar um export do cliente.
          */
          importado={escopo === null ? importados.size > 0 : importados.has(escopo)}
          temNoEscopo={escopo !== null && (contagemPorEscopo.get(escopo)?.atributos ?? 0) > 0}
          onLimpar={() => onBusca("")}
        />
      )}

      {marcados.length > 0 && (
        <Secao
          icone={<Star className="w-5 h-5" />}
          titulo="Favoritos"
          contagem={`${marcados.length} ${marcados.length === 1 ? "atributo" : "atributos"}`}
          descricao="Os atributos que você marcou, dentro do recorte visível."
        >
          {marcados.map((atributo) => (
            <CartaoDeAtributo
              key={`fav-${atributo.chave}`}
              atributo={atributo}
              favorito
              mostrarEscopo
              onFavoritar={() => alternar(atributo.chave)}
              onAbrir={() => onAbrir(atributo.chave)}
            />
          ))}
        </Secao>
      )}

      {secoes.map((secao) => {
        const alteracoes = somaDeAlteracoes(secao.itens);
        return (
          <Secao
            key={secao.escopo.code}
            icone={ICONE_DO_ESCOPO[secao.escopo.code]}
            titulo={secao.escopo.nome}
            contagem={`${secao.itens.length} ${
              secao.itens.length === 1 ? "atributo" : "atributos"
            } · ${alteracoes} ${alteracoes === 1 ? "alteração" : "alterações"}`}
            descricao={secao.escopo.grao}
          >
            {secao.itens.map((atributo) => (
              <CartaoDeAtributo
                key={atributo.chave}
                atributo={atributo}
                favorito={favoritos.includes(atributo.chave)}
                mostrarEscopo={false}
                onFavoritar={() => alternar(atributo.chave)}
                onAbrir={() => onAbrir(atributo.chave)}
              />
            ))}
          </Secao>
        );
      })}
    </>
  );
}

function somaDeAlteracoes(atributos: AtributoRender[]): number {
  return atributos.reduce((soma, a) => soma + a.grupo.changes, 0);
}

/* ------------------------------------------------------------------ */
/* A fileira de escopos                                                */
/* ------------------------------------------------------------------ */

/**
 * As pastilhas do topo — a navegação principal desta aba, na forma da fileira
 * de Alterações.
 *
 * Cada uma diz quantos atributos mexeram, e o escopo que **não** foi importado
 * aparece com um travessão em vez de sumir. Sumir seria confundir duas coisas
 * que um auditor precisa distinguir: "não chegou arquivo de trecho nesta
 * unidade" e "chegou e ninguém mexeu em nada". A pastilha apagada ainda clica, e
 * a tela do outro lado escreve qual dos dois é.
 */
function BarraDeEscopos({
  escopo,
  contagens,
  importados,
  total,
  onEscopo,
}: {
  escopo: EscopoCode | null;
  contagens: ReturnType<typeof contarPorEscopo>;
  importados: Set<EscopoCode>;
  total: number;
  onEscopo: (valor: EscopoCode | null) => void;
}) {
  const porCodigo = new Map(contagens.map((c) => [c.escopo.code, c]));
  const semEscopo = porCodigo.get("SEM_ESCOPO");
  const lista = [...ESCOPOS, ...(semEscopo ? [semEscopo.escopo] : [])];

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Pastilha
        ativa={escopo === null}
        apagada={false}
        onClick={() => onEscopo(null)}
        contagem={total}
        titulo="Todos os atributos alterados nesta vigência"
      >
        Todos
      </Pastilha>

      {lista.map((e) => {
        const contagem = porCodigo.get(e.code);
        const importado = e.code === "SEM_ESCOPO" || importados.has(e.code);
        return (
          <Pastilha
            key={e.code}
            ativa={escopo === e.code}
            apagada={!contagem}
            onClick={() => onEscopo(e.code)}
            contagem={contagem?.atributos ?? null}
            titulo={
              contagem
                ? `${contagem.atributos} atributos · ${contagem.alteracoes} alterações`
                : importado
                  ? "Importado nesta vigência, sem alteração neste recorte"
                  : "Nenhum arquivo deste tipo chegou nesta vigência"
            }
            icone={ICONE_DO_ESCOPO[e.code]}
          >
            {e.rotulo}
          </Pastilha>
        );
      })}
    </div>
  );
}

/**
 * A pastilha grande da fileira da frente — a mesma de Alterações.
 *
 * A contagem vem numa bolha ao lado do nome, e não numa segunda linha: o que se
 * compara entre pastilhas é o tamanho, e números alinhados na mesma altura se
 * comparam de relance. Escopo sem nada mostra um travessão, que é diferente de
 * zero — zero seria uma contagem apurada, e "—" é a ausência dela.
 */
function Pastilha({
  ativa,
  apagada,
  contagem,
  icone,
  titulo,
  onClick,
  children,
}: {
  ativa: boolean;
  apagada: boolean;
  contagem: number | null;
  icone?: React.ReactNode;
  titulo?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      title={titulo}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
        ativa
          ? "bg-brand border-brand text-brand-foreground shadow-sm"
          : apagada
            ? "bg-background border-input text-muted-foreground hover:bg-muted"
            : "bg-background border-input text-foreground hover:bg-muted",
      )}
    >
      {icone && (
        <span className={cn("shrink-0", !ativa && "text-muted-foreground")}>{icone}</span>
      )}
      {children}
      <span
        className={cn(
          "text-xs tabular-nums rounded-full px-1.5 py-0.5",
          ativa ? "bg-white/20" : "bg-muted text-muted-foreground",
        )}
      >
        {contagem === null ? "—" : contagem}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* O recorte, dito em uma linha                                        */
/* ------------------------------------------------------------------ */

/**
 * Quantos sobraram, e de quantos.
 *
 * Existe porque a fileira de pastilhas conta a lista inteira de propósito (ver
 * acima) e alguém precisa responder "e com o que eu digitei, quantos são?". Sem
 * esta linha, um termo que não acha nada em CAVALO deixaria a tela com uma
 * pastilha dizendo "15" e uma grade vazia embaixo.
 */
function ResumoDoRecorte({
  total,
  filtrados,
  escopo,
  busca,
}: {
  total: number;
  filtrados: AtributoRender[];
  escopo: EscopoCode | null;
  busca: string;
}) {
  const recortado = escopo !== null || busca.trim() !== "";
  const alteracoes = somaDeAlteracoes(filtrados);

  return (
    <p className="mt-4 text-sm text-muted-foreground">
      <strong className="text-foreground tabular-nums">{filtrados.length}</strong>{" "}
      {filtrados.length === 1 ? "atributo" : "atributos"}
      {recortado && <> de {total}</>} · <span className="tabular-nums">{alteracoes}</span>{" "}
      {alteracoes === 1 ? "alteração" : "alterações"}
      {escopo !== null && <> · escopo {escopoDe(escopo).nome.toLowerCase()}</>}
      {busca.trim() !== "" && <> · busca “{busca.trim()}”</>}
    </p>
  );
}

/** A caixa de "não há nada aqui", com o motivo certo dos três possíveis. */
function Vazio({
  escopo,
  busca,
  importado,
  temNoEscopo,
  onLimpar,
}: {
  escopo: EscopoCode | null;
  busca: string;
  importado: boolean;
  /** Se o escopo tem atributos alterados antes da busca entrar. */
  temNoEscopo: boolean;
  onLimpar: () => void;
}) {
  const nome = escopo === null ? null : escopoDe(escopo).nome.toLowerCase();
  const buscando = busca.trim() !== "" && temNoEscopo;
  const alerta = !importado && !buscando;

  return (
    <div
      className={cn(
        "mt-6 flex gap-4 rounded-xl border px-5 py-5 max-w-4xl",
        alerta ? "border-amber-100 bg-amber-50" : "border-sky-100 bg-sky-50",
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0 text-white",
          alerta ? "bg-amber-500" : "bg-sky-500",
        )}
      >
        {buscando ? <Search className="w-6 h-6" /> : <CircleHelp className="w-6 h-6" />}
      </div>

      <div className="min-w-0 space-y-1.5 text-sm">
        {buscando ? (
          <>
            <p className="font-bold text-sky-700">
              Nenhum atributo{nome && <> de {nome}</>} com “{busca.trim()}”.
            </p>
            <p className="text-muted-foreground">
              A busca procura no rótulo, no código da coluna, no parâmetro e na família —
              então vale tentar pelo nome que a planilha usa (
              <span className="font-mono">finameCavalo</span>) ou pelo nosso (
              <span className="font-mono">cavalo.finame_cavalo</span>).
            </p>
            <button
              type="button"
              onClick={onLimpar}
              className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:underline"
            >
              Limpar busca
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        ) : alerta ? (
          <>
            <p className="font-bold text-amber-700">
              {nome ? (
                <>Nada de {nome} chegou nesta vigência.</>
              ) : (
                <>Nenhuma vigência importada ainda.</>
              )}
            </p>
            <p className="text-muted-foreground">
              Isto não é ausência de alteração: é ausência de arquivo. Enquanto o export
              {nome ? <> de {nome}</> : <>s</>} não for importado para esta unidade, nada
              aqui pode ser lido como “não mudou” — a série ausente não está contada como
              zero. O catálogo do Freightech, na aba ao lado, continua mostrando as gavetas
              que o produto cobre quando o arquivo chegar.
            </p>
          </>
        ) : (
          <>
            <p className="font-bold text-sky-700">
              Nenhuma alteração{nome && <> de {nome}</>} nesta vigência.
            </p>
            <p className="text-muted-foreground">
              O arquivo chegou e a comparação foi feita: naquela quinzena, nesta unidade, o
              cliente não mexeu em nada aqui. Isso é resposta, não erro.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * O atributo que existia e não existe neste recorte.
 *
 * Irmã de `CartaoAusente`, na aba do catálogo, e pelo mesmo motivo: aplicar o
 * filtro **não** fecha o que está aberto, porque trocar de unidade é a pergunta
 * seguinte mais comum de dentro de um atributo. O que não sobrevive é a troca
 * que o faz deixar de existir — e aí a tela diz isso.
 */
function AtributoAusente({
  chave,
  view,
  onVoltar,
}: {
  chave: string;
  view: FamiliesView | null;
  onVoltar: () => void;
}) {
  const unidade = view?.context.scopes
    .filter((e) => e.scopeType === "UNIDADE" || e.scopeType === "OPERADOR")
    .map((e) => e.name ?? e.code)
    .join("-");

  return (
    <div className="mt-6">
      <BotaoVoltar onClick={onVoltar} />

      <div className="mt-5 flex gap-4 rounded-xl border border-sky-100 bg-sky-50 px-5 py-5 max-w-3xl">
        <div className="h-12 w-12 rounded-full bg-sky-500 text-white grid place-content-center shrink-0">
          <CircleHelp className="w-6 h-6" />
        </div>
        <div className="min-w-0 space-y-1.5 text-sm">
          <p className="font-bold text-sky-700">
            Este atributo não se mexeu em {unidade || "esta unidade"}
            {view?.periodLabel ? ` · ${view.periodLabel}` : ""}.
          </p>
          <p className="text-muted-foreground">
            O filtro foi aplicado e o endereço veio junto — mas um atributo só aparece na
            grade da vigência em que ele mudou, e neste recorte ele não mudou. Isso é
            resposta, não erro.
          </p>
          <p className="text-xs text-muted-foreground font-mono pt-1 break-all">{chave}</p>
        </div>
      </div>
    </div>
  );
}

function BotaoVoltar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-input bg-background h-10 px-4 text-sm font-medium transition-colors hover:bg-muted"
    >
      <ChevronRight className="w-4 h-4 rotate-180" />
      Voltar aos atributos
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* A seção e o cartão                                                  */
/* ------------------------------------------------------------------ */

/** O cabeçalho de um bloco: ladrilho de ícone, título, contagem e o grão. */
function Secao({
  icone,
  titulo,
  contagem,
  descricao,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  contagem: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
          {icone}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-tight flex flex-wrap items-baseline gap-x-3">
            {titulo}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {contagem}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>

      <div className="grid gap-4 mt-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

/**
 * O cartão de um atributo.
 *
 * A ordem de leitura é a ordem da pergunta, e cada degrau tem um corpo de letra
 * próprio — foi a falta disso que fez a primeira versão virar seis linhas do
 * mesmo tamanho, em que o olho não tinha onde pousar:
 *
 * 1. **o que é** — o ladrilho colorido, o rótulo e o código da coluna;
 * 2. **quanto vale** — o número, grande, com a periodicidade colada;
 * 3. **de quanto para quanto** — o antes → depois, que é o conteúdo real do
 *    atributo que não tem preço;
 * 4. **em quantos** — a barra de cobertura e a contagem;
 * 5. **de onde vem** — o parâmetro e a família, em corpo mínimo.
 *
 * **Três estados de "sem número", e nunca confundidos.** Tem preço; tem preço
 * mas já está contado em outra linha — e aí o número sai em tinta neutra, porque
 * ele não é impacto *desta* linha; e não dá para valorar, com o motivo do
 * servidor no `title` e o rótulo curto dele na tela. Um valor excluído pintado
 * de verde seria dinheiro que a soma não tem.
 */
function CartaoDeAtributo({
  atributo,
  favorito,
  mostrarEscopo,
  onFavoritar,
  onAbrir,
}: {
  atributo: AtributoRender;
  favorito: boolean;
  /** Nos favoritos a grade mistura escopos, e aí o cartão precisa dizer o seu. */
  mostrarEscopo: boolean;
  onFavoritar: () => void;
  onAbrir: () => void;
}) {
  const { grupo } = atributo;
  const valor = grupo.impact.amount;
  const temValor = valor !== null && valor !== 0;
  const excluido = !temValor && grupo.impact.excludedAmount !== null;
  const { tom, icone } = ladrilhoDe(grupo);

  const cobertura = grupo.fleet > 0 ? Math.min(1, grupo.vehicles / grupo.fleet) : 0;

  return (
    <article className="group relative flex flex-col rounded-xl border bg-card shadow-sm transition-all hover:shadow-md hover:border-brand/40">
      {/*
        A estrela fica fora do botão do cartão, e não dentro: botão dentro de
        botão não é HTML válido, e o clique do favorito abriria o atributo junto.
      */}
      <button
        type="button"
        onClick={onFavoritar}
        aria-pressed={favorito}
        aria-label={
          favorito
            ? `Remover ${atributo.titulo} dos favoritos`
            : `Marcar ${atributo.titulo} como favorito`
        }
        title={favorito ? "Remover dos favoritos" : "Marcar como favorito"}
        className={cn(
          "absolute right-3 top-3 z-10 rounded-full p-1.5 transition-colors",
          favorito
            ? "text-amber-500 hover:bg-amber-50"
            : "text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground",
        )}
      >
        <Star className="w-4 h-4" strokeWidth={2} fill={favorito ? "currentColor" : "none"} />
      </button>

      <button
        type="button"
        onClick={onAbrir}
        className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-4 text-left"
      >
        <div className="flex items-start gap-3 pr-6">
          <div
            className={cn(
              "h-10 w-10 rounded-xl grid place-content-center shrink-0",
              LADRILHO[tom],
            )}
          >
            {icone}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-tight truncate" title={atributo.titulo}>
              {atributo.titulo}
            </div>
            {atributo.code && (
              <div
                className="text-[0.6875rem] font-mono text-muted-foreground truncate"
                title={atributo.code}
              >
                {atributo.code}
              </div>
            )}
          </div>
        </div>

        {mostrarEscopo && (
          <span className="self-start rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
            {escopoDe(atributo.escopo).rotulo}
          </span>
        )}

        <div className="min-w-0">
          {temValor ? (
            <div
              className={cn(
                "text-2xl font-bold tracking-tight tabular-nums",
                valor < 0 ? "text-red-600" : "text-emerald-700",
              )}
            >
              {formatBrlCompacto(valor)}
              <span className="text-xs font-medium text-muted-foreground ml-1">
                {periodicitySuffix(grupo.impact.periodicity)}
              </span>
            </div>
          ) : excluido ? (
            /*
              O estado que mais engana quando falta. `carreta.custo_fixo` mexeu
              R$ 16.594,54 e a semântica está confirmada — o que ele não tem é
              lugar no total, porque o mesmo dinheiro já está contado na parcela
              ou na linha do cavalo vinculado. Sem este ramo o cartão exibia
              `impact.reason`, que ali diz "Semântica confirmada: BRL, MENSAL,
              somável" — a regra de precificação, e não um motivo para não haver
              número. Quem lesse concluiria que a coluna não foi valorada.
            */
            <div title={grupo.impact.excludedReason ?? undefined}>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-muted-foreground">
                {formatBrlCompacto(grupo.impact.excludedAmount!)}
                <span className="text-xs font-medium ml-1">
                  {periodicitySuffix(grupo.impact.periodicity)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">já contado em outra linha</div>
            </div>
          ) : (
            <div title={grupo.impact.reason ?? undefined}>
              <div className="text-base font-semibold text-muted-foreground">
                Sem preço apurado
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {grupo.badgeLabel} · {grupo.semanticsLabel}
              </div>
            </div>
          )}

          {/*
            O antes → depois é o conteúdo real do atributo que não tem preço: um
            km/l que caiu de 2,52 para 0 não vira dinheiro nesta tela e continua
            sendo a coisa mais importante do cartão. Componente do detalhe, e não
            uma segunda redação dele — a regra de quando existe total e quando
            existe só faixa não pode divergir entre os dois lugares.
          */}
          <div className="text-xs mt-1.5 break-words leading-snug">
            <BeforeAfter group={grupo} />
          </div>
        </div>

        <div className="mt-auto pt-3 border-t">
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate" title={grupo.coverageLabel}>
              {grupo.coverageLabel}
            </span>
            <span className="tabular-nums shrink-0">
              {grupo.changes} {grupo.changes === 1 ? "alteração" : "alterações"}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                grupo.coverage === "TOTAL" ? "bg-brand" : "bg-brand/60",
              )}
              style={{ width: `${Math.max(cobertura * 100, 2)}%` }}
            />
          </div>

          {/*
            A contagem dos excluídos só entra quando **parte** do grupo entrou no
            total. Quando ninguém entrou, a linha de impacto já disse isso por
            inteiro, e repetir "5 de 5 fora do total" seria dizer duas vezes a
            mesma coisa no espaço de um cartão.
          */}
          {temValor && grupo.impact.excludedVehicles > 0 && (
            <p className="mt-2 flex gap-1.5 text-xs text-amber-700">
              <Info className="w-3.5 h-3.5 mt-px shrink-0" />
              {grupo.impact.excludedVehicles} de {grupo.vehicles} fora do total — já
              contados em outra linha
            </p>
          )}

          <p className="mt-2 text-[0.6875rem] text-muted-foreground truncate">
            {atributo.parametro} · {atributo.familia}
          </p>
        </div>
      </button>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* O atributo aberto                                                   */
/* ------------------------------------------------------------------ */

/**
 * O que mudou naquele atributo, veículo a veículo.
 *
 * O miolo é o `GroupCard` de sempre — o mesmo componente da Visão geral e do
 * cartão do catálogo, e não uma segunda redação dele. Ele já traz o histórico
 * do atributo, a lista de ativos com antes e depois, o impacto por linha e a
 * proveniência até a célula da planilha. Reescrever isso aqui produziria uma
 * segunda tela que um dia discordaria da primeira sobre o mesmo número.
 *
 * Ele nasce **aberto**, e essa é a diferença: na lista da Visão geral o cartão
 * fechado é o certo, porque abrir vinte é não ordenar nenhum. Aqui o clique
 * anterior já pediu este atributo — pedir mais um para ver os veículos seria
 * esconder atrás de um chevron exatamente o que se veio buscar.
 */
function DetalheDoAtributo({
  atributo,
  period,
  recorte,
  temCartao,
  onVoltar,
  onIrParaCartao,
}: {
  atributo: AtributoRender;
  period: string;
  recorte: Recorte;
  temCartao: (parametroChave: string) => boolean;
  onVoltar: () => void;
  onIrParaCartao: (parametroChave: string) => void;
}) {
  const escopo = escopoDe(atributo.escopo);
  const { tom, icone } = ladrilhoDe(atributo.grupo);
  /*
    A ponte para o espelho. Não é enfeite: quem audita fala com o cliente na
    tela do Freightech, e "esta coluna, lá, é a gaveta FINANCIAMENTO" é a frase
    que faz a conversa acontecer. Só vira link quando a gaveta existe **nesta**
    vigência — as nossas só aparecem no mês em que o parâmetro se mexeu, e um
    link para uma gaveta ausente levaria à tela do "não existe neste recorte".
  */
  const cartao =
    atributo.parametroChave !== null && temCartao(atributo.parametroChave)
      ? atributo.parametroChave
      : null;

  return (
    <div className="mt-6">
      <BotaoVoltar onClick={onVoltar} />

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={cn(
              "h-14 w-14 rounded-xl grid place-content-center shrink-0",
              LADRILHO[tom],
            )}
          >
            <span className="scale-125">{icone}</span>
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {escopo.nome} · {atributo.familia} · {atributo.parametro}
            </div>
            <h2 className="text-2xl font-bold tracking-tight mt-0.5 break-words">
              {atributo.titulo}
            </h2>
            {atributo.code && (
              <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
                {atributo.code}
              </p>
            )}
          </div>
        </div>

        {cartao && (
          <button
            type="button"
            onClick={() => onIrParaCartao(cartao)}
            className="inline-flex items-center gap-1.5 rounded-full border border-input bg-background h-10 px-4 text-sm font-medium transition-colors hover:bg-muted shrink-0"
          >
            Ver a gaveta no espelho do Freightech
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {atributo.escopo === "CONJUNTO" && (
        <div className="mt-5 flex gap-4 rounded-xl border border-sky-100 bg-sky-50 px-5 py-4 max-w-4xl">
          <div className="h-10 w-10 rounded-full bg-sky-500 text-white grid place-content-center shrink-0">
            <Combine className="w-5 h-5" />
          </div>
          <p className="text-sm text-muted-foreground">
            <strong className="text-sky-700">Esta coluna é do conjunto.</strong> Ela aparece
            na linha da carreta e já embute o cavalo vinculado, então o valor abaixo é do
            par — somá-lo à frota de cavalos contaria cada cavalo duas vezes, e é por isso
            que parte das linhas pode aparecer fora do total, com o motivo escrito.
          </p>
        </div>
      )}

      {/*
        O nível 2, e de quem ele é.

        Dentro de uma unidade é o cartão de sempre, com o recorte da tela. Em
        Visão Geral o grupo é a soma de várias, e a lista de veículos, a série do
        atributo e a célula da planilha só existem dentro de um contexto — então
        o detalhe abre **por unidade**, cada uma com o recorte dela. É a mesma
        recusa de sempre: um cartão não finge cobertura que o dado não tem.
      */}
      <div className="mt-5">
        {atributo.grupo.porUnidade ? (
          <AlteracaoPorUnidade grupo={atributo.grupo} period={period} />
        ) : (
          <GroupCard
            group={atributo.grupo}
            period={period}
            recorte={recorte}
            inicialmenteAberto
          />
        )}
      </div>
    </div>
  );
}
