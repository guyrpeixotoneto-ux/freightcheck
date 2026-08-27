import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Lightbulb,
  ListPlus,
  MoreVertical,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorDoFluxo } from "@/components/fluxos/editor-do-fluxo";
import { MontadorPorTexto } from "@/components/fluxos/montador-por-texto";
import { useEmpresaDosFluxos } from "@/components/fluxos/seletor-de-empresa";
import {
  acentoDaCategoria,
  categoriasDaLista,
  comoTempoRelativo,
  escritas,
  filtrarFluxos,
  ordenarPorAtualizacao,
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
 * A linha é lida de relance, e por isso é feita de poucas coisas grandes: uma
 * tarja colorida e uma bolha com ícone à esquerda (a categoria, achada sem se
 * ler nada), o nome, o resumo, duas etiquetas — tamanho e quando mudou — e o
 * botão que abre. Versão, dono e data exata continuam existindo; ficam no
 * detalhe, porque em vinte linhas ninguém compara esses números, e eles é que
 * transformavam a lista num relatório.
 *
 * **A ordem é a da última mexida**, não a alfabética: quem entra aqui quase
 * sempre volta ao que estava editando. Quem já sabe o nome usa a busca.
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

  const [busca, setBusca] = useState("");
  const [incluirArquivados, setIncluirArquivados] = useState(false);
  const [criando, setCriando] = useState(false);
  const [colando, setColando] = useState(false);

  const catalogo = useCatalogoDeFluxos();
  const consulta = useFluxos(empresaId, incluirArquivados);
  const recarregar = useRecarregarFluxos(empresaId);

  const fluxos = useMemo(() => consulta.data?.fluxos ?? [], [consulta.data]);
  const categorias = useMemo(() => categoriasDaLista(fluxos), [fluxos]);
  const visiveis = useMemo(
    () => ordenarPorAtualizacao(filtrarFluxos(fluxos, { busca })),
    [fluxos, busca],
  );

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

      <main className="bg-muted/30 px-8 py-6">
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
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="h-11 rounded-xl bg-card pl-10"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Procurar por nome, categoria ou dono…"
                  aria-label="Procurar fluxo"
                />
              </div>

              <Button
                variant={incluirArquivados ? "secondary" : "outline"}
                className="h-11 rounded-xl bg-card"
                onClick={() => setIncluirArquivados((v) => !v)}
              >
                <Archive className="mr-1.5 h-4 w-4" />
                {incluirArquivados ? "Mostrando arquivados" : "Mostrar arquivados"}
              </Button>
            </div>

            {consulta.isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            )}

            {!consulta.isLoading && visiveis.length === 0 && (
              <ListaVazia temFluxos={fluxos.length > 0} aoMontarPorTexto={() => setColando(true)} />
            )}

            {visiveis.length > 0 && (
              <section>
                <CabecalhoDaSecao titulo="Fluxos mais recentes" contagem={visiveis.length} />
                <div className="space-y-3">
                  {visiveis.map((fluxo) => (
                    <LinhaDoFluxo
                      key={fluxo.id}
                      fluxo={fluxo}
                      empresaId={empresaId}
                      aoMudar={() => recarregar(fluxo.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/*
              Os modelos só aparecem enquanto não há processo mapeado. Depois do
              primeiro fluxo, eles viram ruído no fim da lista: quem já mapeou
              sabe que existe "Novo fluxo" ali em cima.
            */}
            {!consulta.isLoading && fluxos.length === 0 && (catalogo.data?.modelos.length ?? 0) > 0 && (
              <section className="mt-8">
                <CabecalhoDaSecao titulo="Comece de um modelo pronto" />
                <div className="space-y-3">
                  {(catalogo.data?.modelos ?? []).map((modelo) => (
                    <LinhaDoModelo
                      key={modelo.slug}
                      modelo={modelo}
                      usando={doModelo.isPending}
                      aoUsar={() => doModelo.mutate(modelo.slug)}
                    />
                  ))}
                </div>
              </section>
            )}

            <DicaRapida />
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
          aoSalvar={() => recarregar()}
        />
      )}
    </Layout>
  );
}

/** O título de uma faixa da tela, com a linha que a separa do que veio antes. */
function CabecalhoDaSecao({ titulo, contagem }: { titulo: string; contagem?: number }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
      {contagem !== undefined && (
        <span className="text-xs text-muted-foreground">
          {contagem} {contagem === 1 ? "fluxo" : "fluxos"}
        </span>
      )}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Uma linha da lista — a tarja da categoria, o nome, e o que abre.
 *
 * As ações que não são "abrir" (duplicar, arquivar) ficam atrás do menu de três
 * pontos. Elas são raras e algumas são destrutivas de fato; deixá-las como
 * ícones soltos ao lado do botão principal punha "arquivar" a um clique de
 * distância de "abrir", com dois centímetros entre eles.
 */
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

  const acento = acentoDaCategoria(fluxo.categoria);
  const arquivado = fluxo.status === "ARQUIVADO";

  return (
    <Card
      className={`relative overflow-hidden rounded-xl transition-shadow hover:shadow-sm ${
        arquivado ? "opacity-70" : ""
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${acento.barra}`} aria-hidden />
      <CardContent className="flex flex-wrap items-center gap-4 py-4 pl-6 pr-4">
        <span
          className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full sm:flex ${acento.bolha}`}
          aria-hidden
        >
          <Workflow className="h-5 w-5" />
        </span>

        <div className="min-w-[240px] flex-1">
          <Link
            href={`/fluxos/${fluxo.id}`}
            className="text-base font-semibold text-foreground hover:underline"
          >
            {fluxo.nome}
          </Link>
          {fluxo.descricao && (
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{fluxo.descricao}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className={`border-0 font-normal ${acento.bolha}`}>
              {fluxo.etapas} {fluxo.etapas === 1 ? "etapa" : "etapas"}
            </Badge>
            <Badge variant="secondary" className="border-0 font-normal text-muted-foreground">
              Atualizado {comoTempoRelativo(fluxo.atualizadoEm)}
            </Badge>
            {fluxo.status !== "ATIVO" && (
              <Badge variant="outline" className="font-normal">
                {arquivado ? "Arquivado" : "Rascunho"}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" className="rounded-lg" asChild>
            <Link href={`/fluxos/${fluxo.id}`}>Abrir fluxo</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Mais ações de ${fluxo.nome}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={duplicar.isPending} onSelect={() => duplicar.mutate()}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={arquivar.isPending} onSelect={() => arquivar.mutate()}>
                {arquivado ? (
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <Archive className="mr-2 h-3.5 w-3.5" />
                )}
                {arquivado ? "Desarquivar" : "Arquivar"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

/** O modelo pronto, na mesma linha do fluxo — para a escolha ser a mesma leitura. */
function LinhaDoModelo({
  modelo,
  usando,
  aoUsar,
}: {
  modelo: { slug: string; nome: string; categoria: string; resumo: string; etapas: number };
  usando: boolean;
  aoUsar: () => void;
}) {
  const acento = acentoDaCategoria(modelo.categoria);

  return (
    <Card className="relative overflow-hidden rounded-xl border-dashed transition-shadow hover:shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${acento.barra}`} aria-hidden />
      <CardContent className="flex flex-wrap items-center gap-4 py-4 pl-6 pr-4">
        <span
          className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full sm:flex ${acento.bolha}`}
          aria-hidden
        >
          <Workflow className="h-5 w-5" />
        </span>

        <div className="min-w-[240px] flex-1">
          <p className="text-base font-semibold text-foreground">{modelo.nome}</p>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{modelo.resumo}</p>
          <div className="mt-2">
            <Badge variant="secondary" className={`border-0 font-normal ${acento.bolha}`}>
              {modelo.etapas} {modelo.etapas === 1 ? "etapa" : "etapas"}
            </Badge>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-lg"
          disabled={usando}
          onClick={aoUsar}
        >
          Usar modelo
        </Button>
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
  aoMontarPorTexto,
}: {
  temFluxos: boolean;
  aoMontarPorTexto: () => void;
}) {
  if (temFluxos) {
    return (
      <Card className="rounded-xl">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum fluxo corresponde ao que está filtrado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl">
      <CardContent className="flex flex-wrap items-center gap-8 px-8 py-8">
        <DesenhoDeFluxoVazio />
        <div className="min-w-[260px] flex-1">
          <p className="text-lg font-semibold text-foreground">Nenhum processo mapeado ainda.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cole a lista de etapas que saiu da reunião, comece de um modelo pronto e adapte, ou
            desenhe do zero.
          </p>
          <Button variant="outline" className="mt-4" onClick={aoMontarPorTexto}>
            <ListPlus className="mr-1.5 h-4 w-4" />
            Montar por texto
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A moldura tracejada com um fluxinho dentro: o desenho do que vai existir ali. */
function DesenhoDeFluxoVazio() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="hidden h-24 w-36 shrink-0 sm:block"
      role="img"
      aria-label="Ilustração de um fluxo vazio"
    >
      <rect
        x="1"
        y="1"
        width="138"
        height="98"
        rx="10"
        className="fill-none stroke-border"
        strokeWidth="2"
        strokeDasharray="6 6"
      />
      <line x1="42" y1="50" x2="66" y2="50" className="stroke-primary/40" strokeWidth="2" />
      <line x1="80" y1="42" x2="96" y2="30" className="stroke-primary/40" strokeWidth="2" />
      <circle cx="34" cy="50" r="8" className="fill-none stroke-primary" strokeWidth="2" />
      <rect
        x="66"
        y="44"
        width="12"
        height="12"
        className="fill-none stroke-primary"
        strokeWidth="2"
      />
      <rect
        x="96"
        y="18"
        width="18"
        height="18"
        transform="rotate(45 105 27)"
        className="fill-none stroke-primary"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * A dica do rodapé — o que a lista não consegue ensinar sozinha.
 *
 * Fica no fim, e não como balão no primeiro acesso: quem chegou aqui para abrir
 * um fluxo não é interrompido, e quem terminou de olhar a lista lê a dica no
 * caminho de saída.
 */
function DicaRapida() {
  return (
    <div className="mt-8 flex items-start gap-3 rounded-xl border border-dashed bg-card px-5 py-4">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <div className="text-sm">
        <p className="font-medium text-foreground">Dica rápida</p>
        <p className="text-muted-foreground">
          Arraste e solte etapas para reordenar, clique em qualquer etapa para detalhar e conecte
          sistemas e documentos para ter tudo no mesmo lugar.
        </p>
      </div>
    </div>
  );
}
