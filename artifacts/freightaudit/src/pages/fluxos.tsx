import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Copy,
  ListPlus,
  Pencil,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorDoFluxo } from "@/components/fluxos/editor-do-fluxo";
import { MontadorPorTexto } from "@/components/fluxos/montador-por-texto";
import { useEmpresaDosFluxos } from "@/components/fluxos/seletor-de-empresa";
import {
  categoriasDaLista,
  comoData,
  escritas,
  filtrarFluxos,
  useCatalogoDeFluxos,
  useFluxos,
  useRecarregarFluxos,
  type FluxoNaLista,
} from "@/lib/fluxos";

/**
 * ADMINISTRAÇÃO → FLUXOS OPERACIONAIS — a lista.
 *
 * O mapa dos processos da empresa. Cada linha é um processo ponta a ponta:
 * "Emissão de CTe até Recebimento", "NF até pagamento", "Conciliação bancária".
 * Clicar abre o fluxograma.
 *
 * A tela mostra o que decide se vale abrir — nome, categoria, resumo, status,
 * versão, tamanho, dono e quando mudou pela última vez — e nada além. O que
 * cada etapa guarda mora lá dentro, e trazer amostra disso para cá encheria a
 * lista de informação que ninguém consegue comparar entre linhas.
 *
 * **Não há seletor na barra.** Nem de unidade (é cadastro, e é resolvida
 * sozinha por `useEmpresaDosFluxos`) nem de categoria: com poucos processos
 * mapeados, um seletor de categoria é um clique a mais para esconder uma lista
 * que cabe inteira na tela. A busca já acha por categoria — "financeiro"
 * digitado ali faz o mesmo recorte. Quando a lista crescer, o seletor volta.
 *
 * **Arquivados ficam fora por padrão**, com um interruptor para trazê-los. Um
 * processo arquivado continua explicando o que a empresa fazia até ontem — some
 * da fila, não do acervo.
 */
export default function Fluxos() {
  const { empresaId, semEmpresaCadastrada } = useEmpresaDosFluxos();
  const [, navegar] = useLocation();

  const [busca, setBusca] = useState("");
  const [incluirArquivados, setIncluirArquivados] = useState(false);
  const [criando, setCriando] = useState(false);
  const [colando, setColando] = useState(false);

  const catalogo = useCatalogoDeFluxos();
  const consulta = useFluxos(empresaId, incluirArquivados);
  const recarregar = useRecarregarFluxos(empresaId);

  const fluxos = useMemo(() => consulta.data?.fluxos ?? [], [consulta.data]);
  const categorias = useMemo(() => categoriasDaLista(fluxos), [fluxos]);
  const visiveis = useMemo(() => filtrarFluxos(fluxos, { busca }), [fluxos, busca]);

  const doModelo = useMutation({
    mutationFn: (modelo: string) => escritas.criarDeModelo(empresaId, modelo),
    onSuccess: () => recarregar(),
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Workflow className="h-6 w-6 text-muted-foreground" />
              Fluxos Operacionais
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              O mapa dos processos da empresa: como cada um funciona, quem participa, que sistemas e
              documentos entram, onde costuma falhar — e onde consultar cada ponto aqui dentro.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/*
              Duas portas, e a diferença entre elas é o que a pessoa tem em mãos.
              "Novo fluxo" é o cabeçalho vazio, para quem vai desenhar
              descobrindo. "Montar por texto" é para quem sai de uma reunião com
              a lista de etapas pronta — e era o caminho que faltava: sem ele,
              treze etapas levantadas viravam treze formulários.
            */}
            <Button
              variant="outline"
              onClick={() => setColando(true)}
              disabled={empresaId === null}
            >
              <ListPlus className="mr-1.5 h-4 w-4" />
              Montar por texto
            </Button>
            <Button
              onClick={() => setCriando(true)}
              disabled={empresaId === null}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Novo fluxo
            </Button>
          </div>
        </div>
      </header>

      <main className="px-8 py-6">
        {semEmpresaCadastrada && (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma empresa cadastrada ainda. Um fluxo pertence a uma empresa — cadastre a
                unidade primeiro.
              </p>
              <Button variant="outline" className="mt-4" asChild>
                <Link href="/unidades">Ir para Unidades</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {consulta.isError && <ApiErrorNotice error={consulta.error} what="a lista de fluxos operacionais" />}

        {empresaId !== null && !consulta.isError && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Procurar por nome, categoria ou dono"
                  aria-label="Procurar fluxo"
                />
              </div>

              <Button
                variant={incluirArquivados ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setIncluirArquivados((v) => !v)}
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                {incluirArquivados ? "Mostrando arquivados" : "Mostrar arquivados"}
              </Button>
            </div>

            {consulta.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}

            {!consulta.isLoading && visiveis.length === 0 && (
              <ListaVazia
                temFluxos={fluxos.length > 0}
                modelos={catalogo.data?.modelos ?? []}
                aoUsarModelo={(slug) => doModelo.mutate(slug)}
                aoMontarPorTexto={() => setColando(true)}
                usando={doModelo.isPending}
              />
            )}

            <div className="space-y-2">
              {visiveis.map((fluxo) => (
                <LinhaDoFluxo
                  key={fluxo.id}
                  fluxo={fluxo}
                  empresaId={empresaId}
                  aoMudar={() => recarregar(fluxo.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {colando && (
        <MontadorPorTexto
          empresaId={empresaId}
          fluxoId={null}
          categoriasConhecidas={categorias}
          aoFechar={() => setColando(false)}
          aoConcluir={() => recarregar()}
        />
      )}

      {criando && catalogo.data && (
        <EditorDoFluxo
          aberto
          fluxo={null}
          empresaId={empresaId}
          catalogo={catalogo.data}
          categoriasConhecidas={categorias}
          aoFechar={() => setCriando(false)}
          /*
            Criar um fluxo e continuar na lista era o passo que faltava: o que
            se quer depois de dar nome ao processo é cadastrar as etapas dele,
            e não procurar a linha recém-criada no meio das outras. O fluxo novo
            abre direto — e abre na Lista, porque é lá que as etapas nascem
            (ver o efeito de sugestão em `pages/fluxo.tsx`).
          */
          aoSalvar={(gravado) => {
            recarregar();
            navegar(`/fluxos/${gravado.id}`);
          }}
        />
      )}
    </Layout>
  );
}

const CLASSE_DO_STATUS: Record<string, string> = {
  ATIVO: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  RASCUNHO: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ARQUIVADO: "bg-muted text-muted-foreground",
};

function LinhaDoFluxo({
  fluxo,
  empresaId,
  aoMudar,
}: {
  fluxo: FluxoNaLista;
  empresaId: string | null;
  aoMudar: () => void;
}) {
  const arquivar = useMutation({
    mutationFn: () =>
      fluxo.status === "ARQUIVADO"
        ? escritas.desarquivar(empresaId, fluxo.id)
        : escritas.arquivar(empresaId, fluxo.id),
    onSuccess: aoMudar,
  });
  const duplicar = useMutation({
    mutationFn: () => escritas.duplicar(empresaId, fluxo.id, `${fluxo.nome} (cópia)`),
    onSuccess: aoMudar,
  });

  return (
    <Card className={fluxo.status === "ARQUIVADO" ? "opacity-70" : undefined}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/fluxos/${fluxo.id}`}
              className="text-base font-medium text-foreground hover:underline"
            >
              {fluxo.nome}
            </Link>
            <Badge variant="outline" className="font-normal">
              {fluxo.categoria}
            </Badge>
            <Badge variant="secondary" className={`font-normal ${CLASSE_DO_STATUS[fluxo.status] ?? ""}`}>
              {fluxo.status === "ATIVO"
                ? "Ativo"
                : fluxo.status === "RASCUNHO"
                  ? "Rascunho"
                  : "Arquivado"}
            </Badge>
          </div>
          {fluxo.descricao && (
            <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{fluxo.descricao}</p>
          )}
        </div>

        {/*
          Os números da linha, num bloco só e em texto pequeno: eles servem para
          comparar linhas de relance, não para serem lidos um a um. Cada um como
          etiqueta colorida faria a lista virar um mural.
        */}
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <p>
            {fluxo.etapas} {fluxo.etapas === 1 ? "etapa" : "etapas"} · v{fluxo.versao}
          </p>
          <p>{fluxo.dono ?? "sem dono definido"}</p>
          <p>atualizado em {comoData(fluxo.atualizadoEm)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/fluxos/${fluxo.id}`}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Abrir
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Duplicar ${fluxo.nome}`}
            disabled={duplicar.isPending}
            onClick={() => duplicar.mutate()}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              fluxo.status === "ARQUIVADO" ? `Desarquivar ${fluxo.nome}` : `Arquivar ${fluxo.nome}`
            }
            disabled={arquivar.isPending}
            onClick={() => arquivar.mutate()}
          >
            {fluxo.status === "ARQUIVADO" ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * O vazio — e a diferença entre "não há nada" e "o filtro não achou".
 *
 * São situações opostas, e o mesmo texto para as duas manda a pessoa criar um
 * fluxo quando o que ela precisa é limpar a busca.
 */
function ListaVazia({
  temFluxos,
  modelos,
  aoUsarModelo,
  aoMontarPorTexto,
  usando,
}: {
  temFluxos: boolean;
  modelos: { slug: string; nome: string; resumo: string; etapas: number }[];
  aoUsarModelo: (slug: string) => void;
  aoMontarPorTexto: () => void;
  usando: boolean;
}) {
  if (temFluxos) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum fluxo corresponde ao que está filtrado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">Nenhum processo mapeado ainda.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cole a lista de etapas que saiu da reunião, comece de um modelo pronto e adapte, ou
            desenhe do zero.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={aoMontarPorTexto}>
            <ListPlus className="mr-1.5 h-4 w-4" />
            Montar por texto
          </Button>
        </div>
        <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
          {modelos.map((modelo) => (
            <Button
              key={modelo.slug}
              variant="outline"
              size="sm"
              disabled={usando}
              onClick={() => aoUsarModelo(modelo.slug)}
              className="h-auto py-2 text-left"
            >
              <span>
                <span className="block text-sm font-medium">{modelo.nome}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {modelo.resumo} · {modelo.etapas} etapas
                </span>
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
