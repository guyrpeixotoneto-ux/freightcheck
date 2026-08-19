/**
 * A grade de atributos — o que mudou, arrumado por escopo.
 *
 * O espelho do Freightech continua sendo a outra aba desta tela, e continua
 * fiel. Esta aqui responde a outra pergunta, que é a de quem audita: **de qual
 * coisa** quero ver o que mudou nesta quinzena. As gavetas de lá não têm essa
 * divisão — CAVALO e CARRETA são dois cartões dentro de FROTA, entre
 * COMBUSTÍVEL e PRAZO FINAME, que valem para os dois — e por isso encontrar
 * "tudo o que mexeu nas carretas" exigia abrir cartão por cartão e somar de
 * cabeça.
 *
 * Três coisas mudam de lugar aqui, e as três vêm da mesma reclamação:
 *
 * 1. **O cartão é o atributo**, e não a gaveta. `carreta.finame` é um cartão,
 *    e abre nos veículos daquela unidade naquela quinzena — que é o degrau
 *    seguinte da hierarquia VISÃO GERAL → ESCOPO → ATRIBUTO → VEÍCULO →
 *    EVIDÊNCIA. Antes ele era uma linha dentro de uma tabela dentro de um
 *    cartão, e chegar nele custava três cliques e saber em qual gaveta procurar.
 * 2. **O escopo é a navegação principal.** Seis botões no topo, com o que cada
 *    um tem. Escolher um recorta a grade inteira.
 * 3. **A busca procura no que a pessoa tem na mão** — o rótulo, o código, o
 *    nome do parâmetro, a família. Quem chega com `finameCavalo` anotado da
 *    planilha encontra pelo código; quem chega com "manutenção" encontra pela
 *    família.
 *
 * As recusas da tela antiga continuam de pé, e uma delas fica mais visível
 * aqui: **nunca somar periodicidades**. A ordenação por impacto ordena pelo
 * tamanho do movimento dentro da periodicidade de cada linha e empurra para o
 * fim o que não tem preço — sem preço não é zero, e tratá-lo como zero o
 * esconderia justamente de quem precisa saber que ele existe.
 */

import { useMemo } from "react";
import { ChevronRight, Info, Search, Star, X } from "lucide-react";
import { GroupCard } from "@/components/inicio/group-card";
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
import type { FamiliesView } from "@/components/inicio/types";

/** A estrela dos atributos mora numa chave própria — ver `useFavoritos`. */
const CHAVE_FAVORITOS = "freightcheck:parametros-atributos-favoritos";

const BADGE_STYLE: Record<string, string> = {
  DINHEIRO: "bg-emerald-100 text-emerald-900 border-emerald-300",
  RUPTURA: "bg-amber-100 text-amber-900 border-amber-300",
  COBERTURA: "bg-sky-100 text-sky-900 border-sky-300",
  MOVIMENTO: "bg-violet-100 text-violet-900 border-violet-300",
  TRAVADO: "bg-zinc-100 text-zinc-700 border-zinc-300",
  FORMATO: "bg-slate-100 text-slate-700 border-slate-300",
  SEM_SINAL: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

export function GradeDeAtributos({
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
    As contagens da barra saem da lista **inteira**, e não da filtrada.

    É deliberado: a barra é o mapa do que existe, e um mapa que se redesenha a
    cada letra digitada deixa de dizer onde as coisas estão. Digitar "finame"
    com CAVALO selecionado precisa continuar mostrando que há finame em CARRETA
    e em CONJUNTO — senão a busca esconde exatamente o que ela deveria ajudar a
    achar. Quantos sobram da busca em cada escopo é outra pergunta, e ela está
    respondida logo abaixo da barra, no resumo do recorte.
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
    por que não há nada, e um título com "0 atributos" e uma régua embaixo dele
    repete a mesma resposta ocupando o dobro do espaço.
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

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="relative">
          <input
            value={busca}
            onChange={(event) => onBusca(event.target.value)}
            placeholder="rótulo, código, parâmetro ou família"
            aria-label="Buscar atributo por rótulo, código, parâmetro ou família"
            className="w-[26rem] max-w-full h-11 rounded-sm border border-input bg-card pl-3 pr-10 text-sm outline-none focus:border-brand"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => onBusca("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <Search className="w-5 h-5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Ordenar por
          </span>
          <Select value={ordem} onValueChange={(v) => onOrdem(v as OrdemCode)}>
            <SelectTrigger className="w-48 h-11 rounded-sm bg-card">
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
            como verdadeiro no caso vazio — que era o que `escopo === null ||`
            fazia — punha a tela dizendo "o arquivo chegou e a comparação foi
            feita" num banco onde não há vigência nenhuma. A frase certa ali é a
            oposta, e a diferença entre as duas é o que decide se alguém vai
            cobrar um export do cliente.
          */
          importado={escopo === null ? importados.size > 0 : importados.has(escopo)}
          temNoEscopo={escopo !== null && (contagemPorEscopo.get(escopo)?.atributos ?? 0) > 0}
          onLimpar={() => onBusca("")}
        />
      )}

      {marcados.length > 0 && (
        <Secao
          titulo="Favoritos"
          descricao="Os atributos que você marcou — do recorte visível."
          contagem={`${marcados.length} ${marcados.length === 1 ? "atributo" : "atributos"}`}
        >
          {marcados.map((atributo) => (
            <CartaoDeAtributo
              key={`fav-${atributo.chave}`}
              atributo={atributo}
              favorito
              mostrarEscopo={escopo === null}
              onFavoritar={() => alternar(atributo.chave)}
              onAbrir={() => onAbrir(atributo.chave)}
            />
          ))}
        </Secao>
      )}

      {secoes.map((secao) => (
        <Secao
          key={secao.escopo.code}
          titulo={secao.escopo.nome}
          descricao={secao.escopo.grao}
          contagem={`${secao.itens.length} ${
            secao.itens.length === 1 ? "atributo" : "atributos"
          } · ${somaDeAlteracoes(secao.itens)} ${
            somaDeAlteracoes(secao.itens) === 1 ? "alteração" : "alterações"
          }`}
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
      ))}
    </>
  );
}

function somaDeAlteracoes(atributos: AtributoRender[]): number {
  return atributos.reduce((soma, a) => soma + a.grupo.changes, 0);
}

/* ------------------------------------------------------------------ */
/* A barra de escopos                                                  */
/* ------------------------------------------------------------------ */

/**
 * Os seis botões do topo — a navegação principal desta aba.
 *
 * Cada um diz quantos atributos mexeram e quantas alterações são, e o escopo
 * que **não** foi importado aparece apagado, com o motivo, em vez de sumir. Sumir
 * seria confundir duas coisas que um auditor precisa distinguir: "não chegou
 * arquivo de trecho nesta unidade" e "chegou e ninguém mexeu em nada". O botão
 * apagado ainda clica, e a tela do outro lado escreve qual dos dois é.
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
    <div className="mt-5 flex flex-wrap gap-3">
      <BotaoDeEscopo
        rotulo="Todos"
        linha={`${total} ${total === 1 ? "atributo" : "atributos"}`}
        nota={null}
        ativo={escopo === null}
        apagado={false}
        onClick={() => onEscopo(null)}
      />

      {lista.map((e) => {
        const contagem = porCodigo.get(e.code);
        const importado = e.code === "SEM_ESCOPO" || importados.has(e.code);
        return (
          <BotaoDeEscopo
            key={e.code}
            rotulo={e.rotulo}
            linha={
              contagem
                ? `${contagem.atributos} ${contagem.atributos === 1 ? "atributo" : "atributos"}`
                : importado
                  ? "sem alterações"
                  : "não importado"
            }
            nota={
              contagem
                ? `${contagem.alteracoes} ${
                    contagem.alteracoes === 1 ? "alteração" : "alterações"
                  }`
                : null
            }
            ativo={escopo === e.code}
            apagado={!contagem}
            onClick={() => onEscopo(e.code)}
          />
        );
      })}
    </div>
  );
}

function BotaoDeEscopo({
  rotulo,
  linha,
  nota,
  ativo,
  apagado,
  onClick,
}: {
  rotulo: string;
  linha: string;
  nota: string | null;
  ativo: boolean;
  apagado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-w-[9.5rem] text-left px-4 py-3 border border-l-[5px] rounded-sm transition-colors",
        ativo
          ? "bg-brand-dark border-brand-dark text-white shadow-md"
          : apagado
            ? "bg-card/60 border-l-brand/30 hover:bg-accent"
            : "bg-card border-l-brand hover:bg-accent",
      )}
    >
      <div
        className={cn(
          "text-[0.8125rem] font-bold uppercase tracking-wide",
          !ativo && apagado && "text-muted-foreground",
        )}
      >
        {rotulo}
      </div>
      <div className={cn("text-xs mt-0.5", ativo ? "text-white/85" : "text-muted-foreground")}>
        {linha}
      </div>
      {/* A faixa da nota fica sempre, vazia ou não: sem ela os botões saem em
          alturas diferentes e a fileira vira uma escada. */}
      <div
        className={cn(
          "text-[0.6875rem] h-4 mt-0.5",
          ativo ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {nota}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* O recorte, dito em uma linha                                        */
/* ------------------------------------------------------------------ */

/**
 * Quantos sobraram, e de quantos.
 *
 * Existe porque a barra de escopos conta a lista inteira de propósito (ver
 * acima) e alguém precisa responder "e com o que eu digitei, quantos são?".
 * Sem esta linha, digitar um termo que não acha nada em CAVALO deixaria a tela
 * com uma barra dizendo "120 atributos" e uma grade vazia embaixo.
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
      <strong className="text-foreground">{filtrados.length}</strong>{" "}
      {filtrados.length === 1 ? "atributo" : "atributos"}
      {recortado && <> de {total}</>} · {alteracoes}{" "}
      {alteracoes === 1 ? "alteração" : "alterações"}
      {escopo !== null && <> · escopo {escopoDe(escopo).nome.toLowerCase()}</>}
      {busca.trim() !== "" && <> · busca “{busca.trim()}”</>}
    </p>
  );
}

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

  return (
    <div className="mt-6 bg-card border border-l-[6px] border-l-brand px-6 py-5 max-w-3xl text-sm space-y-2">
      {busca.trim() !== "" && temNoEscopo ? (
        <>
          <p className="font-medium">
            Nenhum atributo{nome && <> de {nome}</>} com “{busca.trim()}”.
          </p>
          <p className="text-muted-foreground">
            A busca procura no rótulo, no código da coluna, no parâmetro e na família —
            então vale tentar pelo nome que a planilha usa (<span className="font-mono">
              finameCavalo
            </span>
            ) ou pelo nosso (<span className="font-mono">cavalo.finame_cavalo</span>).
          </p>
          <button
            type="button"
            onClick={onLimpar}
            className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline"
          >
            Limpar busca
          </button>
        </>
      ) : !importado ? (
        <>
          <p className="font-medium">
            {nome ? <>Nada de {nome} chegou nesta vigência.</> : <>Nenhuma vigência importada ainda.</>}
          </p>
          <p className="text-muted-foreground">
            Isto não é ausência de alteração: é ausência de arquivo. Enquanto o export
            {nome ? <> de {nome}</> : <>s</>} não for importado para esta unidade, nada aqui
            pode ser lido como “não mudou” — a série ausente não está contada como zero. O
            catálogo do Freightech, na aba ao lado, continua mostrando as gavetas que o
            produto cobre quando o arquivo chegar.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">
            Nenhuma alteração{nome && <> de {nome}</>} nesta vigência.
          </p>
          <p className="text-muted-foreground">
            O arquivo chegou e a comparação foi feita: naquela quinzena, nesta unidade, o
            cliente não mexeu em nada aqui. Isso é resposta, não erro.
          </p>
        </>
      )}
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
      <button
        type="button"
        onClick={onVoltar}
        className="bg-brand text-brand-foreground text-[0.8125rem] font-bold uppercase tracking-wide px-6 py-3 rounded-sm hover:brightness-95 transition-[filter]"
      >
        Voltar aos atributos
      </button>

      <div className="mt-6 bg-card border border-l-[6px] border-l-brand px-6 py-5 max-w-3xl space-y-2 text-sm">
        <p className="font-medium">
          Este atributo não se mexeu em {unidade || "esta unidade"}
          {view?.periodLabel ? ` · ${view.periodLabel}` : ""}.
        </p>
        <p className="text-muted-foreground">
          O filtro foi aplicado e o endereço veio junto — mas um atributo só aparece na
          grade da vigência em que ele mudou, e neste recorte ele não mudou. Isso é
          resposta, não erro.
        </p>
        <p className="text-xs text-muted-foreground font-mono pt-1">{chave}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O cartão de um atributo                                             */
/* ------------------------------------------------------------------ */

function Secao({
  titulo,
  descricao,
  contagem,
  children,
}: {
  titulo: string;
  descricao: string;
  contagem: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold uppercase tracking-wide">{titulo}</h2>
        <span className="text-xs text-muted-foreground">{contagem}</span>
      </div>
      <div className="border-b-2 border-brand mt-2" />
      <p className="text-xs text-muted-foreground mt-3">{descricao}</p>
      <div className="grid gap-5 mt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

/**
 * O cartão de um atributo.
 *
 * A ordem de leitura é a ordem da pergunta: **o que é** (o selo e o rótulo),
 * **de onde vem** (o código e a gaveta), **quanto vale** (o impacto, com a
 * periodicidade colada) e **em quantos** (a cobertura que o servidor escreveu).
 *
 * O impacto usa a escala compacta — `−R$ 34,8 mil/mês` — porque num cartão de
 * um quarto de largura o número por extenso come o rótulo. O sinal é o menos
 * tipográfico e a cor separa perda de ganho; sobre o realce escuro do passar do
 * mouse os dois trocam para os tons claros, pela mesma razão que a grade do
 * catálogo faz isso: sobre o laranja escurecido o vermelho de perda some.
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

  return (
    <div className="group border border-l-[5px] border-l-brand bg-card flex flex-col shadow-sm transition-colors hover:bg-brand-dark hover:border-brand-dark hover:shadow-md">
      <button
        type="button"
        onClick={onAbrir}
        className="text-left px-5 pt-4 pb-3 flex-1 flex flex-col gap-2 cursor-pointer"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-[0.625rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
              BADGE_STYLE[grupo.badge] ?? BADGE_STYLE.SEM_SINAL,
            )}
          >
            {grupo.badgeLabel}
          </span>
          {mostrarEscopo && (
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground group-hover:text-white/80 border rounded-full px-2 py-0.5">
              {escopoDe(atributo.escopo).rotulo}
            </span>
          )}
        </span>

        {/*
          O rótulo **não** vai em caixa alta, ao contrário do cartão do catálogo.

          Lá o nome é curto e escrito por gente — CAVALO, PRAZO FINAME — e a
          caixa alta é a assinatura visual do Freightech. Aqui o rótulo é o nome
          da coluna, e enquanto a curadoria não lhe der um nome gerencial ele
          chega em camelCase: `lucroFixomodeloNovoCicloCavalo`. Em caixa alta
          isso vira LUCROFIXOMODELONOVOCICLOCAVALO — a única pista de onde uma
          palavra termina e a outra começa é a maiúscula, e a caixa alta apaga
          exatamente essa pista.
        */}
        <span className="text-[0.9375rem] font-semibold leading-snug group-hover:text-white break-words">
          {atributo.titulo}
        </span>

        {atributo.code && (
          <span className="text-[0.6875rem] font-mono text-muted-foreground group-hover:text-white/80 break-all">
            {atributo.code}
          </span>
        )}

        <span className="text-xs text-muted-foreground group-hover:text-white/80">
          {atributo.parametro} · {atributo.familia}
        </span>

        <span className="text-sm mt-1">
          {temValor ? (
            <span
              className={cn(
                "font-bold tabular-nums",
                valor < 0
                  ? "text-brand-red group-hover:text-loss-on-dark"
                  : "text-success group-hover:text-gain-on-dark",
              )}
            >
              {formatBrlCompacto(valor)}
              <span className="text-xs font-normal text-muted-foreground group-hover:text-white/80">
                {periodicitySuffix(grupo.impact.periodicity)}
              </span>
            </span>
          ) : grupo.impact.excludedAmount !== null ? (
            /*
              O terceiro estado, e o que mais engana quando falta.

              Estas linhas **têm** preço: `carreta.custo_fixo` mexeu R$ 16.594,54
              e a semântica está confirmada. O que elas não têm é lugar no total,
              porque o mesmo dinheiro já está contado na parcela ou na linha do
              cavalo vinculado. Sem este ramo o cartão caía no ramo de baixo e
              exibia `impact.reason` — que ali diz "Semântica confirmada: BRL,
              MENSAL, somável", a regra de precificação, e não um motivo para não
              haver número. O leitor concluiria que a coluna não foi valorada,
              quando ela foi e a soma é que a recusa de propósito.
            */
            <span
              title={grupo.impact.excludedReason ?? undefined}
              className="text-xs text-muted-foreground group-hover:text-white/80"
            >
              <span className="font-semibold tabular-nums">
                {formatBrlCompacto(grupo.impact.excludedAmount)}
                {periodicitySuffix(grupo.impact.periodicity)}
              </span>{" "}
              — já contado em outra linha
            </span>
          ) : (
            /*
              O motivo do "sem preço" fica, com a redação do servidor e sem
              paráfrase — é ele que separa "não dá para valorar" de "vale zero".
              O que ele não pode é tomar metade do cartão: as duas primeiras
              linhas cabem, o texto inteiro fica no `title` e no detalhe, e
              nenhuma palavra é reescrita para caber.
            */
            <span
              title={grupo.impact.reason ?? undefined}
              className="text-xs text-muted-foreground group-hover:text-white/80 line-clamp-2"
            >
              {grupo.impact.reason ?? "Sem impacto apurado"}
            </span>
          )}
        </span>

        <span className="text-xs text-muted-foreground group-hover:text-white/80">
          {grupo.changes} {grupo.changes === 1 ? "alteração" : "alterações"} ·{" "}
          {grupo.coverageLabel}
        </span>

        {/*
          A contagem dos excluídos só entra quando **parte** do grupo entrou no
          total: aí ela diz quanto do número acima está representando o grupo
          todo. Quando ninguém entrou, a linha de impacto já disse isso por
          inteiro, e repetir "5 de 5 fora do total" logo abaixo é dizer duas
          vezes a mesma coisa no espaço de um cartão.
        */}
        {grupo.impact.excludedVehicles > 0 && temValor && (
          <span className="text-xs text-muted-foreground group-hover:text-white/80 flex gap-1.5">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" />
            {grupo.impact.excludedVehicles} de {grupo.vehicles} fora do total — já contados
            em outra linha
          </span>
        )}
      </button>

      <div className="px-4 pb-3 flex items-center justify-between">
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
          className="p-1 -ml-1 text-brand group-hover:text-white hover:scale-110 transition-transform"
        >
          <Star className="w-6 h-6" strokeWidth={1.5} fill={favorito ? "currentColor" : "none"} />
        </button>
        <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-brand group-hover:text-white inline-flex items-center gap-1">
          Veículos <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
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
  temCartao,
  onVoltar,
  onIrParaCartao,
}: {
  atributo: AtributoRender;
  period: string;
  temCartao: (parametroChave: string) => boolean;
  onVoltar: () => void;
  onIrParaCartao: (parametroChave: string) => void;
}) {
  const escopo = escopoDe(atributo.escopo);
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
      <button
        type="button"
        onClick={onVoltar}
        className="bg-brand text-brand-foreground text-[0.8125rem] font-bold uppercase tracking-wide px-6 py-3 rounded-sm hover:brightness-95 transition-[filter]"
      >
        Voltar aos atributos
      </button>

      <div className="mt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {escopo.nome} · {atributo.familia} · {atributo.parametro}
        </div>
        {/* Sem caixa alta, pela mesma razão do cartão — ver `CartaoDeAtributo`. */}
        <h2 className="text-2xl font-bold tracking-tight mt-1">{atributo.titulo}</h2>
        {atributo.code && (
          <p className="text-xs font-mono text-muted-foreground mt-1">{atributo.code}</p>
        )}
        {cartao && (
          <button
            type="button"
            onClick={() => onIrParaCartao(cartao)}
            className="mt-3 text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline inline-flex items-center gap-1"
          >
            Ver a gaveta no espelho do Freightech
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {atributo.escopo === "CONJUNTO" && (
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground flex gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <span>
            Esta coluna é do <strong>conjunto</strong>: ela aparece na linha da carreta e
            já embute o cavalo vinculado. O valor abaixo é do par — somá-lo à frota de
            cavalos contaria cada cavalo duas vezes, e é por isso que parte das linhas
            pode aparecer fora do total, com o motivo escrito.
          </span>
        </p>
      )}

      <div className="mt-5">
        <GroupCard group={atributo.grupo} period={period} inicialmenteAberto />
      </div>
    </div>
  );
}
