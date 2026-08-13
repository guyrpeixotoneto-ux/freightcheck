import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { AlertTriangle, Info, Search, Star } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { GroupCard } from "@/components/inicio/group-card";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";
import { TabelaDominio } from "@/components/parametros/dominio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFavoritos } from "@/lib/favoritos";
import { formatBrlShort, impactEntries, periodicitySuffix } from "@/lib/format";
import {
  CATALOGO_FREIGHTECH,
  chaveDoCartao,
  ligarParametros,
} from "@/lib/freightech-catalogo";
import type {
  ChangeGroup,
  FamiliesView,
  ImpactSummary,
  ParameterView,
} from "@/components/inicio/types";

/**
 * Escolha de segmento — a tela do Freightech, com o dado que ele não mostra.
 *
 * Tudo o que a mão já sabe fazer continua igual: os quatro campos na ordem
 * **Canal/Segmento → Vigência → Unidade → Parâmetro**, o botão FILTRAR que só
 * acende quando há o que aplicar, as seções em caixa alta com a régua laranja,
 * a grade de cartões com a barra na lateral e a estrela de favorito.
 *
 * **A grade é o catálogo inteiro do Freightech**, e não só o que este export
 * alimenta. Um cartão que existe lá e não existe aqui era, até agora, uma nota
 * de rodapé; a nota era verdadeira mas respondia à pergunta errada — quem
 * procura uma gaveta pelo nome e não a encontra conclui que o produto não cobre
 * o assunto. Agora o cartão está lá, e quem diz que não tem dado é ele.
 *
 * O que muda em relação ao Freightech é o miolo do cartão. Lá ele traz o nome e
 * nada mais; para saber se algo mudou é preciso abrir, exportar e comparar à
 * mão. Aqui ele já diz **quantas alterações, em quantos veículos e quanto
 * vale** — e quando não dá para valorar, diz o motivo.
 *
 * As recusas continuam de pé, deslocadas mas não afrouxadas:
 *
 * 1. **Nunca somar periodicidades.** R$/mês e R$/ano em linhas próprias, sempre.
 * 2. **Nenhum cartão finge cobertura.** O que não tem dado aparece cinza,
 *    escrito, e não abre um detalhe que não teria o que mostrar.
 * 3. **Nunca "impacto a verificar".** Sem preço é sem preço, com o motivo junto.
 */
export default function Parametros() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const query = new URLSearchParams();
  for (const key of ["period", "scopeHash", "canal"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }

  const cartaoAberto = params.get("cartao");

  /**
   * A busca por nome de parâmetro fica aqui, e não dentro da grade, porque o
   * campo dela mora na barra de filtro — que é irmã da grade, não filha.
   */
  const [busca, setBusca] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["families", query.toString()],
    queryFn: async () => {
      const suffix = query.toString() ? `?${query}` : "";
      const response = await fetch(getApiUrl(`/changes/families${suffix}`));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar");
      return (await response.json()) as FamiliesView;
    },
  });

  const secoes = useMemo(() => montarSecoes(data ?? null), [data]);

  const aplicar = (selecao: { scopeHash: string; canal: string | null; period: string }) => {
    const next = new URLSearchParams();
    next.set("scopeHash", selecao.scopeHash);
    if (selecao.canal) next.set("canal", selecao.canal);
    if (selecao.period) next.set("period", selecao.period);
    navigate(`/parametros?${next}`);
  };

  const abrirCartao = (chave: string | null) => {
    const next = new URLSearchParams(search);
    if (chave) next.set("cartao", chave);
    else next.delete("cartao");
    navigate(`/parametros?${next}`);
  };

  const cartao = useMemo(() => {
    if (!cartaoAberto) return null;
    for (const secao of secoes) {
      const encontrado = secao.cartoes.find((c) => c.chave === cartaoAberto);
      if (encontrado) return encontrado;
    }
    return null;
  }, [secoes, cartaoAberto]);

  return (
    <Layout>
      <div className="px-10 py-6 max-w-[1600px]">
        <h1 className="text-3xl font-bold uppercase tracking-tight">Escolha de segmento</h1>

        {data && (
          <BarraFiltro
            view={data}
            onFiltrar={aplicar}
            busca={busca}
            onBuscar={setBusca}
            buscaAtiva={!cartao}
          />
        )}

        {isLoading && <p className="mt-8 text-sm text-muted-foreground">Carregando…</p>}
        {error && (
          <div className="mt-6 bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
            {(error as Error).message}
          </div>
        )}

        {/*
          Sem vigência importada a grade continua na tela. O catálogo é o mapa
          das gavetas do Freightech, não uma projeção dos nossos fatos: ele vale
          antes de existir o primeiro import, e é justamente aí que ele mais
          serve — mostra o que o produto vai cobrir quando o arquivo chegar.
        */}
        {!isLoading && !error && !data && (
          <div className="mt-6 bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm flex gap-3">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
            <p>
              <strong>Nenhuma vigência importada ainda.</strong> Os cartões abaixo são as
              gavetas que o Freightech publica — todos aparecem, nenhum tem dado. Assim que
              a primeira planilha for importada, os que este export alimenta passam a
              mostrar o que mudou e quanto vale.
            </p>
          </div>
        )}

        {cartao ? (
          <DetalheCartao
            cartao={cartao}
            view={data ?? null}
            period={data?.period ?? ""}
            contexto={query}
            onVoltar={() => abrirCartao(null)}
          />
        ) : (
          <Grade view={data ?? null} secoes={secoes} busca={busca} onAbrir={abrirCartao} />
        )}
      </div>
    </Layout>
  );
}

/* ------------------------------------------------------------------ */
/* O catálogo, preenchido com o que temos                              */
/* ------------------------------------------------------------------ */

/**
 * Um cartão pronto para desenhar: o rótulo do Freightech, mais o que os nossos
 * parâmetros disserem sobre ele — quando disserem alguma coisa.
 */
interface CartaoRender {
  chave: string;
  nome: string;
  secao: string;
  /** De onde vem a gaveta: do Freightech ou nossa. */
  origem: "FREIGHTECH" | "FREIGHTCHECK";
  /** Os nossos parâmetros por trás deste cartão. Vazio = sem dado no export. */
  parametros: ParameterView[];
  /** Colunas do export que são este cartão — o caminho do cadastro. */
  atributos: string[];
  /** As colunas que o Freightech mostra nesta tela, quando já conferidas. */
  colunas: string[] | null;
  /** A frase sobre a distância entre a tela de lá e o que temos aqui. */
  nota: string | null;
  changes: number;
  /** Só quando um único parâmetro alimenta o cartão — ver `agregar`. */
  vehicles: number | null;
  impact: ImpactSummary;
  pending: string | null;
  groups: ChangeGroup[];
}

interface SecaoRender {
  titulo: string;
  origem: "FREIGHTECH" | "FREIGHTCHECK";
  nota: string | null;
  cartoes: CartaoRender[];
}

const IMPACTO_VAZIO: ImpactSummary = {
  byPeriodicity: {},
  excludedByPeriodicity: {},
  excludedChanges: 0,
  notCalculable: 0,
  calculatedChanges: 0,
};

/**
 * Casa o catálogo do Freightech com os parâmetros desta vigência.
 *
 * O casamento em si é de `ligarParametros`, no catálogo — a tela de Dados faz a
 * mesma pergunta e tem de obter a mesma resposta. Aqui só se traduz o resultado
 * (nomes) para os objetos que a grade desenha.
 */
function montarSecoes(view: FamiliesView | null): SecaoRender[] {
  const porNome = new Map<string, ParameterView>();
  for (const familia of view?.families ?? []) {
    for (const parametro of familia.parameters) porNome.set(parametro.name, parametro);
  }

  const { porCartao, usados } = ligarParametros([...porNome.keys()]);
  const ligados = new Map<string, ParameterView[]>(
    [...porCartao].map(([chave, nomes]) => [
      chave,
      nomes.map((n) => porNome.get(n)).filter((p): p is ParameterView => p !== undefined),
    ]),
  );

  const doFreightech: SecaoRender[] = CATALOGO_FREIGHTECH.map((secao) => ({
    titulo: secao.titulo,
    origem: "FREIGHTECH" as const,
    nota: null,
    cartoes: secao.cartoes.map((cartao) => {
      const chave = chaveDoCartao(secao.titulo, cartao.nome);
      const parametros = ligados.get(chave) ?? [];
      return {
        chave,
        nome: cartao.nome,
        secao: secao.titulo,
        origem: "FREIGHTECH" as const,
        parametros,
        atributos: cartao.atributos ?? [],
        colunas: cartao.colunas ?? null,
        nota: cartao.nota ?? null,
        ...agregar(parametros),
      };
    }),
  }));

  /*
    O que é nosso e não tem gaveta lá.

    Aquisição e financiamento, tributos, seguros: é onde está a maior parte do
    dinheiro deste export, e não há cartão equivalente nas telas do Freightech
    que conhecemos. Encaixar isso à força numa gaveta de lá penduraria dinheiro
    no lugar errado; então vira seção própria, marcada como nossa.
  */
  const titulosDoFreightech = new Set(
    CATALOGO_FREIGHTECH.map((s) => normalizar(s.titulo)),
  );

  const nossas: SecaoRender[] = (view?.families ?? [])
    .map((familia) => ({
      familia,
      parametros: familia.parameters.filter((p) => !usados.has(p.name)),
    }))
    .filter(({ parametros }) => parametros.length > 0)
    .map(({ familia, parametros }) => ({
      /*
        Uma seção nossa pode ter o nome de uma seção de lá — "Parâmetros
        gerais" existe nos dois — e dois títulos iguais na mesma página fazem o
        leitor achar que rolou para o lugar errado. O sufixo diz qual é qual.
      */
      titulo: titulosDoFreightech.has(normalizar(familia.name))
        ? `${familia.name} — só no FreightCheck`
        : familia.name,
      origem: "FREIGHTCHECK" as const,
      nota: familia.note,
      cartoes: parametros.map((parametro) => ({
        chave: chaveDoCartao(familia.code, parametro.name),
        nome: parametro.name,
        secao: familia.name,
        origem: "FREIGHTCHECK" as const,
        parametros: [parametro],
        atributos: [],
        colunas: null,
        nota: null,
        ...agregar([parametro]),
      })),
    }));

  return [...doFreightech, ...nossas];
}

/**
 * Junta o que vários parâmetros dizem sobre um mesmo cartão.
 *
 * Duas somas e uma recusa:
 *
 * - **alterações** somam, porque são contagens de eventos distintos;
 * - **impacto** soma *dentro de cada periodicidade*, nunca entre elas;
 * - **veículos não somam.** O mesmo cavalo aparece em dois parâmetros e seria
 *   contado duas vezes. Quando há mais de um parâmetro no cartão o número sai
 *   da tela em vez de sair errado — a contagem distinta é do servidor, e
 *   inventá-la aqui seria produzir um número sem lastro.
 */
function agregar(parametros: ParameterView[]): {
  changes: number;
  vehicles: number | null;
  impact: ImpactSummary;
  pending: string | null;
  groups: ChangeGroup[];
} {
  if (parametros.length === 0) {
    return {
      changes: 0,
      vehicles: null,
      impact: IMPACTO_VAZIO,
      pending: null,
      groups: [],
    };
  }

  const impact: ImpactSummary = {
    byPeriodicity: {},
    excludedByPeriodicity: {},
    excludedChanges: 0,
    notCalculable: 0,
    calculatedChanges: 0,
  };

  for (const p of parametros) {
    for (const [periodicidade, valor] of Object.entries(p.impact.byPeriodicity)) {
      impact.byPeriodicity[periodicidade] =
        (impact.byPeriodicity[periodicidade] ?? 0) + valor;
    }
    for (const [periodicidade, valor] of Object.entries(p.impact.excludedByPeriodicity)) {
      impact.excludedByPeriodicity[periodicidade] =
        (impact.excludedByPeriodicity[periodicidade] ?? 0) + valor;
    }
    impact.excludedChanges += p.impact.excludedChanges;
    impact.notCalculable += p.impact.notCalculable;
    impact.calculatedChanges += p.impact.calculatedChanges;
  }

  return {
    changes: parametros.reduce((soma, p) => soma + p.changes, 0),
    vehicles: parametros.length === 1 ? parametros[0].vehicles : null,
    impact,
    pending: parametros.map((p) => p.pending).find((aviso) => aviso) ?? null,
    groups: parametros.flatMap((p) => p.groups),
  };
}

/* ------------------------------------------------------------------ */
/* A barra de filtro                                                   */
/* ------------------------------------------------------------------ */

/**
 * Os quatro campos e o botão, na ordem e no formato do Freightech.
 *
 * O botão FILTRAR fica apagado enquanto a seleção na tela for igual à aplicada
 * — é o mesmo comportamento de lá, e ele é honesto: clicar não faria nada. O
 * campo Parâmetro, que lá só habilita depois de filtrar, aqui filtra a grade em
 * tempo real, porque a grade já está na tela e não custa uma viagem ao servidor.
 *
 * Campo com uma opção só aparece preenchido e desabilitado, com a razão escrita
 * embaixo: um seletor de um item é promessa de variedade que o dado não tem.
 */
function BarraFiltro({
  view,
  onFiltrar,
  busca,
  onBuscar,
  buscaAtiva,
}: {
  view: FamiliesView;
  onFiltrar: (selecao: { scopeHash: string; canal: string | null; period: string }) => void;
  busca: string;
  onBuscar: (valor: string) => void;
  /** Com um cartão aberto não há grade para filtrar; o campo desabilita. */
  buscaAtiva: boolean;
}) {
  const contextos = [view.context, ...view.otherContexts];
  const unidades = [...new Map(contextos.map((c) => [c.scopeHash, c])).values()];

  const [scopeHash, setScopeHash] = useState(view.context.scopeHash);
  const [canal, setCanal] = useState<string | null>(view.context.channel);
  const [period, setPeriod] = useState(view.period);

  // A resposta manda: trocar de unidade pela URL tem de refletir nos campos.
  useEffect(() => {
    setScopeHash(view.context.scopeHash);
    setCanal(view.context.channel);
    setPeriod(view.period);
  }, [view.context.scopeHash, view.context.channel, view.period]);

  const canais = contextos.filter((c) => c.scopeHash === scopeHash);
  const sujo =
    scopeHash !== view.context.scopeHash ||
    canal !== view.context.channel ||
    period !== view.period;

  return (
    /*
      Alinhamento pelo topo, não pelo rodapé.

      Com `items-end` os blocos encostavam a base uns nos outros — e como só
      alguns campos têm nota embaixo ("único canal importado", "3 no
      histórico"), os que tinham nota subiam e os que não tinham desciam. O
      resultado era uma fileira em degraus, com o FILTRAR e o Parametro fora da
      linha dos outros três.

      Agora cada campo é uma coluna de três faixas de altura fixa — rótulo,
      controle, nota — e a nota vazia continua ocupando o seu lugar. Alinhando
      pelo topo, os rótulos ficam numa linha e os controles noutra, sempre.
    */
    <div className="mt-5 flex flex-wrap items-start gap-4">
      <Campo rotulo="Canal/Segmento" nota={canais.length > 1 ? null : "único canal importado"}>
        {canais.length > 1 ? (
          <Select value={canal ?? ""} onValueChange={(valor) => setCanal(valor || null)}>
            <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canais.map((c) => (
                <SelectItem key={c.channel ?? "sem-canal"} value={c.channel ?? ""}>
                  {c.channel ?? "sem canal no rótulo"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CampoFixo valor={canal ?? "sem canal no rótulo"} largura="w-56" />
        )}
      </Campo>

      <Campo rotulo="Vigência" nota={`${view.periods.length} no histórico`}>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {view.periods.map((p) => (
              <SelectItem key={p.date} value={p.date}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <Campo rotulo="Unidade" nota={unidades.length > 1 ? null : "única unidade importada"}>
        {unidades.length > 1 ? (
          <Select
            value={scopeHash}
            onValueChange={(valor) => {
              setScopeHash(valor);
              setCanal(contextos.find((c) => c.scopeHash === valor)?.channel ?? null);
            }}
          >
            <SelectTrigger className="w-56 h-12 rounded-sm bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unidades.map((c) => (
                <SelectItem key={c.scopeHash} value={c.scopeHash}>
                  {nomeDaUnidade(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CampoFixo valor={nomeDaUnidade(view.context)} largura="w-56" />
        )}
      </Campo>

      {/* O botão entra na mesma coluna de três faixas, com o rótulo vazio: é o
          que o põe na linha dos controles em vez de na do rodapé. */}
      <Campo rotulo="" nota={null}>
        <button
          type="button"
          disabled={!sujo}
          onClick={() => onFiltrar({ scopeHash, canal, period })}
          className={cn(
            "h-12 px-8 rounded-sm text-[0.8125rem] font-bold uppercase tracking-wide transition-colors",
            sujo
              ? "bg-brand text-brand-foreground hover:brightness-95"
              : "bg-brand/40 text-white cursor-not-allowed",
          )}
        >
          Filtrar
        </button>
      </Campo>

      <Campo rotulo="Parametro" nota={null}>
        <div className="relative">
          <input
            value={busca}
            disabled={!buscaAtiva}
            onChange={(event) => onBuscar(event.target.value)}
            aria-label="Buscar parâmetro pelo nome"
            className="w-60 h-12 rounded-sm border border-input bg-card pl-3 pr-10 text-sm outline-none focus:border-brand disabled:bg-muted/60"
          />
          <Search className="w-5 h-5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </Campo>
    </div>
  );
}

/**
 * Uma coluna da barra de filtro: rótulo, controle, nota.
 *
 * As três faixas têm altura fixa e a nota vazia continua ocupando a sua. É o
 * que mantém os cinco controles na mesma linha independentemente de qual deles
 * tem explicação embaixo — sem isso a fileira sai em degraus.
 */
function Campo({
  rotulo,
  nota,
  children,
}: {
  /** Vazio no botão: ele não tem rótulo, mas precisa da mesma faixa. */
  rotulo: string;
  nota: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-sm text-muted-foreground h-5 mb-1.5">{rotulo}</div>
      {children}
      <div className="text-[0.6875rem] text-muted-foreground h-4 mt-1">{nota}</div>
    </div>
  );
}

function CampoFixo({ valor, largura }: { valor: string; largura: string }) {
  return (
    <div
      className={cn(
        "h-12 rounded-sm border border-input bg-muted/60 px-3 flex items-center text-sm truncate",
        largura,
      )}
    >
      {valor}
    </div>
  );
}

function nomeDaUnidade(context: FamiliesView["context"]): string {
  const unidade = context.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? context.scopeHash;
}

/* ------------------------------------------------------------------ */
/* A grade                                                             */
/* ------------------------------------------------------------------ */

/**
 * A grade: um bloco por seção, cartões de quatro em quatro.
 *
 * Os favoritos sobem para um bloco próprio no topo, como no Freightech — quem
 * marcou cinco cartões não quer rolar a página inteira todo dia para achá-los.
 */
function Grade({
  view,
  secoes,
  busca,
  onAbrir,
}: {
  view: FamiliesView | null;
  secoes: SecaoRender[];
  busca: string;
  onAbrir: (chave: string) => void;
}) {
  const { favoritos, alternar } = useFavoritos();

  const termo = normalizar(busca.trim());
  const filtradas = secoes
    .map((secao) => ({
      ...secao,
      cartoes: termo
        ? secao.cartoes.filter((c) => normalizar(c.nome).includes(termo))
        : secao.cartoes,
    }))
    .filter((secao) => secao.cartoes.length > 0);

  const marcados = secoes
    .flatMap((s) => s.cartoes)
    .filter((c) => favoritos.includes(c.chave))
    .filter((c) => !termo || normalizar(c.nome).includes(termo));

  /*
    A cobertura conta só as gavetas do Freightech. As nossas entram no total e
    a frase viraria uma meia-verdade — "cartões no catálogo do Freightech" com
    os nossos somados dentro é exatamente o tipo de número que esta tela existe
    para não produzir.
  */
  const doFreightech = secoes
    .filter((s) => s.origem === "FREIGHTECH")
    .flatMap((s) => s.cartoes);
  const total = doFreightech.length;
  const comDado = doFreightech.filter((c) => c.parametros.length > 0).length;
  const soNossos = secoes
    .filter((s) => s.origem === "FREIGHTCHECK")
    .reduce((soma, s) => soma + s.cartoes.length, 0);

  return (
    <>
      {view && (
        <div className="mt-6">
          <Resumo view={view} />
        </div>
      )}

      {view && !view.complete && (
        <div className="mt-5 bg-card border border-l-[6px] border-l-brand flex gap-3 px-6 py-4 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
          <p>
            <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
            {view.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
            <strong>{view.missingSeries.join(", ").toLowerCase()}</strong> — a série ausente
            não está contada como zero.
          </p>
        </div>
      )}

      {/*
        A cobertura, dita de frente. São 60 e poucas gavetas e este export
        alimenta uma minoria delas; deixar isso implícito faria a grade parecer
        um produto pela metade em vez de um mapa honesto do que falta chegar.
      */}
      <p className="mt-5 text-sm text-muted-foreground">
        {total} cartões no catálogo do Freightech · <strong>{comDado}</strong> com dado
        neste export · {total - comDado} ainda sem
        {soNossos > 0 && (
          <>
            {" · "}
            <strong>{soNossos}</strong> {soNossos === 1 ? "cartão" : "cartões"} que só o
            FreightCheck tem
          </>
        )}
      </p>

      {marcados.length > 0 && (
        <Secao titulo="Favoritos">
          {marcados.map((cartao) => (
            <Cartao
              key={`fav-${cartao.chave}`}
              cartao={cartao}
              favorito
              onFavoritar={() => alternar(cartao.chave)}
              onAbrir={() => onAbrir(cartao.chave)}
            />
          ))}
        </Secao>
      )}

      {filtradas.length === 0 && (
        <p className="mt-10 text-sm text-muted-foreground">
          Nenhum cartão com esse nome.
        </p>
      )}

      {filtradas.map((secao) => (
        <Secao
          key={`${secao.origem}-${secao.titulo}`}
          titulo={secao.titulo}
          origem={secao.origem}
          nota={secao.nota}
          resumo={resumoDaSecao(secao)}
        >
          {secao.cartoes.map((cartao) => (
            <Cartao
              key={cartao.chave}
              cartao={cartao}
              favorito={favoritos.includes(cartao.chave)}
              onFavoritar={() => alternar(cartao.chave)}
              onAbrir={() => onAbrir(cartao.chave)}
            />
          ))}
        </Secao>
      ))}
    </>
  );
}

function resumoDaSecao(secao: SecaoRender): string {
  const comDado = secao.cartoes.filter((c) => c.parametros.length > 0).length;
  const mexidos = secao.cartoes.filter((c) => c.changes > 0).length;
  if (comDado === 0) return `${secao.cartoes.length} cartões · nenhum com dado neste export`;
  return `${comDado} de ${secao.cartoes.length} com dado · ${mexidos} ${
    mexidos === 1 ? "mexido nesta vigência" : "mexidos nesta vigência"
  }`;
}

/** O título de seção do Freightech: caixa alta, negrito, régua laranja embaixo. */
function Secao({
  titulo,
  origem,
  nota,
  resumo,
  children,
}: {
  titulo: string;
  origem?: "FREIGHTECH" | "FREIGHTCHECK";
  nota?: string | null;
  resumo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-bold uppercase tracking-wide">{titulo}</h2>
        {origem && (
          <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground border rounded-full px-2 py-0.5">
            {origem === "FREIGHTECH" ? "Freightech" : "FreightCheck"}
          </span>
        )}
        {resumo && <span className="text-xs text-muted-foreground">{resumo}</span>}
      </div>
      <div className="border-b-2 border-brand mt-2" />
      {nota && <p className="text-xs text-muted-foreground mt-3">{nota}</p>}
      <div className="grid gap-5 mt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

/**
 * O cartão do Freightech: barra laranja na lateral esquerda, nome em caixa
 * alta, estrela no rodapé. O miolo entre os dois é o que este produto acrescenta.
 *
 * **O passar do mouse preenche o cartão**, como lá. É o realce que diz "isto
 * abre", e é por isso que **todo cartão abre agora**, inclusive o que não tem
 * dado: um cartão que acende sob o cursor e não responde ao clique promete uma
 * coisa e entrega outra. O que muda é o que se encontra do outro lado — no sem
 * dado, a explicação de por que ele está vazio.
 *
 * O preenchimento usa o laranja **escurecido**, e não o da marca. Sobre o
 * laranja claro o vermelho de perda ficava em 3,4:1 — ilegível — e a primeira
 * saída, pintar tudo de branco, custava a distinção entre perda e ganho
 * justamente no gesto de olhar o número. Com o fundo escuro os dois tons claros
 * cabem: 4,6:1 a perda, 5,8:1 o ganho, 8,2:1 o texto branco.
 */
function Cartao({
  cartao,
  favorito,
  onFavoritar,
  onAbrir,
}: {
  cartao: CartaoRender;
  favorito: boolean;
  onFavoritar: () => void;
  onAbrir: () => void;
}) {
  /*
    Um cartão-cadastro tem dado sem ter alteração: PADRÃO é uma coluna que chega
    em toda planilha, e dizer "sem dado neste export" a respeito dela seria
    falso. Ele não mostra impacto — não é dinheiro, é domínio — mas abre.
  */
  const cadastro = cartao.parametros.length === 0 && cartao.atributos.length > 0;
  const temDado = cartao.parametros.length > 0 || cadastro;
  const mudou = cartao.changes > 0;

  const miolo = (
    <>
      <span
        className={cn(
          "text-[0.9375rem] font-semibold uppercase tracking-wide leading-snug",
          "group-hover:text-white",
          temDado ? "" : "text-muted-foreground",
        )}
      >
        {cartao.nome}
      </span>
      <span className="text-xs text-muted-foreground group-hover:text-white">
        {cartao.secao}
      </span>

      <span className="text-sm mt-1">
        {!temDado ? (
          <span className="text-xs text-muted-foreground group-hover:text-white">
            Sem dado neste export
          </span>
        ) : cadastro ? (
          <span className="text-xs text-muted-foreground group-hover:text-white">
            Cadastro — os valores usados pela frota
          </span>
        ) : mudou ? (
          <ImpactoResumido impact={cartao.impact} className="block" />
        ) : (
          <span className="text-xs text-muted-foreground group-hover:text-white">
            Sem alterações nesta vigência
          </span>
        )}
      </span>

      {mudou && (
        <span className="text-xs text-muted-foreground group-hover:text-white">
          {cartao.changes} {cartao.changes === 1 ? "alteração" : "alterações"}
          {cartao.vehicles !== null && (
            <>
              {" · "}
              {cartao.vehicles} {cartao.vehicles === 1 ? "veículo" : "veículos"}
            </>
          )}
        </span>
      )}

      {cartao.pending && (
        <span className="text-xs text-brand-red group-hover:text-loss-on-dark flex gap-1.5 mt-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          {cartao.pending}
        </span>
      )}
    </>
  );

  return (
    <div
      className={cn(
        /*
          `group` para que a estrela e cada linha do miolo saibam que o cartão
          está sob o cursor; `[&_*]:` para pintar de branco tudo o que está
          dentro, sem ter de repetir a variante em cada span.
        */
        "group border border-l-[5px] flex flex-col shadow-sm transition-colors",
        "hover:bg-brand-dark hover:border-brand-dark hover:shadow-md",
        temDado ? "bg-card border-l-brand" : "bg-card/60 border-l-brand/40",
      )}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="text-left px-5 pt-5 pb-3 flex-1 flex flex-col gap-2 cursor-pointer"
      >
        {miolo}
      </button>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={onFavoritar}
          aria-pressed={favorito}
          aria-label={
            favorito
              ? `Remover ${cartao.nome} dos favoritos`
              : `Marcar ${cartao.nome} como favorito`
          }
          title={favorito ? "Remover dos favoritos" : "Marcar como favorito"}
          className={cn(
            "p-1 -ml-1 hover:scale-110 transition-transform",
            temDado ? "text-brand" : "text-brand/50",
            "group-hover:text-white",
          )}
        >
          <Star className="w-7 h-7" strokeWidth={1.5} fill={favorito ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O cartão aberto                                                     */
/* ------------------------------------------------------------------ */

/**
 * O rastro de contexto, acima do VOLTAR — canal, unidade e vigência.
 *
 * Dentro de um cartão a barra de filtro fica para trás, e sem isto não há na
 * tela nada que diga **de qual seleção** aquela tabela é. Num produto onde a
 * mesma gaveta tem números diferentes por unidade e por vigência, uma tabela
 * sem procedência à vista é um convite a decidir sobre o recorte errado.
 *
 * A vigência aparece pelo rótulo do arquivo de origem (`EMPURRADA_1_8_2026`),
 * e não por "agosto/2026": é o nome que a pessoa procura no Freightech e no
 * e-mail em que o arquivo chegou. Quando a vigência traz mais de uma série —
 * cavalo e carreta são snapshots distintos — os dois rótulos aparecem, porque
 * mostrar um só faria a tela responder por um arquivo que não leu inteiro.
 */
function Rastro({ view }: { view: FamiliesView | null }) {
  if (!view) return null;

  const unidade = view.context.scopes
    .filter((e) => e.scopeType === "UNIDADE" || e.scopeType === "OPERADOR")
    .map((e) => e.name ?? e.code)
    .join("-");

  const partes = [
    view.context.channel ?? "sem canal no rótulo",
    unidade || view.context.scopeHash,
    ...view.series.map((s) => s.snapshotLabel),
  ];

  return (
    <nav
      aria-label="Contexto desta tela"
      className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-4 text-xs text-muted-foreground"
    >
      {partes.map((parte, i) => (
        <span key={`${parte}-${i}`} className="font-mono">
          {parte}
        </span>
      ))}
    </nav>
  );
}

/**
 * O cartão aberto — a tela que o Freightech abre ao clicar no cartão.
 *
 * A forma é a de lá: o botão VOLTAR laranja no canto, o título em caixa alta, e
 * a tabela com o cabeçalho bege e as colunas ordenáveis. Quem abre reconhece o
 * lugar antes de ler.
 *
 * **O que muda é o conteúdo da tabela, e a diferença é a razão do produto.** No
 * Freightech cada linha é um registro do cadastro, e o que ele mostra é o estado
 * de hoje. Aqui cada linha é um ponto que o cliente mexeu, com o valor de antes,
 * o de depois e quanto isso custa — a tabela responde "o que mudou", que é a
 * pergunta que lá exige exportar duas vezes e comparar à mão.
 *
 * **O que não existe aqui: ADICIONAR.** O Freightech é onde o cadastro é feito;
 * este produto lê planilhas exportadas de lá e nunca escreve na fonte. Um botão
 * de adicionar seria uma promessa que a arquitetura inteira desmente, e a regra
 * da casa vale acima da fidelidade visual: não se desenha um controle que não
 * faz o que aparenta.
 */
function DetalheCartao({
  cartao,
  view,
  period,
  contexto,
  onVoltar,
}: {
  cartao: CartaoRender;
  /** A vigência lida — de onde sai o rastro de contexto. Nula sem import. */
  view: FamiliesView | null;
  period: string;
  /** Unidade, canal e vigência, para o cadastro ser lido do mesmo recorte. */
  contexto: URLSearchParams;
  onVoltar: () => void;
}) {
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const cadastro = cartao.parametros.length === 0 && cartao.atributos.length > 0;

  return (
    <div className="mt-6">
      <Rastro view={view} />

      <button
        type="button"
        onClick={onVoltar}
        className="bg-brand text-brand-foreground text-[0.8125rem] font-bold uppercase tracking-wide px-6 py-3 rounded-sm hover:brightness-95 transition-[filter]"
      >
        Voltar
      </button>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {cartao.secao}
          </div>
          <h2 className="text-2xl font-bold uppercase tracking-tight mt-1">{cartao.nome}</h2>
        </div>

        {cartao.parametros.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <ImpactoResumido impact={cartao.impact} />
            <span className="text-muted-foreground">
              {cartao.changes} {cartao.changes === 1 ? "alteração" : "alterações"}
              {cartao.vehicles !== null && (
                <>
                  {" · "}
                  {cartao.vehicles} {cartao.vehicles === 1 ? "veículo" : "veículos"}
                </>
              )}
            </span>
          </div>
        )}
      </div>

      <Contraste cartao={cartao} />

      {cartao.pending && (
        <p className="text-sm text-brand-red flex gap-2 mt-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {cartao.pending}
        </p>
      )}

      {cartao.parametros.length > 1 && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 mt-3">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Reúne {cartao.parametros.map((p) => p.name).join(", ")} — a contagem de veículos
          sai da tela porque o mesmo ativo aparece em mais de um.
        </p>
      )}

      {/*
        Duas telas diferentes atrás do mesmo cartão, porque o Freightech também
        tem duas: a de cadastro, que lista valores, e a de movimento, que lista
        registros. Misturá-las numa tabela só faria as duas ficarem erradas.
      */}
      <div className="mt-5 space-y-5">
        {cadastro ? (
          cartao.atributos.map((codigo) => (
            <TabelaDominio
              key={codigo}
              attributeCode={codigo}
              rotuloDaColuna={cartao.colunas?.[0] ?? "Valor"}
              contexto={contexto}
            />
          ))
        ) : (
          <TabelaFreightech
            id={`cartao:${cartao.chave}`}
            colunas={COLUNAS_ALTERACOES}
            linhas={cartao.groups}
            chave={(grupo) => grupo.key}
            aoClicar={(grupo) =>
              setGrupoAberto((atual) => (atual === grupo.key ? null : grupo.key))
            }
            vazio={<TabelaVazia cartao={cartao} />}
          />
        )}
      </div>

      {/*
        A linha aberta. Fica fora da tabela de propósito: o cartão de detalhe
        traz gráfico, proveniência e a lista de veículos, e nada disso cabe
        dentro de uma célula sem virar uma tabela dentro de outra.
      */}
      {grupoAberto && (
        <div className="mt-5">
          {cartao.groups
            .filter((grupo) => grupo.key === grupoAberto)
            .map((grupo) => (
              <GroupCard key={grupo.key} group={grupo} period={period} />
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * As colunas da tabela de alterações — o que muda num ponto da remuneração.
 *
 * `valor` é o que ordena e o que o filtro procura, e é sempre o dado cru: o
 * impacto ordena pelo número, não pelo texto formatado, senão "-R$ 9.000"
 * viria depois de "-R$ 12.480" por comparação de caractere.
 */
const COLUNAS_ALTERACOES: ColunaTabela<ChangeGroup>[] = [
  {
    titulo: "Parâmetro",
    alinhar: "left",
    valor: (g) => g.title,
    celula: (g) => (
      <div className="min-w-0">
        <div className="font-medium">{g.title}</div>
        {g.attributeCode && (
          <div className="text-xs text-muted-foreground font-mono">{g.attributeCode}</div>
        )}
      </div>
    ),
  },
  {
    titulo: "Equipamento",
    valor: (g) => g.equipment,
    celula: (g) => g.equipment,
  },
  {
    titulo: "Veículos",
    alinhar: "right",
    valor: (g) => g.vehicles,
    celula: (g) => (
      <div>
        <div>{g.vehicles}</div>
        <div className="text-xs text-muted-foreground">{g.coverageLabel}</div>
      </div>
    ),
  },
  {
    titulo: "Antes",
    valor: (g) => g.dominantPattern?.before ?? null,
    celula: (g) => (
      <span className="font-mono text-xs">{g.dominantPattern?.before ?? "—"}</span>
    ),
  },
  {
    titulo: "Depois",
    valor: (g) => g.dominantPattern?.after ?? null,
    celula: (g) => (
      <span className="font-mono text-xs">{g.dominantPattern?.after ?? "—"}</span>
    ),
  },
  {
    titulo: "Variação",
    alinhar: "right",
    valor: (g) => g.aggregate.deltaPercent,
    celula: (g) =>
      g.aggregate.deltaPercent === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span
          className={cn(
            "font-semibold tabular-nums",
            g.aggregate.deltaPercent < 0 ? "text-brand-red" : "text-success",
          )}
        >
          {g.aggregate.deltaPercent > 0 ? "+" : ""}
          {g.aggregate.deltaPercent.toLocaleString("pt-BR", {
            maximumFractionDigits: 1,
          })}
          %
        </span>
      ),
  },
  {
    titulo: "Impacto",
    alinhar: "right",
    valor: (g) => g.impact.amount,
    celula: (g) =>
      g.impact.amount === null ? (
        <span className="text-xs text-muted-foreground">
          {g.impact.reason ?? "não calculável"}
        </span>
      ) : (
        <span
          className={cn(
            "font-bold tabular-nums",
            g.impact.amount < 0 ? "text-brand-red" : "text-success",
          )}
        >
          {formatBrlShort(g.impact.amount)}
          <span className="text-xs font-normal text-muted-foreground">
            {periodicitySuffix(g.impact.periodicity ?? "")}
          </span>
        </span>
      ),
  },
  {
    titulo: "Ações",
    valor: undefined,
    celula: () => (
      <span className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand">
        Ver
      </span>
    ),
  },
];

/**
 * O corpo da tabela quando não há linha — e os dois motivos são diferentes.
 *
 * Sem dado no export, o mais útil que esta tela pode fazer é dizer **quais
 * colunas o Freightech mostra aqui**. "Falta dado neste cartão" manda pedir
 * alguma coisa; a lista de colunas diz o que pedir.
 */
function TabelaVazia({ cartao }: { cartao: CartaoRender }) {
  if (cartao.parametros.length > 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Nenhuma alteração neste cartão nesta vigência — o dado veio e não mudou.
      </span>
    );
  }

  return (
    <p className="text-sm text-left max-w-3xl mx-auto">
      <strong>Esta gaveta existe no Freightech e este export não a alimenta.</strong>{" "}
      Nenhuma coluna da planilha que o FreightCheck recebe cai aqui. O cartão não tem
      número não porque o valor seja zero, mas porque ele não chega — e as colunas
      listadas acima são o que pedir para ele passar a funcionar.
    </p>
  );
}

/**
 * O que a tela de lá mostra, dito aqui — e onde as duas se afastam.
 *
 * Fica sob o título e vale **inclusive quando temos dado**, que é o caso em que
 * o silêncio custa mais caro. ÍNDICE DE REAJUSTE abre com uma tabela cheia de
 * alterações de valor; quem esperava a lista IGPM/IPCA vê números plausíveis no
 * lugar da resposta que procurava, e não tem como perceber a troca. Esta linha
 * é o que torna a diferença visível antes da primeira leitura errada.
 */
function Contraste({ cartao }: { cartao: CartaoRender }) {
  if (!cartao.colunas) {
    return (
      <p className="text-xs text-muted-foreground mt-3 max-w-4xl">
        As colunas que o Freightech mostra nesta tela ainda não foram conferidas —
        inventar um cabeçalho plausível seria pior do que admitir a falta.
      </p>
    );
  }

  return (
    <div className="text-xs text-muted-foreground mt-3 max-w-4xl space-y-1">
      <p>
        No Freightech esta tela traz{" "}
        {cartao.colunas.map((coluna, i) => (
          <span key={coluna}>
            {i > 0 && (i === cartao.colunas!.length - 1 ? " e " : ", ")}
            <span className="font-mono text-foreground">{coluna}</span>
          </span>
        ))}
        .
      </p>
      {cartao.nota && <p>{cartao.nota}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resumo e impacto                                                    */
/* ------------------------------------------------------------------ */

/** O resumo executivo, compactado para caber acima da grade. */
function Resumo({ view }: { view: FamiliesView }) {
  const { summary } = view;
  const liquido = impactEntries(summary.impact.byPeriodicity);

  return (
    <div className="min-w-0">
      <p className="text-lg">
        {summary.changes === 0 ? (
          <>O cliente não mexeu em nada nesta vigência.</>
        ) : (
          <>
            O cliente mexeu em <strong>{summary.groups}</strong>{" "}
            {summary.groups === 1 ? "ponto" : "pontos"} da sua remuneração, em{" "}
            <strong>{view.families.filter((f) => f.changes > 0).length}</strong>{" "}
            {view.families.filter((f) => f.changes > 0).length === 1 ? "família" : "famílias"}
            .
          </>
        )}
      </p>

      {liquido.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mt-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Impacto líquido
          </span>
          {liquido.map((e) => (
            <span
              key={e.periodicity}
              className={cn(
                "text-2xl font-bold tabular-nums",
                e.amount < 0 ? "text-brand-red" : "text-success",
              )}
            >
              {formatBrlShort(e.amount)}
              <span className="text-sm font-normal text-muted-foreground">
                {periodicitySuffix(e.periodicity)}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground mt-2">
        <span>
          <strong className="text-foreground">{summary.changes}</strong> alterações
        </span>
        <span>
          <strong className="text-foreground">{summary.critical}</strong> críticas
        </span>
        <span>
          <strong className="text-foreground">{summary.locked}</strong> com preço travado
        </span>
        <span>
          <strong className="text-foreground">{summary.notCalculable}</strong> sem preço
        </span>
        <span>
          <strong className="text-foreground">{summary.vehiclesTouched}</strong> veículos
          tocados
        </span>
      </div>

      {impactEntries(summary.impact.excludedByPeriodicity).length > 0 && (
        <p className="text-xs text-muted-foreground flex gap-2 mt-2 max-w-2xl">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {impactEntries(summary.impact.excludedByPeriodicity)
              .map((e) => e.label)
              .join(" · ")}{" "}
            ficaram fora do líquido por já estarem contados nas parcelas —{" "}
            {summary.impact.excludedChanges}{" "}
            {summary.impact.excludedChanges === 1 ? "alteração" : "alterações"}.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * O impacto dito pelo motivo certo. Três estados diferentes de "sem número", e
 * confundi-los seria mentir com a melhor das intenções:
 *
 * - **tem impacto** → os valores, um por periodicidade;
 * - **já contado nas parcelas** → o valor existe e é calculável, mas somá-lo de
 *   novo inflaria o total;
 * - **não calculável** → aí sim, e o cartão de dentro traz o motivo por escrito.
 *
 * As variantes `group-hover:` são para quando isto aparece dentro de um cartão
 * realçado: o fundo escurece e perda e ganho trocam para os tons claros, que é
 * o que preserva a distinção entre os dois. Fora de um `group` elas nunca
 * disparam, então o mesmo componente serve à tela de detalhe sem ajuste.
 */
function ImpactoResumido({
  impact,
  className,
}: {
  impact: ImpactSummary;
  className?: string;
}) {
  const entries = impactEntries(impact.byPeriodicity);
  if (entries.length > 0) {
    return (
      <>
        {entries.map((e) => (
          <span
            key={e.periodicity}
            className={cn(
              "font-bold tabular-nums",
              e.amount < 0
                ? "text-brand-red group-hover:text-loss-on-dark"
                : "text-success group-hover:text-gain-on-dark",
              className,
            )}
          >
            {e.label}
          </span>
        ))}
      </>
    );
  }

  const excluded = impactEntries(impact.excludedByPeriodicity);
  if (excluded.length > 0) {
    return (
      <span className="text-xs text-muted-foreground group-hover:text-white">
        {excluded.map((e) => e.label).join(" · ")} — já contado nas parcelas
      </span>
    );
  }

  if (impact.notCalculable > 0) {
    return (
      <span className="text-xs text-muted-foreground group-hover:text-white">
        Impacto não calculável
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground group-hover:text-white">
      Sem impacto apurado
    </span>
  );
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
