import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CircleHelp,
  Coins,
  Layers,
  ListTree,
  Route,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { formatBrlShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Panorama — a entrada da aba Impacto: **tudo que mudou**.
 *
 * A aba abria direto na tabela de um parâmetro. Abrir num parâmetro afirma, sem
 * dizer, que foi aquele que mudou — e nos dados reais o FINAME do cavalo é o
 * décimo em número de alterações, enquanto o IPVA muda em 62 das 64 placas. O
 * dropdown estava lá, mas descobrir o que mudou não pode custar quarenta
 * opções percorridas uma a uma.
 *
 * Duas decisões de tela seguem daí, e nenhuma é estética:
 *
 * **Dois rankings, nunca um.** "O que mais mudou" e "o que mais custou" são
 * perguntas diferentes, e um ranking só teria de escolher uma ordem para as
 * duas. `manutencao_vida_meses` muda 494 vezes e não é dinheiro nenhum;
 * `carreta.finame` muda 47 vezes e move R$ 225 mil. Ordenar por quantidade
 * enterra o segundo; ordenar por dinheiro esconde o primeiro.
 *
 * **Quem não passa na régua aparece com o motivo.** Um parâmetro que mudou e
 * que ainda não sabemos monetizar é informação, e escondê-lo faria a tela dizer
 * que nada mudou ali. Ele entra no ranking de alterações, fica fora do
 * financeiro, e a linha diz qual das três confirmações falta.
 *
 * **Fixo e variável se escolhem, e o resto da tela inteira acompanha.** São
 * dois dinheiros, e quem confere o mês pergunta por um de cada vez — o
 * financiamento subiu, ou foi o combustível? O seletor troca os quatro números
 * do topo e as três tabelas de uma vez: um corte que valesse só para uma
 * tabela deixaria os ladrilhos falando do todo enquanto a lista embaixo fala de
 * uma classe. Os recortes vêm prontos do servidor, filtrados dos mesmos
 * rankings — fixo, variável e sem classe somam exatamente o todo.
 */

type PapelEconomico = "TOTAL" | "PARCELA" | "CONJUNTO" | "SIMPLES";

type ClasseDeCusto = "FIXO" | "VARIAVEL" | "SEM_CLASSE";

/**
 * O corte escolhido na tela. `TUDO` é o panorama inteiro, sem filtro.
 *
 * Mora no componente de cima, e não aqui dentro: quem filtra por custo variável
 * e clica numa linha vai ao segundo nível e volta — e voltar para "Tudo" perde
 * o corte no meio da pergunta, que é o mesmo desperdício que o botão de volta
 * existe para evitar.
 */
export type Corte = "TUDO" | ClasseDeCusto;

interface Reconciliacao {
  linhas: number;
  fecham: number;
  percentual: number;
}

interface PontaDoParametro {
  effectiveDate: string;
  sourceLabel: string;
  total: number | null;
  withValue: number;
}

interface VariacaoDecomposta {
  total: number;
  preco: number;
  frota: number;
  entraram: { entities: number; amount: number };
  sairam: { entities: number; amount: number };
  comparados: number;
}

export interface ParametroAlterado {
  code: string;
  title: string;
  entityType: string;
  equipment: string;
  changes: number;
  entities: number;
  entitiesNaSerie: number;
  from: PontaDoParametro | null;
  to: PontaDoParametro | null;
  variacao: VariacaoDecomposta | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  impactoCalculavel: boolean;
  impactoMotivo: string;
  classeDeCusto: ClasseDeCusto;
  grupoDeCusto: string | null;
  papel: PapelEconomico;
  dentroDe: string | null;
  parcelas: string[];
  contem: string | null;
  evidencia: string | null;
  reconciliacao: Reconciliacao | null;
}

interface PanoramaPeriodo {
  effectiveDate: string;
  sourceLabel: string;
  entityTypes: string[];
}

interface ImpactoPorPeriodicidade {
  periodicity: string | null;
  codes: string[];
}

interface TotaisDoPanorama {
  linhasEconomicas: number;
  parametrosAlterados: number;
  comImpacto: number;
  semImpacto: number;
  alteracoes: number;
  ativosAfetados: number;
}

/** As listas de uma leitura: o panorama inteiro, ou o de uma classe de custo. */
interface LeituraDeAlteracoes {
  maisAlterados: string[];
  maiorImpacto: string[];
  impactoPorPeriodicidade: ImpactoPorPeriodicidade[];
  semLeituraFinanceira: string[];
  visaoDeConjunto: string[];
  totais: TotaisDoPanorama;
}

interface RecorteDeCusto extends LeituraDeAlteracoes {
  classe: ClasseDeCusto;
  nome: string;
  descricao: string;
}

interface Panorama extends LeituraDeAlteracoes {
  periods: PanoramaPeriodo[];
  parametros: ParametroAlterado[];
  recortes: RecorteDeCusto[];
}

export interface EscolhaDeParametro {
  entityType: string;
  code: string;
}

const POR_PERIODO: Record<string, string> = {
  MENSAL: "por mês",
  ANUAL: "por ano",
  PONTUAL: "valor único",
};

/** Como cada classe se lê ao lado do equipamento, na linha da tabela. */
const CLASSE_EM_PALAVRAS: Record<ClasseDeCusto, string> = {
  FIXO: "custo fixo",
  VARIAVEL: "custo variável",
  SEM_CLASSE: "sem classe de custo",
};

/**
 * O complemento que cada classe pede depois de "nenhum parâmetro…".
 *
 * As duas formas ficam juntas porque a segunda não sai da primeira: "de" mais
 * "sem classe de custo" produz "nenhum parâmetro de sem classe de custo", e a
 * frase da tela não pode depender de as três caixas terem, por acaso, a mesma
 * regência.
 */
const CLASSE_NA_FRASE: Record<ClasseDeCusto, string> = {
  FIXO: "de custo fixo",
  VARIAVEL: "de custo variável",
  SEM_CLASSE: "sem classe de custo",
};

/** A unidade como se lê, e não como se guarda. */
function unidadeCurta(p: ParametroAlterado): string {
  if (p.unit === "BRL") return "R$";
  if (p.unit === "PERCENT") return "%";
  return p.unit ?? "—";
}

export function ImpactoPanorama({
  onEscolher,
  corte,
  onCorte,
  contexto,
}: {
  onEscolher: (escolha: EscolhaDeParametro) => void;
  corte: Corte;
  onCorte: (c: Corte) => void;
  /**
   * A unidade e o canal abertos — `scopeHash` e `canal`, vazio quando não há.
   *
   * A rota sempre soube receber contexto; esta tela é que não mandava, e por
   * isso respondia pela unidade mais recente do banco mesmo para quem tinha
   * acabado de trocar de unidade na Visão geral. Sem período: a leitura é a
   * série inteira de quinzenas, e recortá-la numa vigência deixaria uma coluna.
   */
  contexto?: URLSearchParams;
}) {
  const consulta = contexto?.toString() ?? "";
  const query = useQuery({
    queryKey: ["impacto", "panorama", consulta],
    queryFn: () =>
      fetchJson<Panorama>(`/impacto/panorama${consulta ? `?${consulta}` : ""}`),
  });

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what="O panorama de alterações não pôde ser carregado."
      />
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Lendo as vigências…</p>
      </Card>
    );
  }

  const porCodigo = new Map(data.parametros.map((p) => [p.code, p]));
  const lista = (codes: string[]) =>
    codes.map((c) => porCodigo.get(c)).filter((p): p is ParametroAlterado => !!p);

  /*
    A leitura ativa. `TUDO` é o próprio panorama — ele já tem a mesma forma dos
    recortes, e é por isso que a tela abaixo não sabe qual dos dois está lendo.
  */
  const recorte = data.recortes.find((r) => r.classe === corte) ?? null;
  const leitura: LeituraDeAlteracoes = recorte ?? data;

  const financeiros = lista(leitura.maiorImpacto);
  const alterados = lista(leitura.maisAlterados);
  const conjunto = lista(leitura.visaoDeConjunto);
  const recorteVazio = recorte !== null && recorte.totais.parametrosAlterados === 0;
  const primeira = data.periods[0];
  const ultima = data.periods[data.periods.length - 1];

  if (data.parametros.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          Nenhum parâmetro mudou de valor entre as {data.periods.length}{" "}
          vigências desta série.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Tudo que mudou</h2>
        <p className="text-sm text-muted-foreground">
          Entre <strong>{primeira?.sourceLabel}</strong> e{" "}
          <strong>{ultima?.sourceLabel}</strong> — {data.periods.length}{" "}
          vigências. Clique numa linha para abrir a tabela por placa e vigência.
        </p>
      </div>

      <SeletorDeClasse
        recortes={data.recortes}
        totalGeral={data.totais.linhasEconomicas}
        corte={corte}
        onCorte={onCorte}
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          tone="blue"
          icon={<ListTree className="w-6 h-6" />}
          label="Linhas econômicas"
          value={formatNumber(leitura.totais.linhasEconomicas, 0)}
          hint="parcelas de um total já contado ficam no drill-down"
        />
        <Resumo
          tone="slate"
          icon={<Layers className="w-6 h-6" />}
          label="Alterações de valor"
          value={formatNumber(leitura.totais.alteracoes, 0)}
          hint={`em até ${leitura.totais.ativosAfetados} veículos`}
        />
        <Resumo
          tone="green"
          icon={<Coins className="w-6 h-6" />}
          label="Com impacto apurável"
          value={formatNumber(leitura.totais.comImpacto, 0)}
          hint="semântica confirmada, monetária e somável"
        />
        <Resumo
          tone="amber"
          icon={<AlertTriangle className="w-6 h-6" />}
          label="Sem leitura financeira"
          value={formatNumber(leitura.totais.semImpacto, 0)}
          hint="mudaram, e ainda não sabemos quanto representam"
        />
      </div>

      {/*
        Um recorte vazio é uma resposta, e precisa ser dita: sem esta frase a
        tela mostraria três tabelas vazias, que se leem como defeito e não como
        "nada desta classe mudou".
      */}
      {recorteVazio && (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            Nenhum parâmetro {recorte && CLASSE_NA_FRASE[recorte.classe]} mudou
            de valor entre estas {data.periods.length} vigências.
          </p>
        </Card>
      )}

      {/* ---- ranking 1: o dinheiro ------------------------------------- */}
      {!recorteVazio && (
        <Card className="overflow-hidden">
          <Cabecalho
            titulo="Maior impacto financeiro"
            detalhe={
              financeiros.length > 0
                ? "Só os parâmetros cuja semântica sustenta soma de dinheiro. A variação já vem separada em preço e frota — frota maior não é preço maior. Uma lista por periodicidade: R$/mês e R$/ano não se ordenam juntos sem uma conversão que aqui não se faz."
                : recorte
                  ? `Nenhum parâmetro ${CLASSE_NA_FRASE[recorte.classe]} passa na régua do impacto ainda. As ${formatNumber(recorte.totais.alteracoes, 0)} alterações desta classe aparecem abaixo, cada uma com o motivo de não haver dinheiro apurado.`
                  : "Nenhum parâmetro alterado passa na régua do impacto ainda."
            }
          />
          {leitura.impactoPorPeriodicidade.map((grupo) => (
            <div key={grupo.periodicity ?? "sem"}>
              <div className="border-b bg-muted/30 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {grupo.periodicity
                  ? (POR_PERIODO[grupo.periodicity] ?? grupo.periodicity.toLowerCase())
                  : "sem periodicidade declarada"}
              </div>
              <TabelaFinanceira
                linhas={lista(grupo.codes)}
                onEscolher={onEscolher}
                comClasse={corte === "TUDO"}
              />
            </div>
          ))}
        </Card>
      )}

      {/* ---- as colunas que já contêm o outro equipamento --------------- */}
      {conjunto.length > 0 && (
        <Card className="overflow-hidden">
          <Cabecalho
            titulo="Visão de conjunto"
            detalhe="Estas colunas já carregam o outro equipamento dentro delas — somá-las às linhas acima contaria cada cavalo duas vezes. Ficam aqui, fora dos rankings, porque quem confere a planilha vai encontrá-las e precisa saber por que não entraram."
          />
          <TabelaFinanceira
            linhas={conjunto}
            onEscolher={onEscolher}
            comClasse={corte === "TUDO"}
          />
        </Card>
      )}

      {/* ---- ranking 2: a quantidade ----------------------------------- */}
      {alterados.length > 0 && (
        <Card className="overflow-hidden">
          <Cabecalho
            titulo="Mais alterados"
            detalhe="Por quantidade de mudanças de valor, monetário ou não — meses, km, km/l, R$/km e percentuais entram aqui. Quantidade de alterações não é impacto financeiro, e esta coluna nunca vira dinheiro."
          />
          <TabelaDeAlteracoes
            linhas={alterados}
            onEscolher={onEscolher}
            comClasse={corte === "TUDO"}
          />
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        <strong>Por que a soma das linhas não bate com a frota.</strong> Um
        parâmetro que é parcela de outro — os juros dentro do FINAME, por
        exemplo — não aparece como linha própria nos rankings: ele é a mesma
        alteração vista de novo, e some do topo para reaparecer no drill-down do
        total. O mesmo vale para as colunas de conjunto, marcadas na tabela, que
        já carregam o outro equipamento dentro delas.
        {recorte && (
          <>
            {" "}
            <strong>E por que este corte não muda nenhum número.</strong> Fixo,
            variável e sem classe são o mesmo panorama filtrado — as mesmas
            exclusões, a mesma ordem —, e as três caixas somam exatamente as{" "}
            {formatNumber(data.totais.linhasEconomicas, 0)} linhas econômicas de
            “Tudo”.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * O ícone de cada corte — o mesmo do bloco de classes da aba Chamados.
 *
 * Galpão para o fixo e estrada para o variável não são escolhas novas: quem
 * abre este produto todo mês já viu as duas ali, e trocá-las aqui obrigaria a
 * reaprender a mesma distinção numa segunda tela.
 */
const ICONE_DO_CORTE: Record<Corte, React.ReactNode> = {
  TUDO: <Layers className="w-4 h-4" />,
  FIXO: <Warehouse className="w-4 h-4" />,
  VARIAVEL: <Route className="w-4 h-4" />,
  SEM_CLASSE: <CircleHelp className="w-4 h-4" />,
};

/**
 * O seletor de classe de custo.
 *
 * Pílulas e não um `select`: são quatro opções, sempre as mesmas, e a contagem
 * de cada uma é metade da informação — quem abre a aba precisa ver que 10 das
 * 27 linhas são de custo variável **antes** de decidir se quer olhar para elas.
 * Um dropdown esconderia exatamente isso atrás de um clique.
 *
 * Uma caixa vazia continua clicável, com o zero à mostra. Desabilitá-la
 * pareceria defeito da tela; o zero é um resultado, e leva a uma frase que diz
 * qual classe não mudou.
 */
function SeletorDeClasse({
  recortes,
  totalGeral,
  corte,
  onCorte,
}: {
  recortes: RecorteDeCusto[];
  totalGeral: number;
  corte: Corte;
  onCorte: (c: Corte) => void;
}) {
  const opcoes: { valor: Corte; nome: string; contagem: number; titulo: string }[] = [
    {
      valor: "TUDO",
      nome: "Tudo",
      contagem: totalGeral,
      titulo: "Fixo, variável e sem classe numa lista só.",
    },
    ...recortes.map((r) => ({
      valor: r.classe as Corte,
      nome: r.nome,
      contagem: r.totais.linhasEconomicas,
      titulo: r.descricao,
    })),
  ];

  const ativo = opcoes.find((o) => o.valor === corte);

  return (
    <div className="space-y-2">
      <div
        role="tablist"
        aria-label="classe de custo"
        className="inline-flex flex-wrap rounded-xl border bg-muted/50 p-1"
      >
        {opcoes.map((o) => (
          <button
            key={o.valor}
            role="tab"
            aria-selected={o.valor === corte}
            title={o.titulo}
            onClick={() => onCorte(o.valor)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              o.valor === corte
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ICONE_DO_CORTE[o.valor]}
            {o.nome}
            <span className="tabular-nums text-xs text-muted-foreground">
              {formatNumber(o.contagem, 0)}
            </span>
          </button>
        ))}
      </div>
      {/*
        A frase da classe fica na tela, e não só no `title`: "custo variável" é
        um rótulo que cada empresa preenche de um jeito, e quem confere precisa
        saber que aqui ele quer dizer combustível, manutenção, pneus e lucro
        variável — que é o que a taxonomia declara.
      */}
      {ativo && corte !== "TUDO" && (
        <p className="text-xs text-muted-foreground max-w-3xl">{ativo.titulo}</p>
      )}
    </div>
  );
}

function Cabecalho({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="border-b px-4 py-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{detalhe}</p>
    </div>
  );
}

function TabelaFinanceira({
  linhas,
  onEscolher,
  comClasse,
}: {
  linhas: ParametroAlterado[];
  onEscolher: (e: EscolhaDeParametro) => void;
  comClasse: boolean;
}) {
  const dinheiro = (v: number | null) =>
    v === null ? "—" : formatBrlShort(v);
  const comSinal = (v: number) => `${v > 0 ? "+" : ""}${formatBrlShort(v)}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-4 py-2">Parâmetro</th>
            <th className="text-right font-medium px-3 py-2">Veículos</th>
            <th className="text-right font-medium px-3 py-2">Alterações</th>
            <th className="text-right font-medium px-3 py-2">Anterior</th>
            <th className="text-right font-medium px-3 py-2">Atual</th>
            <th className="text-right font-medium px-3 py-2">Variação</th>
            <th className="text-right font-medium px-3 py-2">Disso, preço</th>
            <th className="text-left font-medium px-3 py-2">Régua</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr
              key={p.code}
              onClick={() => onEscolher({ entityType: p.entityType, code: p.code })}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEscolher({ entityType: p.entityType, code: p.code });
                }
              }}
              className="border-b last:border-0 cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
            >
              <td className="px-4 py-2.5">
                <NomeDoParametro p={p} comClasse={comClasse} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.entities}
                <span className="text-muted-foreground">/{p.entitiesNaSerie}</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{p.changes}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {dinheiro(p.from?.total ?? null)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {dinheiro(p.to?.total ?? null)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 text-right tabular-nums font-medium",
                  (p.variacao?.total ?? 0) < 0 && "text-red-600",
                  (p.variacao?.total ?? 0) > 0 && "text-emerald-700",
                )}
              >
                {p.variacao ? comSinal(p.variacao.total) : "—"}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.variacao ? (
                  <>
                    <span
                      className={cn(
                        p.variacao.preco < 0 && "text-red-600",
                        p.variacao.preco > 0 && "text-emerald-700",
                      )}
                    >
                      {comSinal(p.variacao.preco)}
                    </span>
                    {p.variacao.frota !== 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        frota {comSinal(p.variacao.frota)}
                      </div>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                <div className="whitespace-nowrap">
                  {unidadeCurta(p)}
                  {p.periodicity && (
                    <> · {POR_PERIODO[p.periodicity] ?? p.periodicity.toLowerCase()}</>
                  )}
                </div>
                {p.reconciliacao && (
                  <div className="text-[11px] whitespace-nowrap">
                    {formatNumber(p.reconciliacao.percentual, 1)}% reconciliado
                  </div>
                )}
                {/*
                  O traço nas colunas de dinheiro precisa de um porquê ao lado.
                  Uma coluna de conjunto sem semântica confirmada aparece aqui
                  com as somas do arquivo e sem variação apurada — sem esta
                  frase, o traço se pareceria com "não mudou".
                */}
                {!p.impactoCalculavel && (
                  <div className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
                    <TriangleAlert className="w-3 h-3 mt-px shrink-0" />
                    <span className="max-w-[16rem]">{p.impactoMotivo}</span>
                  </div>
                )}
              </td>
              <td className="px-2 text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDeAlteracoes({
  linhas,
  onEscolher,
  comClasse,
}: {
  linhas: ParametroAlterado[];
  onEscolher: (e: EscolhaDeParametro) => void;
  comClasse: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-4 py-2">Parâmetro</th>
            <th className="text-right font-medium px-3 py-2">Alterações</th>
            <th className="text-right font-medium px-3 py-2">Veículos</th>
            <th className="text-left font-medium px-3 py-2">Unidade</th>
            <th className="text-left font-medium px-3 py-2">Periodicidade</th>
            <th className="text-left font-medium px-3 py-2">Impacto financeiro</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr
              key={p.code}
              onClick={() => onEscolher({ entityType: p.entityType, code: p.code })}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEscolher({ entityType: p.entityType, code: p.code });
                }
              }}
              className="border-b last:border-0 cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
            >
              <td className="px-4 py-2.5">
                <NomeDoParametro p={p} comClasse={comClasse} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {p.changes}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {p.entities}
                <span className="text-muted-foreground">/{p.entitiesNaSerie}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {unidadeCurta(p)}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {p.periodicity
                  ? (POR_PERIODO[p.periodicity] ?? p.periodicity.toLowerCase())
                  : "—"}
              </td>
              <td className="px-3 py-2.5 text-xs">
                {p.impactoCalculavel ? (
                  <span className="text-emerald-700">
                    {p.variacao
                      ? `${p.variacao.preco > 0 ? "+" : ""}${formatBrlShort(p.variacao.preco)} de preço`
                      : "apurável"}
                  </span>
                ) : (
                  <span className="inline-flex items-start gap-1.5 text-amber-700">
                    <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span className="max-w-xs">{p.impactoMotivo}</span>
                  </span>
                )}
              </td>
              <td className="px-2 text-muted-foreground">
                <ArrowRight className="w-4 h-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O nome, o equipamento e o que a linha é dentro da árvore econômica.
 *
 * As etiquetas não são decoração: "contém o cavalo" é a diferença entre um
 * número que pode ser somado à frota de cavalos e um que já a contém.
 *
 * O grupo da taxonomia — "Combustível", "Seguros e tributos" — vem sempre, e é
 * ele que torna a classe conferível: "custo variável" é um rótulo que cada
 * empresa preenche de um jeito, e a linha que o afirma precisa dizer de onde
 * ele saiu. A classe em si só aparece em "Tudo": dentro de um recorte ela
 * repetiria, linha a linha, o que o seletor já diz uma vez.
 */
function NomeDoParametro({
  p,
  comClasse,
}: {
  p: ParametroAlterado;
  comClasse: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{p.title}</div>
      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
        <span>{p.equipment.toLowerCase()}</span>
        <span aria-hidden>·</span>
        <span>
          {comClasse && <>{CLASSE_EM_PALAVRAS[p.classeDeCusto]} · </>}
          {p.grupoDeCusto ?? "sem grupo na taxonomia"}
        </span>
        {p.papel === "TOTAL" && (
          <Etiqueta tone="neutro">
            total de {p.parcelas.length} parcelas
          </Etiqueta>
        )}
        {p.papel === "CONJUNTO" && (
          <Etiqueta tone="conjunto" title={p.evidencia ?? undefined}>
            já contém o outro equipamento
          </Etiqueta>
        )}
        {p.papel === "PARCELA" && <Etiqueta tone="neutro">parcela</Etiqueta>}
        {p.semanticsStatus !== "CONFIRMED" && (
          <Etiqueta tone="atencao">
            {p.semanticsStatus === "PRESUMED" ? "presumido" : "sem semântica"}
          </Etiqueta>
        )}
      </div>
    </div>
  );
}

/**
 * As etiquetas saem dos tokens, e não de uma cor escolhida à mão.
 *
 * A paleta do produto virou marinho, branco e laranja; um roxo inventado aqui
 * ficaria fora dela na primeira tela que alguém abrisse. `brand` e `warning`
 * acompanham o tema — inclusive o escuro, onde uma cor fixa da paleta do
 * Tailwind não acompanha nada.
 */
const ETIQUETA = {
  neutro: "bg-muted text-muted-foreground",
  atencao: "bg-warning/15 text-warning-foreground",
  conjunto: "bg-brand/10 text-brand",
} as const;

function Etiqueta({
  tone,
  children,
  title,
}: {
  tone: keyof typeof ETIQUETA;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
        ETIQUETA[tone],
      )}
    >
      {children}
    </span>
  );
}

const LADRILHO = {
  blue: "bg-brand/10 text-brand",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600",
} as const;

function Resumo({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-12 w-12 rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tracking-tight tabular-nums mt-0.5 truncate">
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </div>
    </div>
  );
}
