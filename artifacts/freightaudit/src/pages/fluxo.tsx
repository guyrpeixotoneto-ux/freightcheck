import { useCallback, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CanvasDoFluxo } from "@/components/fluxos/canvas";
import { EditorDaEtapa } from "@/components/fluxos/editor-da-etapa";
import { EditorDoFluxo } from "@/components/fluxos/editor-do-fluxo";
import { PainelDaEtapa } from "@/components/fluxos/painel-da-etapa";
import { useEmpresaDosFluxos } from "@/components/fluxos/seletor-de-empresa";
import {
  escritas,
  fraseDoErro,
  resumoDoFluxo,
  useCatalogoDeFluxos,
  useFluxo,
  useRecarregarFluxos,
  type Conexao,
} from "@/lib/fluxos";

/**
 * A TELA DO FLUXO — o fluxograma como elemento principal.
 *
 * O desenho ocupa a tela. O cabeçalho é uma faixa fina com o nome, o status e o
 * que ele é ("16 etapas · 20 conexões · com retorno"); o detalhe de uma etapa
 * aparece numa coluna à direita quando alguém clica num cartão, sem tapar o
 * fluxo. É a regra de UX do pedido, aplicada: o fluxo é o principal, o resto
 * aparece sob demanda.
 *
 * ---------------------------------------------------------------------------
 * Dois modos, e o segundo já tem lugar reservado
 * ---------------------------------------------------------------------------
 *
 * O seletor do cabeçalho oferece hoje **Processo** — como o processo funciona —
 * e nomeia o que virá: **Monitoramento**, com o farol por etapa e os números
 * reais. A opção existe desabilitada, e isso é deliberado: o lugar dela na
 * interface está decidido, e nada foi implementado por antecipação. Ligar o
 * modo, quando houver coletor, é preencher `data` do nó com o farol — o cartão,
 * o painel e o canvas não mudam.
 *
 * ---------------------------------------------------------------------------
 * Editar é o estado normal, não uma tela à parte
 * ---------------------------------------------------------------------------
 *
 * Não há "tela de edição" separada do visualizador: é o mesmo canvas, com o
 * arrastar e o ligar ligados. Duas telas fariam quem cadastra alternar entre
 * elas para ver o que fez. O que existe é um interruptor de leitura, para quem
 * só quer consultar sem risco de mover um cartão sem querer.
 */
export default function TelaDoFluxo() {
  const [, params] = useRoute("/fluxos/:id");
  const fluxoId = params?.id ?? "";

  const { empresaId } = useEmpresaDosFluxos();
  const catalogo = useCatalogoDeFluxos();
  const consulta = useFluxo(empresaId, fluxoId);
  const recarregar = useRecarregarFluxos(empresaId);

  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [editandoEtapa, setEditandoEtapa] = useState<{ aberto: boolean; etapaId: string | null }>({
    aberto: false,
    etapaId: null,
  });
  const [editandoFluxo, setEditandoFluxo] = useState(false);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [conexaoAberta, setConexaoAberta] = useState<Conexao | null>(null);

  const completo = consulta.data;
  const etapaSelecionada = useMemo(
    () => completo?.etapas.find((e) => e.id === selecionada) ?? null,
    [completo, selecionada],
  );

  const mover = useMutation({
    mutationFn: (posicoes: { etapaId: string; posX: number; posY: number }[]) =>
      escritas.salvarPosicoes(empresaId, fluxoId, posicoes),
    onSuccess: () => recarregar(fluxoId),
  });

  const conectar = useMutation({
    mutationFn: (ligacao: { origemEtapaId: string; destinoEtapaId: string }) =>
      escritas.criarConexao(empresaId, fluxoId, ligacao),
    onSuccess: () => recarregar(fluxoId),
  });

  const excluirEtapa = useMutation({
    mutationFn: (etapaId: string) => escritas.excluirEtapa(empresaId, fluxoId, etapaId),
    onSuccess: () => {
      setSelecionada(null);
      recarregar(fluxoId);
    },
  });

  const aoMover = useCallback(
    (posicoes: { etapaId: string; posX: number; posY: number }[]) => mover.mutate(posicoes),
    [mover],
  );
  const aoConectar = useCallback(
    (origemEtapaId: string, destinoEtapaId: string) =>
      conectar.mutate({ origemEtapaId, destinoEtapaId }),
    [conectar],
  );
  const aoAbrirConexao = useCallback(
    (conexaoId: string) => {
      const conexao = completo?.conexoes.find((c) => c.id === conexaoId) ?? null;
      setConexaoAberta(conexao);
    },
    [completo],
  );

  if (consulta.isError) {
    return (
      <Layout>
        <main className="px-8 py-6">
          <ApiErrorNotice error={consulta.error} what="este fluxo operacional" />
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="border-b bg-card px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Voltar para a lista de fluxos">
            <Link href="/fluxos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1">
            {consulta.isLoading ? (
              <Skeleton className="h-6 w-64" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-foreground">
                    {completo?.fluxo.nome}
                  </h1>
                  <Badge variant="outline" className="font-normal">
                    {completo?.fluxo.categoria}
                  </Badge>
                  {completo?.fluxo.status !== "ATIVO" && (
                    <Badge variant="secondary" className="font-normal">
                      {completo?.fluxo.status === "RASCUNHO" ? "Rascunho" : "Arquivado"}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {completo ? resumoDoFluxo(completo) : null}
                  {completo?.fluxo.dono ? ` · ${completo.fluxo.dono}` : ""}
                </p>
              </>
            )}
          </div>

          <Select value="processo" onValueChange={() => undefined}>
            <SelectTrigger className="w-[190px]" aria-label="Modo de leitura">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="processo">Modo Processo</SelectItem>
              {/*
                Desabilitado, e presente. O lugar do Modo Monitoramento na
                interface está decidido; ligar o farol depende de um coletor de
                métricas que ainda não existe, e um seletor que trocasse para
                uma tela vazia seria pior do que um que diz "ainda não".
              */}
              <SelectItem value="monitoramento" disabled>
                Modo Monitoramento (em breve)
              </SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" onClick={() => setSomenteLeitura((v) => !v)}>
            {somenteLeitura ? "Liberar edição" : "Só leitura"}
          </Button>

          <Button variant="outline" size="sm" onClick={() => setEditandoFluxo(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar fluxo
          </Button>

          <Button
            size="sm"
            disabled={somenteLeitura}
            onClick={() => setEditandoEtapa({ aberto: true, etapaId: null })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova etapa
          </Button>
        </div>

        {(mover.isError || conectar.isError || excluirEtapa.isError) && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              {fraseDoErro(mover.error ?? conectar.error ?? excluirEtapa.error)}
            </AlertDescription>
          </Alert>
        )}
      </header>

      {/*
        Altura fixa em unidades de janela, e não `flex-1` dentro do Layout: o
        canvas precisa de uma altura concreta para calcular o enquadramento, e
        um contêiner que se resolve em zero deixa o fluxograma invisível — o
        defeito mais comum de quem monta um canvas dentro de layout flexível.
      */}
      <div className="flex h-[calc(100vh-8.5rem)] w-full">
        <div className="relative min-w-0 flex-1">
          {consulta.isLoading && <Skeleton className="h-full w-full" />}
          {completo && completo.etapas.length === 0 && (
            <FluxoSemEtapas
              aoCriar={() => setEditandoEtapa({ aberto: true, etapaId: null })}
              bloqueado={somenteLeitura}
            />
          )}
          {completo && completo.etapas.length > 0 && (
            <CanvasDoFluxo
              completo={completo}
              catalogo={catalogo.data}
              etapaSelecionada={selecionada}
              onSelecionarEtapa={setSelecionada}
              somenteLeitura={somenteLeitura}
              onMoverEtapas={aoMover}
              onConectar={aoConectar}
              onAbrirConexao={aoAbrirConexao}
            />
          )}
          {mover.isPending && (
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow">
              <Loader2 className="h-3 w-3 animate-spin" />
              salvando posição
            </div>
          )}
        </div>

        {etapaSelecionada && (
          <div className="w-[380px] shrink-0">
            <PainelDaEtapa
              etapa={etapaSelecionada}
              catalogo={catalogo.data}
              podeEditar={!somenteLeitura}
              onEditar={() =>
                setEditandoEtapa({ aberto: true, etapaId: etapaSelecionada.id })
              }
              onExcluir={() => excluirEtapa.mutate(etapaSelecionada.id)}
              onFechar={() => setSelecionada(null)}
            />
          </div>
        )}
      </div>

      {/*
        O editor só monta com o catálogo em mãos, e não é detalhe: as listas de
        material são derivadas das espécies do catálogo dentro de um
        `useState` inicial, que roda uma vez. Montar antes de ele chegar
        produziria um formulário sem as cinco listas — e sem erro nenhum na
        tela, que é a pior forma.
      */}
      {editandoEtapa.aberto && completo && catalogo.data && (
        <EditorDaEtapa
          /*
            A chave inclui a etapa: sem ela, abrir o editor de uma etapa logo
            depois de fechar o de outra reaproveitaria o estado do formulário
            anterior — o React mantém o componente montado e os `useState`
            iniciais não voltam a rodar.
          */
          key={editandoEtapa.etapaId ?? "nova"}
          aberto
          etapa={completo.etapas.find((e) => e.id === editandoEtapa.etapaId) ?? null}
          fluxoId={fluxoId}
          empresaId={empresaId}
          catalogo={catalogo.data}
          aoFechar={() => setEditandoEtapa({ aberto: false, etapaId: null })}
          aoSalvar={() => recarregar(fluxoId)}
        />
      )}

      {editandoFluxo && completo && catalogo.data && (
        <EditorDoFluxo
          aberto
          fluxo={completo.fluxo}
          empresaId={empresaId}
          catalogo={catalogo.data}
          categoriasConhecidas={[completo.fluxo.categoria]}
          aoFechar={() => setEditandoFluxo(false)}
          aoSalvar={() => recarregar(fluxoId)}
        />
      )}

      {conexaoAberta && completo && (
        <EditorDaConexao
          conexao={conexaoAberta}
          empresaId={empresaId}
          fluxoId={fluxoId}
          catalogo={catalogo.data}
          aoFechar={() => setConexaoAberta(null)}
          aoSalvar={() => recarregar(fluxoId)}
        />
      )}
    </Layout>
  );
}

function FluxoSemEtapas({ aoCriar, bloqueado }: { aoCriar: () => void; bloqueado: boolean }) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/20">
      <div className="max-w-sm text-center">
        <Wand2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium text-foreground">Este fluxo ainda não tem etapas.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie a primeira etapa e depois ligue uma na outra arrastando das bordas dos cartões.
        </p>
        <Button className="mt-4" onClick={aoCriar} disabled={bloqueado}>
          <Plus className="mr-1.5 h-4 w-4" />
          Criar a primeira etapa
        </Button>
      </div>
    </div>
  );
}

/**
 * A seta clicada — trocar o tipo, escrever a condição, ou remover.
 *
 * É um painel pequeno e não um diálogo cheio, porque uma conexão guarda três
 * coisas. O tipo é o que dá sentido ao desenho: a mesma seta entre as mesmas
 * etapas significa coisas diferentes conforme seja "decisão — não" ou
 * "retrabalho", e é aqui que isso é dito.
 */
function EditorDaConexao({
  conexao,
  empresaId,
  fluxoId,
  catalogo,
  aoFechar,
  aoSalvar,
}: {
  conexao: Conexao;
  empresaId: string | null;
  fluxoId: string;
  catalogo: ReturnType<typeof useCatalogoDeFluxos>["data"];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [tipo, setTipo] = useState(conexao.tipo);
  const [rotulo, setRotulo] = useState(conexao.rotulo ?? "");

  const salvar = useMutation({
    mutationFn: () =>
      escritas.atualizarConexao(empresaId, fluxoId, conexao.id, {
        origemEtapaId: conexao.origemEtapaId,
        destinoEtapaId: conexao.destinoEtapaId,
        tipo,
        rotulo,
        ordem: conexao.ordem,
      }),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });

  const remover = useMutation({
    mutationFn: () => escritas.excluirConexao(empresaId, fluxoId, conexao.id),
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });

  return (
    <div className="fixed bottom-6 left-1/2 z-40 w-[420px] -translate-x-1/2 rounded-lg border bg-card p-4 shadow-lg">
      <p className="mb-3 text-sm font-medium text-foreground">Conexão</p>

      <div className="space-y-3">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger aria-label="Tipo da conexão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(catalogo?.tiposDeConexao ?? []).map((t) => (
              <SelectItem key={t.valor} value={t.valor}>
                {t.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          placeholder="Condição — “se rejeitado”"
          aria-label="Condição da conexão"
        />
      </div>

      {(salvar.isError || remover.isError) && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{fraseDoErro(salvar.error ?? remover.error)}</AlertDescription>
        </Alert>
      )}

      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => remover.mutate()}
          disabled={remover.isPending}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Remover
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
