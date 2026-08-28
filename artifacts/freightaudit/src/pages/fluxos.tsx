import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  CornerDownRight,
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
  aninharSubfluxos,
  categoriasDaLista,
  comoTempoRelativo,
  contarRamos,
  escritas,
  filtrarFluxos,
  ordenarPorAtualizacao,
  useCatalogoDeFluxos,
  useFluxos,
  useRecarregarFluxos,
  type FluxoNaLista,
  type RamoDeFluxos,
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
 * **Um subfluxo mora dentro do fluxo que ele detalha.** Quando alguém detalha
 * uma etapa, nasce um fluxo — e ele aparecia aqui em cima, do mesmo tamanho e
 * ao lado do processo do qual é um pedaço. A lista mostra a hierarquia: o pai
 * traz a seta à esquerda, e ela abre os detalhes que pendem dele. Fechado por
 * padrão, porque a pergunta desta tela é "quais processos a empresa tem", e o
 * detalhe de uma etapa não é mais um processo — é o zoom de um. A busca abre
 * tudo enquanto durar: uma linha que passou pelo filtro nunca fica escondida
 * atrás de uma seta.
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
  const visiveis = useMemo(
    () => aninharSubfluxos(ordenarPorAtualizacao(filtrarFluxos(fluxos, { busca }))),
    [fluxos, busca],
  );
  const quantosVisiveis = useMemo(() => contarRamos(visiveis), [visiveis]);

  /*
    Quais pais estão abertos. Enquanto há busca, todos: o filtro já escolheu o
    que interessa, e esconder um resultado atrás de uma seta fechada faria a
    busca parecer não ter achado o que achou.
  */
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const buscando = busca.trim() !== "";
  const alternar = (id: string) =>
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });

  /*
    O que a empresa já mapeou não é sugestão — é o mapa dela, e aparece na
    lista sozinho.

    "Operação Empurrada" foi levantada em reunião e está cadastrada como dado
    (`jaMapeado` em `@workspace/fluxos`). Enquanto ela vivia entre os modelos
    prontos, a tela pedia que alguém "usasse um modelo" para ter de volta o
    processo que a própria empresa desenhou — e o mapa ficava de fora do lugar
    onde se procura processo mapeado.

    Então, na primeira lista vazia, a tela pede a semeadura desses — e só
    desses: quem decide o que é mapa e o que é exemplo é o servidor. A chamada
    é idempotente pelo slug, e o `pediuSemeadura` impede um segundo pedido no
    mesmo carregamento; um fluxo arquivado volta a ser o mesmo fluxo, não uma
    cópia.
  */
  const semear = useMutation({
    mutationFn: () => escritas.semearJaMapeados(empresaId),
    onSuccess: () => recarregar(),
  });
  const pediuSemeadura = useRef(false);

  useEffect(() => {
    if (empresaId === null || !consulta.isSuccess || pediuSemeadura.current) return;
    if (fluxos.length > 0) return;
    pediuSemeadura.current = true;
    semear.mutate();
    /* `semear` é estável o bastante: o guarda de execução é o ref, não a lista de dependências. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, consulta.isSuccess, fluxos.length]);

  /* Modelos são ponto de partida; o processo já mapeado da empresa não é oferecido de novo. */
  const modelosOferecidos = useMemo(
    () => (catalogo.data?.modelos ?? []).filter((m) => !m.jaMapeado),
    [catalogo.data],
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

            {/* A semeadura do que já está mapeado é parte do carregamento — e não um estado vazio piscando antes dele. */}
            {(consulta.isLoading || semear.isPending) && (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            )}

            {!consulta.isLoading && !semear.isPending && quantosVisiveis === 0 && (
              <ListaVazia temFluxos={fluxos.length > 0} aoMontarPorTexto={() => setColando(true)} />
            )}

            {quantosVisiveis > 0 && (
              <section>
                <CabecalhoDaSecao titulo="Fluxos mais recentes" contagem={quantosVisiveis} />
                <div className="space-y-3">
                  {visiveis.map((ramo) => (
                    <RamoDoFluxo
                      key={ramo.fluxo.id}
                      ramo={ramo}
                      empresaId={empresaId}
                      estaAberto={(id) => buscando || abertos.has(id)}
                      aoAlternar={alternar}
                      aoMudar={recarregar}
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
            {!consulta.isLoading && !semear.isPending && fluxos.length === 0 && modelosOferecidos.length > 0 && (
              <section className="mt-8">
                <CabecalhoDaSecao titulo="Comece de um modelo pronto" />
                <div className="space-y-3">
                  {modelosOferecidos.map((modelo) => (
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
 * Um fluxo e o que pende dele — a linha, e as linhas dos detalhes dela.
 *
 * A recursão existe porque a hierarquia é de profundidade livre: uma etapa do
 * subfluxo pode ter o seu próprio detalhe, e `ligarSubfluxo` só recusa ciclo,
 * não profundidade. O recuo é o único sinal de nível, e ele é pequeno de
 * propósito — o cartão do detalhe continua sendo um cartão, e não um item de
 * lista dentro do pai, porque abrir um subfluxo é a mesma coisa que abrir
 * qualquer fluxo.
 */
function RamoDoFluxo({
  ramo,
  empresaId,
  estaAberto,
  aoAlternar,
  aoMudar,
  nivel = 0,
}: {
  ramo: RamoDeFluxos;
  empresaId: string | null;
  estaAberto: (id: string) => boolean;
  aoAlternar: (id: string) => void;
  aoMudar: (fluxoId?: string) => void;
  nivel?: number;
}) {
  const aberto = estaAberto(ramo.fluxo.id);
  const temFilhos = ramo.filhos.length > 0;

  return (
    <div className="space-y-3">
      <LinhaDoFluxo
        fluxo={ramo.fluxo}
        empresaId={empresaId}
        subfluxos={ramo.filhos.length}
        aberto={aberto}
        eDetalhe={nivel > 0}
        aoAlternar={temFilhos ? () => aoAlternar(ramo.fluxo.id) : undefined}
        aoMudar={() => aoMudar(ramo.fluxo.id)}
      />
      {temFilhos && aberto && (
        /* A linha vertical à esquerda é o que diz "isto é de dentro" quando o cartão do pai já rolou para fora da tela. */
        <div className="ml-4 space-y-3 border-l-2 border-border pl-4 sm:ml-8">
          {ramo.filhos.map((filho) => (
            <RamoDoFluxo
              key={filho.fluxo.id}
              ramo={filho}
              empresaId={empresaId}
              estaAberto={estaAberto}
              aoAlternar={aoAlternar}
              aoMudar={aoMudar}
              nivel={nivel + 1}
            />
          ))}
        </div>
      )}
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
  subfluxos,
  aberto,
  eDetalhe,
  aoAlternar,
  aoMudar,
}: {
  fluxo: FluxoNaLista;
  empresaId: string | null;
  /** Quantos detalhes pendem daqui — zero esconde a seta. */
  subfluxos: number;
  aberto: boolean;
  /** Esta linha é o detalhe de uma etapa de outro fluxo. */
  eDetalhe: boolean;
  /** Ausente quando não há o que abrir: o espaço da seta continua reservado. */
  aoAlternar?: () => void;
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
      <CardContent className="flex flex-wrap items-center gap-4 py-4 pl-3 pr-4">
        {/*
          A seta ocupa o lugar mesmo quando não há o que abrir: sem isso, o nome
          de um fluxo sem detalhes ficaria alguns pixels à esquerda do nome dos
          outros, e a coluna dos nomes deixaria de existir.
        */}
        {aoAlternar ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-expanded={aberto}
            aria-label={`${aberto ? "Fechar" : "Abrir"} os ${subfluxos} ${
              subfluxos === 1 ? "subfluxo" : "subfluxos"
            } de ${fluxo.nome}`}
            onClick={aoAlternar}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${aberto ? "rotate-90" : ""}`}
            />
          </Button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden />
        )}

        <span
          className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-full sm:flex ${acento.bolha}`}
          aria-hidden
        >
          <Workflow className="h-5 w-5" />
        </span>

        <div className="min-w-[240px] flex-1">
          {/*
            De qual etapa este fluxo é o detalhe — a frase que faz o cartão de
            dentro se explicar sozinho, inclusive quando a busca o promove a
            raiz e o pai não está na tela.
          */}
          {eDetalhe && fluxo.pai && (
            <p className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Detalha a etapa “{fluxo.pai.etapaNome}”
            </p>
          )}
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
            {/* Fechado, é o único aviso de que existe coisa embaixo desta linha. */}
            {subfluxos > 0 && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {subfluxos} {subfluxos === 1 ? "subfluxo" : "subfluxos"}
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
