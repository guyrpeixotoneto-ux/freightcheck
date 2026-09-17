import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, SlidersHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Paginacao } from "@/components/ui/paginacao";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJsonOrNull, salvarArquivo } from "@/lib/api";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CartoesDaAuditoria,
  PainelDasContas,
  PainelDoAbono,
  PainelDoBenchmark,
} from "@/components/qlp-auditoria/paineis";
import { TabelaDeCargos } from "@/components/qlp-auditoria/tabela";
import {
  FILTROS_VAZIOS,
  ROTULO_DO_QUADRO,
  contagemPorVeredito,
  filtrar,
  linhasDoCsv,
  type AuditoriaDoQuadro as Dados,
  type FiltrosDeQlp,
  type QuadroDeQlp,
} from "@/lib/qlp-auditoria";

/**
 * A AUDITORIA DE UM QUADRO DE QLP — a mesma tela para os dois quadros.
 *
 * ---------------------------------------------------------------------------
 * Um componente, e não duas telas
 * ---------------------------------------------------------------------------
 * O administrativo e o operacional têm colunas diferentes, contas diferentes e
 * até grãos diferentes — um cargo por unidade lá, um cargo por unidade e turno
 * aqui. O que eles têm igual é a **forma da pergunta**: a tabela declara uma
 * conta sobre si mesma, e a conferência diz em quantos cargos ela fecha.
 *
 * Duas telas escritas separadamente seriam duas chances de a mesma leitura ser
 * apresentada de dois jeitos — e a primeira a divergir seria a que ninguém abre,
 * que é a do quadro que ainda não importou arquivo nenhum.
 *
 * Por isso este componente recebe o quadro e se monta: o QLP Administrativo o
 * usa numa aba, e o QLP Operacional é uma página que é quase só ele.
 *
 * ---------------------------------------------------------------------------
 * O que ele não faz
 * ---------------------------------------------------------------------------
 * **Não compara vigências.** Essa pergunta tem dono desde que o QLP
 * Administrativo existe: a aba de Alterações, sobre o motor canônico. Um segundo
 * recorte comparativo aqui seria a mesma resposta em dois lugares, livre para
 * divergir.
 *
 * **Não soma dinheiro.** Os atributos do QLP chegam sem semântica confirmada, e
 * agregar sem curadoria seria adivinhação — é o portão que a aba do quadro já
 * aplica. O que esta tela faz sem curadoria nenhuma é conferir a multiplicação
 * que a própria planilha declara: aritmética não depende de semântica.
 */
export function AuditoriaDoQuadro({
  quadro,
  query,
  rotuloDaVigencia,
}: {
  quadro: QuadroDeQlp;
  /** Os parâmetros de contexto da tela — vigência, unidade, canal. */
  query: URLSearchParams;
  /** Como a vigência aberta se chama, para o nome do arquivo exportado. */
  rotuloDaVigencia?: string;
}) {
  const [filtros, setFiltros] = useState<FiltrosDeQlp>(FILTROS_VAZIOS);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);

  const parametros = useMemo(() => {
    const q = new URLSearchParams(query);
    q.set("quadro", quadro);
    return q.toString();
  }, [query, quadro]);

  /*
    404 aqui não é defeito: é "nenhuma vigência deste quadro importada ainda", e
    esse estado tem tela própria — o mesmo desenho da aba do quadro e de
    Cobertura de dados. No operacional ele é a resposta esperada até o primeiro
    export chegar.
  */
  const auditoria = useQuery({
    queryKey: ["qlp", "auditoria", parametros],
    queryFn: () => fetchJsonOrNull<Dados>(`/qlp/auditoria?${parametros}`),
    retry: false,
  });

  const linhas = useMemo(() => auditoria.data?.linhas ?? [], [auditoria.data]);
  const filtradas = useMemo(() => filtrar(linhas, filtros), [linhas, filtros]);
  const contagens = useMemo(
    () => contagemPorVeredito(linhas, { ...filtros, veredito: "TODOS" }),
    [linhas, filtros],
  );
  const naPagina = useMemo(
    () => filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [filtradas, pagina, porPagina],
  );

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => setPagina(1), [filtros, parametros]);

  function exportar() {
    const blob = csvComoBlob(linhasDoCsv(filtradas, quadro));
    const nome = paraNomeDeArquivo(rotuloDaVigencia ?? "vigencia");
    salvarArquivo(blob, `qlp-${quadro.toLowerCase()}-contas-${nome}.csv`);
  }

  if (auditoria.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (auditoria.error) {
    return (
      <ApiErrorNotice
        error={auditoria.error}
        what={`a auditoria do ${ROTULO_DO_QUADRO[quadro]}`}
        onTentarDeNovo={() => void auditoria.refetch()}
        tentando={auditoria.isFetching}
      />
    );
  }

  if (!auditoria.data) {
    return (
      <EstadoVazio
        icone={Users}
        titulo={`Nenhuma vigência de ${ROTULO_DO_QUADRO[quadro]} importada ainda`}
        descricao={
          quadro === "OPERACIONAL"
            ? "A importação já sabe receber este quadro — o tipo QLP_OPERACIONAL existe, com o grão de unidade, cargo e turno. O que falta é o primeiro arquivo: enquanto ele não chega, esta tela não tem o que conferir, e dizer isso é mais honesto do que mostrar um quadro vazio."
            : "Importe o export do QLP Administrativo para que as contas do quadro possam ser conferidas."
        }
      />
    );
  }

  const dados = auditoria.data;

  return (
    <div className="flex flex-col gap-4">
      <CartoesDaAuditoria dados={dados} />

      {dados.colunasDesconhecidas.length > 0 && (
        /*
          Uma coluna que o dicionário não conhece não é uma coluna vazia: é uma
          conta que esta tela não pôde conferir, e dizer quais são é o que
          permite a alguém consertar a origem em vez de desconfiar do resultado.
        */
        <p className="text-xs text-muted-foreground">
          {formatNumber(dados.colunasDesconhecidas.length, 0)}{" "}
          {dados.colunasDesconhecidas.length === 1
            ? "coluna pedida não existe no dicionário deste quadro"
            : "colunas pedidas não existem no dicionário deste quadro"}
          , e as contas que dependem delas ficam sem base:{" "}
          <span className="font-mono">{dados.colunasDesconhecidas.join(", ")}</span>.
        </p>
      )}

      <PainelDasContas
        contas={dados.contas}
        contaAberta={filtros.conta}
        onConta={(conta) => setFiltros((f) => ({ ...f, conta }))}
      />

      {dados.benchmark && <PainelDoBenchmark benchmark={dados.benchmark} />}
      {dados.abono && <PainelDoAbono abono={dados.abono} />}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b">
        {(
          [
            { chave: "TODOS", rotulo: "Todos os cargos" },
            { chave: "DIVERGE", rotulo: "Com conta que não fecha" },
            { chave: "CONFERE", rotulo: "Com as contas fechando" },
            { chave: "BASE_INSUFICIENTE", rotulo: "Sem base" },
          ] as const
        ).map((aba) => (
          <button
            key={aba.chave}
            type="button"
            role="tab"
            aria-selected={filtros.veredito === aba.chave}
            onClick={() => setFiltros((f) => ({ ...f, veredito: aba.chave }))}
            className={cn(
              "border-b-2 py-2 text-sm font-semibold",
              filtros.veredito === aba.chave
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {aba.rotulo} ({formatNumber(contagens[aba.chave] ?? 0, 0)})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[13rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={`qlp-auditoria-busca-${quadro}`}
            value={filtros.busca}
            onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
            placeholder="Buscar cargo…"
            aria-label="Buscar cargo"
            className="pl-9"
          />
        </div>

        {filtros.conta !== "TODAS" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltros((f) => ({ ...f, conta: "TODAS" }))}
          >
            Limpar o filtro de conta
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={exportar}
          disabled={filtradas.length === 0}
          className="ml-auto gap-2"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Exportar CSV
        </Button>
      </div>

      {filtradas.length === 0 ? (
        linhas.length === 0 ? (
          <EstadoVazio
            icone={Users}
            titulo="Esta vigência não trouxe cargo nenhum"
            descricao={
              dados.serieEntregue
                ? "A vigência existe, mas nenhuma linha deste quadro chegou nela."
                : "Esta vigência não entregou o arquivo deste quadro — o que falta é a importação, e não o cartão."
            }
          />
        ) : (
          <EstadoVazio
            icone={SlidersHorizontal}
            titulo="Nenhum cargo para este filtro"
            descricao="O recorte atual não tem nenhum cargo. Limpe os filtros para ver os demais."
            acao={
              <Button
                type="button"
                variant="outline"
                onClick={() => setFiltros(FILTROS_VAZIOS)}
              >
                Limpar filtros
              </Button>
            }
          />
        )
      ) : (
        <>
          <TabelaDeCargos linhas={naPagina} quadro={quadro} />
          <Paginacao
            pagina={pagina}
            porPagina={porPagina}
            total={filtradas.length}
            onPagina={setPagina}
            onPorPagina={setPorPagina}
            tamanhos={[50, 100, 300]}
            unidade="cargos"
            unidadeSingular="cargo"
          />
        </>
      )}
    </div>
  );
}
