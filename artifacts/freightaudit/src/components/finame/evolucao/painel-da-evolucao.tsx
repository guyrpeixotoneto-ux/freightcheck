import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { CODIGOS_DA_TABELA, codigosDoRecorte } from "@workspace/comparison/finame";
import { ApiErrorNotice } from "@/components/api-error";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "@/components/comparacao/recorte-de-equipamento";
import { MatrizDaEvolucao } from "@/components/evolucao-por-placa/matriz";
import { PainelDaPlaca } from "@/components/evolucao-por-placa/painel-da-placa";
import { CartoesDaEvolucaoDeFiname } from "@/components/finame/evolucao/cartoes";
import {
  opcoesDaEvolucao,
  type FiltroDaEvolucao,
  type OrdemDaEvolucao,
} from "@/lib/evolucao-por-placa";
import type { PontaAPonta } from "@/lib/analise";
import { fetchJsonOrNull } from "@/lib/api";
import { anosDasVigencias, pontasDoAno } from "@/lib/finame";
import { periodicityAdjective } from "@/lib/format";

/**
 * A EVOLUÇÃO ANUAL DO FINAME — a matriz veículo × vigência, recortada.
 *
 * ---------------------------------------------------------------------------
 * Não há matriz nova aqui
 * ---------------------------------------------------------------------------
 * Esta tela é `evolucaoPorPlaca` com `parameters = CODIGOS_DA_TABELA`, desenhada
 * por `MatrizDaEvolucao`, com o painel lateral de `PainelDaPlaca`. Uma segunda
 * matriz — mesmo que idêntica no dia em que fosse escrita — seria a quinta
 * resposta do produto para "qual foi o impacto?", e `deduplicacao.ts` documenta
 * no cabeçalho quanto custaram as quatro primeiras.
 *
 * O recorte é aplicado **no domínio**, e nunca aqui: `parameters` viaja na
 * consulta, e o servidor o aplica depois de a janela montar o índice de dupla
 * contagem. Filtrar a resposta na tela devolveria os mesmos veículos com o
 * dinheiro errado — ver `parameters`, em `OpcoesDaEvolucao`.
 *
 * ---------------------------------------------------------------------------
 * O seletor de equipamento de dentro
 * ---------------------------------------------------------------------------
 * A aba Evolução ocupa, na fileira de cima, o lugar de um recorte — então ela
 * repõe o recorte aqui dentro. Ele **não herda** o da comparação e abre sempre
 * em Cavalo + Carreta: são duas perguntas feitas em momentos diferentes, e
 * herdar faria a evolução abrir em Carreta sem ninguém ter pedido.
 *
 * E ele recarrega em vez de esconder: vira `tipo` na consulta da matriz e lista
 * de códigos na da ponta a ponta. Esconder linha na tela deixaria a matriz de
 * Cavalo sob cartões de Cavalo + Carreta — o número de um recorte sob o título
 * de outro, que é o defeito que `RecorteDeEquipamento` existe para ter
 * corrigido.
 *
 * ---------------------------------------------------------------------------
 * O ano é atalho, e não eixo
 * ---------------------------------------------------------------------------
 * `pontasDoAno` traduz "2026" no par `from`/`to` que o motor já entende, com
 * `from` na última vigência **anterior** ao ano — a ponta de partida não entra
 * na soma, e usá-la dentro do ano jogaria fora a transição dezembro→janeiro.
 * As colunas continuam sendo as vigências que existem: quinzenas viram duas
 * colunas, e vigência sem comparação vira lacuna nomeada.
 */
export function PainelDaEvolucaoDeFiname({
  consulta,
  datas,
  recorte,
  onRecorte,
  ano,
  onAno,
  disponiveis,
}: {
  /** `scopeHash` e `canal` da unidade aberta — o contexto, intacto. */
  consulta: URLSearchParams;
  /** As vigências de equipamento da unidade, de onde saem os anos. */
  datas: readonly string[];
  recorte: RecorteDeTipo;
  onRecorte: (r: RecorteDeTipo) => void;
  ano: string | null;
  onAno: (ano: string) => void;
  disponiveis: Record<RecorteDeTipo, boolean>;
}) {
  const [periodicidade, setPeriodicidade] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDaEvolucao>("todos");
  const [ordem, setOrdem] = useState<OrdemDaEvolucao>("prioridade");
  const [busca, setBusca] = useState("");
  const [placa, setPlaca] = useState<string | null>(null);

  const anos = useMemo(() => anosDasVigencias(datas), [datas]);
  /* Sem ano escolhido, o mais recente do acervo — nunca o ano do relógio, que
     pode não ter vigência nenhuma importada. */
  const anoAberto = ano && anos.includes(ano) ? ano : (anos[0] ?? null);
  const pontas = useMemo(
    () => (anoAberto ? pontasDoAno(anoAberto, datas) : null),
    [anoAberto, datas],
  );

  /* `TODOS` não vira `tipo` na consulta: parâmetro ausente é o acervo inteiro. */
  const tipo = recorte === "TODOS" ? null : recorte;

  const evolucao = useQuery({
    ...opcoesDaEvolucao(consulta, pontas?.de ?? null, pontas?.ate ?? null, tipo, periodicidade, null, {
      parameters: CODIGOS_DA_TABELA,
    }),
    enabled: pontas !== null,
  });

  /*
    A ponta a ponta carrega junto, e não sob demanda: ela é o segundo cartão, e
    um cartão que só aparecesse depois de um clique deixaria a tela abrindo com
    a metade da resposta. `getEndToEndAnalysis` não aceita `tipo` — só uma lista
    de atributos —, e é por isso que `codigosDoRecorte` existe: recortar pelos
    códigos de um equipamento é o mesmo conjunto de linhas que recortar pelo
    `entity_type` dele, porque cada variável tem um código por lado.
  */
  const consultaDaPonta = useMemo(() => {
    const q = new URLSearchParams(consulta);
    if (pontas) {
      q.set("from", pontas.de);
      q.set("to", pontas.ate);
    }
    /* `attributeCodes`, e não `parameters`: a ponta a ponta recorta por coluna
       quando recebe este, e por FAMÍLIA|parâmetro quando recebe aquele — e o
       segundo não separa cavalo de carreta. Ver `attributeCodes`, em
       `getEndToEndAnalysis`. */
    q.set("attributeCodes", codigosDoRecorte(recorte).join(","));
    return q;
  }, [consulta, pontas, recorte]);

  const ponta = useQuery({
    queryKey: ["finame-ponta-a-ponta", consultaDaPonta.toString()],
    queryFn: () => fetchJsonOrNull<PontaAPonta>(`/changes/end-to-end?${consultaDaPonta}`),
    enabled: pontas !== null,
    staleTime: 60_000,
  });

  const dados = evolucao.data ?? null;
  const aberta = useMemo(
    () => dados?.ativos.find((a) => a.entityId === placa) ?? null,
    [dados, placa],
  );

  if (anos.length === 0) {
    return (
      <EstadoVazio
        icone={Banknote}
        titulo="Esta unidade não tem vigência importada"
        descricao="A evolução anual lê as vigências da unidade aberta. Escolha outra unidade na lateral ou importe a primeira vigência."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---- o recorte de dentro, e os filtros do ano -------------------- */}
      <div className="flex flex-col gap-3 rounded-xl border border-l-[3px] border-l-brand bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Esta evolução mostra
          </span>
          <RecorteDeEquipamento
            valor={recorte}
            onValor={onRecorte}
            disponiveis={disponiveis}
            idPrefixo="finame-evolucao"
          />
          <p className="max-w-[46ch] text-xs text-muted-foreground">
            Recorta cartões, matriz, impactos, veículos e painel — recarregando do servidor,
            nunca escondendo linha na tela.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[130px] flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Ano
            </span>
            <Select value={anoAberto ?? undefined} onValueChange={onAno}>
              <SelectTrigger id="finame-evolucao-ano" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anos.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {dados && dados.periodicidades.length > 1 && (
            <label className="flex min-w-[170px] flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Periodicidade
              </span>
              <Select
                value={dados.periodicidade}
                onValueChange={(v) => setPeriodicidade(v)}
              >
                <SelectTrigger id="finame-evolucao-periodicidade" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dados.periodicidades.map((p) => (
                    <SelectItem key={p.periodicity} value={p.periodicity}>
                      {periodicityAdjective(p.periodicity)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {pontas && (
            <p className="pb-2 text-xs text-muted-foreground">
              Parte de <b className="text-foreground">{pontas.de}</b>, que é referência e não
              entra na soma — assim a transição para janeiro não se perde.
            </p>
          )}
        </div>
      </div>

      {evolucao.isLoading && (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      )}

      {evolucao.error && (
        <ApiErrorNotice
          error={evolucao.error}
          what="a evolução anual do FINAME"
          onTentarDeNovo={() => void evolucao.refetch()}
          tentando={evolucao.isFetching}
        />
      )}

      {dados && dados.totais.alteracoes === 0 && (
        <EstadoVazio
          icone={Banknote}
          titulo={`Nenhuma variável de FINAME se moveu em ${anoAberto}`}
          descricao={`As ${dados.colunas.length} vigências comparadas deste recorte têm o mesmo financiamento em todos os veículos. Troque o ano ou o equipamento.`}
        />
      )}

      {dados && dados.totais.alteracoes > 0 && (
        <>
          <CartoesDaEvolucaoDeFiname
            evolucao={dados}
            ponta={ponta.data ?? null}
            carregandoPonta={ponta.isLoading}
          />

          {/* As lacunas são nomeadas, e não uma coluna de zeros: uma vigência
              importada sem comparação não é "nada mudou". */}
          {dados.gaps.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {dados.gaps.map((g) => g.label).join(", ")}{" "}
              {dados.gaps.length === 1 ? "está importada" : "estão importadas"} sem comparação
              calculada. O que houve ali não está somado — e não está contado como zero.
            </p>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <MatrizDaEvolucao
              evolucao={dados}
              filtro={filtro}
              ordem={ordem}
              busca={busca}
              insight={null}
              selecionada={placa}
              onFiltro={setFiltro}
              onOrdem={setOrdem}
              onBusca={setBusca}
              onLimparInsight={() => undefined}
              onEscolherPlaca={(id) => setPlaca((atual) => (atual === id ? null : id))}
            />
            {aberta && (
              <PainelDaPlaca
                ativo={aberta}
                evolucao={dados}
                onFechar={() => setPlaca(null)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
