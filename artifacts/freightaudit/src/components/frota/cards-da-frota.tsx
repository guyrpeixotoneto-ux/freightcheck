import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bolinha, VariacaoMensal } from "@/components/composicao/farol";
import {
  ROTULO_DA_NAO_APURACAO,
  ROTULO_DO_FAROL,
  type Farol,
  type LinhaDaFrota,
} from "@/components/composicao/tipos";
import { fetchJson } from "@/lib/api";
import { formatBrl, formatBrlShort } from "@/lib/format";
import { TELA_DO_EQUIPAMENTO, type Equipamento } from "@/lib/frota";
import { cn } from "@/lib/utils";

/**
 * A frota em cards — a porta de Cavalo 360° e Carreta 360°.
 *
 * O módulo abria na lista de alterações de todos os cavalos, e essa é a
 * pergunta errada para quem chega: "o que mudou nos cavalos" é uma leitura de
 * auditoria, e quem abre uma tela chamada Cavalo 360° quer **ver os cavalos**.
 * Aqui cada ativo é um card, e o clique abre a situação inteira dele.
 *
 * **A forma é a da Composição, e isso é decisão e não coincidência.** O resumo
 * de quatro colunas, a barra de filtros e os rótulos — "Remuneração apurada",
 * "Variação", "Alertas" — são os mesmos de lá, porque o número **é** o mesmo:
 * esta tela lê `getVisaoDeFrota`, a mesma autoridade. Duas telas que mostram a
 * mesma remuneração com dois nomes diferentes ensinam que são dois números, e a
 * primeira vez que alguém os vir divergir por arredondamento vai acreditar.
 *
 * O que estes cards têm a mais é a leitura de **movimento**: quantas alterações
 * de planilha o ativo teve no período, quantos chamados ele tem, e a alteração
 * mais material dele escrita por extenso. As três não somam entre si nem com a
 * remuneração — são réguas diferentes, e o rodapé da tela diz de onde vem cada
 * uma.
 */

/** Um ativo como `/frota/panorama` o entrega: a linha da frota, com as contagens. */
export interface AtivoDoPanorama extends LinhaDaFrota {
  alteracoes: number;
  maiorAlteracao: {
    attributeCode: string | null;
    attributeName: string | null;
    valueBefore: string | null;
    valueAfter: string | null;
    deltaAbsolute: number | null;
    deltaPercent: number | null;
    impactAmount: number | null;
    impactPeriodicity: string | null;
  } | null;
  chamados: number;
  alteracoesDeChamado: number;
}

export interface PanoramaDaFrota {
  entityType: string;
  rotuloDoTipo: string;
  effectiveDate: string;
  periodLabel: string;
  anterior: { effectiveDate: string; periodLabel: string } | null;
  serieEntregue: boolean;
  resumo: {
    equipamentos: number;
    comValorApurado: number;
    mensalTotal: number;
    variacaoTotal: number | null;
    comAumento: number;
    comReducao: number;
    semVariacao: number;
    incompletos: number;
    componentesSemRegra: number;
    porFarol: Record<Farol, number>;
  };
  procedencia: {
    comparacao: { period: string; completa: boolean } | null;
    envioDeChamados: { id: string; filename: string; receivedAt: string } | null;
  };
  ativos: AtivoDoPanorama[];
}

/**
 * Por onde a grade está ordenada.
 *
 * O padrão é **o que mais mudou**, e não a placa. Numa frota de 62 cavalos, a
 * ordem alfabética esconde os cinco que mexeram no meio dos cinquenta e sete
 * que não mexeram — e a tela existe para achar justamente esses cinco. A placa
 * continua a um clique, para quem chegou procurando um ativo e não um problema.
 */
type Ordem = "movimento" | "valor" | "placa";

const ORDENS: { chave: Ordem; rotulo: string }[] = [
  { chave: "movimento", rotulo: "O que mais mudou" },
  { chave: "valor", rotulo: "O que mais custa" },
  { chave: "placa", rotulo: "Placa" },
];

/** Os recortes rápidos. Cada um responde a uma das leituras do card. */
type Recorte = "comAlteracao" | "comChamado" | "comAlerta";

const RECORTES: { chave: Recorte; rotulo: string }[] = [
  { chave: "comAlteracao", rotulo: "Com alteração na vigência" },
  { chave: "comChamado", rotulo: "Com chamado" },
  { chave: "comAlerta", rotulo: "Com alerta" },
];

export function CardsDaFrota({
  equipamento,
  contexto,
  onAbrir,
  onVerFrotaInteira,
}: {
  equipamento: Equipamento;
  /** Unidade e canal — o mesmo recorte que atravessa o módulo. */
  contexto: URLSearchParams;
  /** Abrir um ativo: é o nível 2, com as quatro abas recortadas nele. */
  onAbrir: (placa: string) => void;
  /** A leitura da frota inteira — as quatro abas de todos os ativos. */
  onVerFrotaInteira: () => void;
}) {
  const tela = TELA_DO_EQUIPAMENTO[equipamento];
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<Farol | "">("");
  const [recortes, setRecortes] = useState<Record<Recorte, boolean>>({
    comAlteracao: false,
    comChamado: false,
    comAlerta: false,
  });
  const [ordem, setOrdem] = useState<Ordem>("movimento");

  const query = useQuery({
    queryKey: ["frota", "panorama", equipamento, contexto.toString()],
    queryFn: () => {
      const consulta = new URLSearchParams(contexto);
      consulta.set("entityType", equipamento);
      return fetchJson<PanoramaDaFrota>(`/frota/panorama?${consulta}`);
    },
  });

  /*
    Busca e recortes filtram **no navegador**, e não na rota.

    A rota já entrega a frota inteira — são 62 cavalos, não 62 mil —, e mandar
    cada tecla digitada ao servidor trocaria uma filtragem instantânea por uma
    com latência, sem ganho nenhum. O que importa é que os números do topo
    continuem sendo os **da frota**, e não os do filtro: é isso que impede a tela
    de parecer menor do que a operação é, e é a mesma regra da Composição.
  */
  const ativos = useMemo(() => {
    const todos = query.data?.ativos ?? [];
    const termo = busca.trim().toUpperCase();
    const filtrados = todos.filter((a) => {
      if (status !== "" && a.status.farol !== status) return false;
      if (recortes.comAlteracao && a.alteracoes === 0) return false;
      if (recortes.comChamado && a.chamados === 0) return false;
      if (recortes.comAlerta && a.status.alertas === 0) return false;
      if (termo === "") return true;
      return (
        (a.placa ?? "").includes(termo) || (a.chassi ?? "").toUpperCase().includes(termo)
      );
    });

    const porPlaca = (a: AtivoDoPanorama, b: AtivoDoPanorama) =>
      (a.placa ?? "￿").localeCompare(b.placa ?? "￿", "pt-BR", { numeric: true });

    return [...filtrados].sort((a, b) => {
      if (ordem === "placa") return porPlaca(a, b);
      if (ordem === "valor") return (b.mensal ?? -1) - (a.mensal ?? -1) || porPlaca(a, b);
      /*
        Movimento: quem mexeu primeiro, e entre os que mexeram, o maior salto em
        dinheiro. O desempate final é a placa para que a grade não se reordene
        sozinha entre dois ativos empatados — uma grade instável faz o olho
        perder o lugar a cada carregamento.
      */
      const mexeu = (x: AtivoDoPanorama) => (x.alteracoes > 0 || x.chamados > 0 ? 1 : 0);
      return (
        mexeu(b) - mexeu(a) ||
        Math.abs(b.variacao?.absoluta ?? 0) - Math.abs(a.variacao?.absoluta ?? 0) ||
        b.alteracoes - a.alteracoes ||
        porPlaca(a, b)
      );
    });
  }, [query.data, busca, status, recortes, ordem]);

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what={`A frota de ${tela.plural} não pôde ser carregada.`}
      />
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
        Lendo a frota…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <Resumo panorama={data} equipamento={equipamento} onVerFrotaInteira={onVerFrotaInteira} />

      <BarraDeFiltros
        busca={busca}
        onBusca={setBusca}
        status={status}
        onStatus={setStatus}
        recortes={recortes}
        onRecorte={(chave) =>
          setRecortes((atual) => ({ ...atual, [chave]: !atual[chave] }))
        }
        ordem={ordem}
        onOrdem={setOrdem}
        resultado={`${ativos.length} de ${data.resumo.equipamentos}`}
      />

      {ativos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
          Nenhum {tela.singular} nesta vigência com os filtros aplicados. A frota
          tem {data.resumo.equipamentos.toLocaleString("pt-BR")}.
        </p>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {ativos.map((ativo) => (
            <CardDoAtivo
              key={ativo.entityId}
              ativo={ativo}
              anterior={data.anterior?.periodLabel ?? null}
              onAbrir={onAbrir}
            />
          ))}
        </div>
      )}

      {/*
        De onde vem cada contagem. Fica no rodapé, e não em cada card: é a mesma
        procedência para todos, e repeti-la 62 vezes seria ruído. Calá-la, porém,
        deixaria alguém ler "2 chamados" como "2 chamados em agosto" — e o export
        de chamados não tem vigência.
      */}
      <p className="text-xs text-muted-foreground">
        Remuneração e variação apuradas pela Composição em {data.periodLabel}
        {data.procedencia.comparacao && (
          <>
            {" "}
            · alterações da comparação de {data.procedencia.comparacao.period}
            {!data.procedencia.comparacao.completa && " (consolidado parcial)"}
          </>
        )}
        {data.procedencia.envioDeChamados ? (
          <>
            {" "}
            · chamados do envio{" "}
            <span className="font-mono">{data.procedencia.envioDeChamados.filename}</span>,
            que não é recortado por vigência
          </>
        ) : (
          <> · nenhum export de chamados importado</>
        )}
        . As três leituras não somam entre si.
      </p>
    </div>
  );
}

/**
 * Os números da frota.
 *
 * Sem moldura de cartão: quatro colunas separadas por uma linha vertical fina —
 * a mesma forma da Composição, e pela mesma razão que está escrita lá. Um cartão
 * por número transformaria o resumo em quatro objetos a examinar, e eles são um
 * só: a mesma frota, lida de quatro ângulos.
 */
function Resumo({
  panorama,
  equipamento,
  onVerFrotaInteira,
}: {
  panorama: PanoramaDaFrota;
  equipamento: Equipamento;
  onVerFrotaInteira: () => void;
}) {
  const tela = TELA_DO_EQUIPAMENTO[equipamento];
  const { resumo } = panorama;

  return (
    <section className="bg-card border rounded-md">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0">
        <div className="px-6 py-5">
          <Rotulo>Remuneração apurada</Rotulo>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            {formatBrlShort(resumo.mensalTotal)}
            <span className="text-base font-normal text-muted-foreground">/mês</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comValorApurado} de {resumo.equipamentos} {tela.plural} com
            valor apurado
          </div>
        </div>

        <div className="px-6 py-5">
          <Rotulo>Contra {panorama.anterior?.periodLabel ?? "a vigência anterior"}</Rotulo>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            <VariacaoMensal
              variacao={
                resumo.variacaoTotal === null
                  ? null
                  : { absoluta: resumo.variacaoTotal, percentual: null }
              }
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {resumo.comAumento} com aumento · {resumo.comReducao} com redução
          </div>
        </div>

        <div className="px-6 py-5">
          <Rotulo>Situação da frota</Rotulo>
          <div className="flex items-center gap-4 mt-2.5 flex-wrap">
            {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((farol) => (
              <span key={farol} className="inline-flex items-center gap-1.5 text-sm">
                <Bolinha farol={farol} />
                <span className="tabular-nums font-semibold">
                  {resumo.porFarol[farol]}
                </span>
                <span className="text-muted-foreground text-xs">
                  {ROTULO_DO_FAROL[farol].toLowerCase()}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 flex flex-col">
          <Rotulo>Ainda sem regra financeira</Rotulo>
          <div className="text-3xl font-bold tabular-nums mt-1 tracking-tight">
            {resumo.componentesSemRegra}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            componentes monetários que a curadoria ainda não confirmou
          </div>
          {/*
            A saída para a leitura de frota. Fica no resumo, e não escondida no
            rodapé: "o que mudou em todos os cavalos" é a outra metade do módulo,
            e continua sendo a pergunta certa para quem confere o mês.
          */}
          <button
            onClick={onVerFrotaInteira}
            className="mt-auto pt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline self-start"
          >
            ver as alterações de todos os {tela.plural}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}

/** O rótulo miúdo que nomeia cada número — o mesmo da Composição. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function BarraDeFiltros({
  busca,
  onBusca,
  status,
  onStatus,
  recortes,
  onRecorte,
  ordem,
  onOrdem,
  resultado,
}: {
  busca: string;
  onBusca: (v: string) => void;
  status: Farol | "";
  onStatus: (f: Farol | "") => void;
  recortes: Record<Recorte, boolean>;
  onRecorte: (chave: Recorte) => void;
  ordem: Ordem;
  onOrdem: (o: Ordem) => void;
  resultado: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          placeholder="Placa ou chassi"
          className="pl-9 w-64"
        />
      </div>

      <Select
        value={status === "" ? "TODOS" : status}
        onValueChange={(v) => onStatus(v === "TODOS" ? "" : (v as Farol))}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TODOS">Todos os status</SelectItem>
          {(["CRITICO", "ATENCAO", "NORMAL", "INCOMPLETO"] as Farol[]).map((f) => (
            <SelectItem key={f} value={f}>
              {ROTULO_DO_FAROL[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {RECORTES.map(({ chave, rotulo }) => (
        <button
          key={chave}
          type="button"
          onClick={() => onRecorte(chave)}
          className={cn(
            "px-3 py-2 text-sm rounded-md border transition-colors",
            recortes[chave]
              ? "border-brand bg-accent text-brand font-medium"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}

      <Select value={ordem} onValueChange={(v) => onOrdem(v as Ordem)}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORDENS.map((o) => (
            <SelectItem key={o.chave} value={o.chave}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-muted-foreground ml-auto tabular-nums">
        {resultado} equipamentos
      </span>
    </div>
  );
}

/**
 * Um ativo, de relance.
 *
 * A hierarquia é a da pergunta: quem é (placa e chassi), de onde e de quando
 * (unidade e vigência), quanto custa e quanto mudou, e por fim o que aconteceu.
 * O farol fica ao lado da placa porque ele é uma ressalva sobre os números
 * abaixo — não um número a mais.
 *
 * `R$ 0,00` e a ausência de conta nunca ocupam o mesmo lugar: o primeiro é um
 * zero que o produto conferiu, o segundo é a falta de uma conta. É a mesma
 * regra da Composição, e é a diferença entre uma frota de graça e uma frota que
 * não sabemos ler.
 *
 * **E a ausência de conta é dita pelo nome dela.** "Não apurado" servia a três
 * situações de donos diferentes — coluna sem semântica confirmada, razão em
 * R$/km sem a produção da placa, célula vazia na vigência — e quem lia o card
 * não tinha como saber se o próximo passo era a curadoria, a Ambev, ou nada.
 * O rótulo vem de `status.naoApuradoPor`, e a frase inteira continua no alerta.
 *
 * O card inteiro é o alvo do clique, e não só o link do rodapé: um card cuja
 * área toda leva ao mesmo lugar não obriga ninguém a mirar.
 */
function CardDoAtivo({
  ativo,
  anterior,
  onAbrir,
}: {
  ativo: AtivoDoPanorama;
  /** O rótulo da vigência com que a variação compara. */
  anterior: string | null;
  onAbrir: (placa: string) => void;
}) {
  /*
    Sem placa não há para onde ir: o nível 2 recorta por placa, e ela é a chave
    das quatro leituras. O card continua na grade — tirá-lo faria a contagem não
    fechar com a da frota —, e diz o que falta em vez de virar um clique morto.
  */
  const abrivel = ativo.placa !== null;

  return (
    <div
      role={abrivel ? "button" : undefined}
      tabIndex={abrivel ? 0 : undefined}
      onClick={() => abrivel && onAbrir(ativo.placa!)}
      onKeyDown={(e) => {
        if (!abrivel) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir(ativo.placa!);
        }
      }}
      title={
        abrivel
          ? `abrir a situação de ${ativo.placa}`
          : "sem placa corrente — não há por onde abrir o ativo"
      }
      className={cn(
        "bg-card border rounded-md flex flex-col transition-colors",
        abrivel && "cursor-pointer hover:border-brand/50",
      )}
    >
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <Bolinha
            farol={ativo.status.farol}
            titulo={
              ativo.status.motivos.length > 0
                ? ativo.status.motivos.join(" ")
                : ROTULO_DO_FAROL[ativo.status.farol]
            }
          />
          <span className="font-semibold font-mono tracking-wide truncate">
            {ativo.placa ?? "sem placa"}
          </span>
        </div>
        <div className="text-[0.6875rem] text-muted-foreground font-mono truncate">
          {ativo.chassi ?? ""}
        </div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-2 truncate">
          {ativo.unidade ?? "—"}
          {ativo.operacao && ` · ${ativo.operacao}`}
        </div>
        <div className="text-xs text-muted-foreground">
          {ativo.periodLabel}
          {!ativo.presente && (
            <span className="text-amber-700"> · saiu da frota</span>
          )}
        </div>
      </div>

      <div className="border-t px-5 py-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Rotulo>Remuneração apurada</Rotulo>
          <div className="mt-0.5">
            {ativo.mensal === null ? (
              <span className="text-muted-foreground text-sm">
                {!ativo.presente
                  ? "fora da vigência"
                  : ativo.status.naoApuradoPor
                    ? ROTULO_DA_NAO_APURACAO[ativo.status.naoApuradoPor]
                    : "não apurado"}
              </span>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-lg">
                  {formatBrl(ativo.mensal)}
                </span>
                <span className="text-muted-foreground text-xs">/mês</span>
              </>
            )}
          </div>
          {ativo.semRegraFinanceira > 0 && (
            <div className="text-[0.6875rem] text-muted-foreground">
              + {ativo.semRegraFinanceira} sem regra financeira
            </div>
          )}
        </div>

        <div className="min-w-0">
          <Rotulo>Variação</Rotulo>
          <div className="mt-0.5 text-sm">
            <VariacaoMensal variacao={ativo.variacao} semSinalNulo />
          </div>
          {anterior && (
            <div className="text-[0.6875rem] text-muted-foreground">vs {anterior}</div>
          )}
        </div>
      </div>

      {/*
        O movimento, separado do dinheiro por uma linha: é outra régua — o que a
        planilha mexeu e o que pedimos por chamado não somam com a remuneração
        nem entre si. A separação é a mesma que as abas de Alterações fazem.
      */}
      <div className="border-t px-5 py-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <Rotulo>O que mudou</Rotulo>
          <div className="mt-0.5 text-sm">
            {ativo.alteracoes === 0 && ativo.chamados === 0 ? (
              <span className="text-muted-foreground">nada nesta vigência</span>
            ) : (
              <span className="text-xs">
                {ativo.alteracoes > 0 && (
                  <>
                    <strong className="tabular-nums">{ativo.alteracoes}</strong>{" "}
                    {ativo.alteracoes === 1 ? "alteração" : "alterações"}
                  </>
                )}
                {ativo.alteracoes > 0 && ativo.chamados > 0 && " · "}
                {ativo.chamados > 0 && (
                  <>
                    <strong className="tabular-nums">{ativo.chamados}</strong>{" "}
                    {ativo.chamados === 1 ? "chamado" : "chamados"}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <Rotulo>Alertas</Rotulo>
          <div className="mt-0.5 text-sm">
            {ativo.status.alertas === 0 ? (
              <span className="text-muted-foreground text-xs">sem alerta</span>
            ) : (
              <span className="text-xs" title={ativo.status.motivos.join("\n")}>
                {ativo.status.alertas}{" "}
                {ativo.status.alertas === 1 ? "alerta" : "alertas"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/*
        A história do ativo em uma linha — o que faz a grade valer mais do que a
        tabela da Composição. "11 alterações" não diz nada; "a amortização caiu
        de R$ 7.700,16 para zero" é o que faz alguém abrir o card certo.
      */}
      <div className="border-t px-5 py-3 mt-auto flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {ativo.maiorAlteracao ? (
            <MaiorAlteracao alteracao={ativo.maiorAlteracao} />
          ) : (
            <span className="text-xs text-muted-foreground">
              sem alteração de planilha no período
            </span>
          )}
        </div>
        {abrivel && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-brand shrink-0">
            Ver situação
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

/** A alteração mais material do ativo, escrita como uma frase. */
function MaiorAlteracao({
  alteracao,
}: {
  alteracao: NonNullable<AtivoDoPanorama["maiorAlteracao"]>;
}) {
  const nome = alteracao.attributeName ?? alteracao.attributeCode ?? "um parâmetro";
  const antes = alteracao.valueBefore;
  const depois = alteracao.valueAfter;

  return (
    <p className="text-xs text-muted-foreground line-clamp-2">
      <strong className="text-foreground font-medium">{nome}</strong>
      {antes !== null && depois !== null ? (
        <>
          {": "}
          <span className="font-mono">{antes}</span>
          {" → "}
          <span className="font-mono">{depois}</span>
        </>
      ) : (
        " mudou"
      )}
      {alteracao.impactAmount !== null && (
        <>
          {" · "}
          <span
            className={cn(
              "font-medium",
              // Vermelho para alta e verde para baixa, como na Composição: esta
              // é uma tela de custo, e um aumento é saída de caixa maior.
              alteracao.impactAmount > 0 ? "text-brand-red" : "text-emerald-600",
            )}
          >
            {alteracao.impactAmount > 0 ? "+" : "−"}
            {formatBrl(Math.abs(alteracao.impactAmount))}
            {alteracao.impactPeriodicity && (
              <span className="opacity-80">
                /{alteracao.impactPeriodicity.toLowerCase()}
              </span>
            )}
          </span>
        </>
      )}
    </p>
  );
}
