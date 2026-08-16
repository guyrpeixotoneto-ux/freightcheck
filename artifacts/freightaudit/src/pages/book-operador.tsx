import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Info, Search } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { BlocoCard } from "@/components/book/bloco-card";
import { BlocoPainel } from "@/components/book/bloco-painel";
import { Paginacao } from "@/components/ui/paginacao";
import type { BookEntryCurrent } from "@/components/book/types";
import { fetchJson } from "@/lib/api";
import { useFavoritos } from "@/lib/favoritos";
import { cn } from "@/lib/utils";
import {
  BLOCOS_BOOK,
  TOTAL_DECLARADO_FREIGHTECH,
  categoriasDoBook,
  chaveDoBloco,
  normalizar,
  type BlocoBook,
} from "@/lib/book-operador";

/**
 * Book do Operador — as regras de remuneração, em vocabulário do Freightech.
 *
 * **Por que esta tela existe.** O export que alimenta o FreightCheck é o
 * cadastro remunerado da frota, não o regulamento: 99 colunas por placa, e
 * nenhuma linha dizendo o que qualquer uma delas significa. O Book do Operador
 * é o outro lado — a base de blocos em que o Freightech publica *como* cada
 * pagamento é composto. Sem ela, "o IPVA caiu 77%" é um fato sem regra ao lado;
 * com ela, dá para dizer contra o que conferir.
 *
 * **O índice vem de lá; o conteúdo entra aqui.** Os blocos são transcrição da
 * tela do Freightech e vivem em `lib/book-operador.ts`. A regra de cada um é
 * registrada neste produto, por quem opera, escrevendo o texto ou anexando o
 * documento — e o cartão diz, antes do clique, qual dos dois ele tem.
 *
 * **A paginação é a de lá, e não é enfeite.** Seis por página, a contagem
 * "Mostrando X - Y de Z" no rodapé, o seletor de tamanho à direita. Quem navega
 * a base do Freightech encontra um bloco lembrando em que página ele estava;
 * uma lista contínua e rolável seria mais confortável e destruiria essa
 * memória.
 */

const TAMANHOS_DE_PAGINA = [6, 12, 24, 48];

const CHAVE_FAVORITOS = "freightcheck:book-operador-favoritos";

export default function BookOperador() {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [soSemRegra, setSoSemRegra] = useState(false);
  const [porPagina, setPorPagina] = useState(TAMANHOS_DE_PAGINA[0]);
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<BlocoBook | null>(null);

  const { favoritos, alternar } = useFavoritos(CHAVE_FAVORITOS);
  const categorias = useMemo(categoriasDoBook, []);

  const entradas = useQuery({
    queryKey: ["book-entries"],
    queryFn: () => fetchJson<BookEntryCurrent[]>("/book/entries"),
  });

  /** A entrada vigente de cada bloco, indexada pela chave. */
  const porBloco = useMemo(() => {
    const mapa = new Map<string, BookEntryCurrent>();
    for (const entrada of entradas.data ?? []) mapa.set(entrada.blockKey, entrada);
    return mapa;
  }, [entradas.data]);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return BLOCOS_BOOK.filter((bloco) => {
      const chave = chaveDoBloco(bloco);
      if (categoria && bloco.categoria !== categoria) return false;
      if (soFavoritos && !favoritos.includes(chave)) return false;
      if (soSemRegra && porBloco.has(chave)) return false;
      if (!termo) return true;
      /*
       * A busca varre título, descrição e categoria juntos. Quem procura
       * "pedágio" não sabe se o Freightech guardou aquilo no título ou na
       * descrição, e restringir ao título faria a tela responder "nada
       * encontrado" sobre um bloco que está bem ali.
       */
      return normalizar(
        `${bloco.titulo} ${bloco.descricao} ${bloco.categoria}`,
      ).includes(termo);
    });
  }, [busca, categoria, soFavoritos, soSemRegra, favoritos, porBloco]);

  /*
   * Filtrar encurta a lista, e a página em que se estava pode deixar de
   * existir — o efeito seria uma grade vazia com a paginação dizendo que há
   * resultados. Voltar para a primeira é o comportamento que não mente.
   */
  useEffect(() => {
    setPagina(1);
  }, [busca, categoria, soFavoritos, soSemRegra, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const visiveis = filtrados.slice(inicio, inicio + porPagina);

  const naoTranscritos = TOTAL_DECLARADO_FREIGHTECH - BLOCOS_BOOK.length;
  const repetidos = BLOCOS_BOOK.filter(
    (b) => b.ocorrencia && b.ocorrencia > 1,
  ).length;
  const comRegra = BLOCOS_BOOK.filter((b) =>
    porBloco.has(chaveDoBloco(b)),
  ).length;
  /*
    Quantos têm o documento, e não só a regra. É o número que o cartão passou a
    destacar — sem ele aqui em cima, a grade mostraria seis cartões verdes por
    página sem que ninguém soubesse quantos são no total.
  */
  const comDocumento = BLOCOS_BOOK.filter(
    (b) => porBloco.get(chaveDoBloco(b))?.kind === "DOCUMENTO",
  ).length;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-brand-dark" />
          Book do Operador
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Os blocos em que o Freightech publica as regras de remuneração da
          Ambev — o que compõe cada pagamento, o que a transportadora precisa
          entregar, e sob qual acordo. É o lado que a planilha de vigência não
          traz: ela exporta o cadastro remunerado da frota, não o regulamento.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {entradas.error && (
          <ApiErrorNotice
            error={entradas.error}
            what="As regras já registradas não puderam ser carregadas. Os blocos abaixo continuam sendo os do Freightech; o que não dá para saber agora é qual deles já tem regra."
          />
        )}

        <div className="rounded-md border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sky-900">
          <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Como este book se preenche
          </div>
          <p className="text-sm">
            O índice vem do Freightech; a regra de cada bloco é registrada aqui,
            de dois jeitos: <strong>escrevendo o texto</strong>, quando ela cabe
            escrita, ou <strong>anexando o documento</strong> — contrato, manual,
            planilha — quando ele existe. Abra um cartão para ler, escrever ou
            anexar. Substituir nunca apaga: cada envio vira uma revisão nova, e
            a anterior continua no histórico do bloco.
          </p>
          <p className="text-sm mt-1.5">
            {entradas.isLoading ? (
              "Conferindo quais blocos já têm regra…"
            ) : (
              <>
                <strong>
                  {comRegra} de {BLOCOS_BOOK.length}
                </strong>{" "}
                blocos com regra registrada
                {comDocumento > 0 && (
                  <>
                    , {comDocumento} com documento anexado — régua verde e clipe
                    no cartão
                  </>
                )}
                .
              </>
            )}{" "}
            {/*
              A ressalva só aparece quando há o que ressalvar. Enquanto os dois
              números batem, repetir "66 de 66 que a base declara" seria ruído
              numa frase que existe para chamar atenção — e ruído constante é
              como um alarme para de ser lido.
            */}
            {naoTranscritos === 0 ? (
              <>
                O índice tem os {TOTAL_DECLARADO_FREIGHTECH} registros da base do
                Freightech, entre eles {repetidos}{" "}
                {repetidos === 1
                  ? "bloco que ela lista duas vezes"
                  : "blocos que ela lista duas vezes"}
                .
              </>
            ) : (
              <>
                {BLOCOS_BOOK.length} blocos transcritos de{" "}
                {TOTAL_DECLARADO_FREIGHTECH} que a base de lá declara —{" "}
                {naoTranscritos}{" "}
                {naoTranscritos === 1
                  ? "não foi capturado e falta"
                  : "não foram capturados e faltam"}{" "}
                aqui.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1 max-w-md">
            <label
              htmlFor="busca-book"
              className="block text-sm font-medium mb-1.5"
            >
              Buscar bloco
            </label>
            <div className="relative">
              <input
                id="busca-book"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="pneu, lucro, encargos, pedágio…"
                className="w-full border border-input rounded-sm h-11 pl-3 pr-10 text-sm outline-none focus:border-brand bg-card"
              />
              <Search className="w-5 h-5 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <Alternador
            ativo={soFavoritos}
            onClick={() => setSoFavoritos((atual) => !atual)}
          >
            Só favoritos ({favoritos.length})
          </Alternador>

          {/*
            "Sem regra" é o filtro de quem está preenchendo o book, e é o
            trabalho que sobra: com 63 blocos, achar os que faltam rolando a
            grade inteira é o tipo de tarefa que ninguém termina.
          */}
          <Alternador
            ativo={soSemRegra}
            onClick={() => setSoSemRegra((atual) => !atual)}
          >
            Sem regra ({BLOCOS_BOOK.length - comRegra})
          </Alternador>
        </div>

        <div className="flex flex-wrap gap-2">
          <FiltroCategoria
            rotulo={`Todas (${BLOCOS_BOOK.length})`}
            ativo={categoria === null}
            onClick={() => setCategoria(null)}
          />
          {categorias.map((nome) => (
            <FiltroCategoria
              key={nome}
              rotulo={`${nome} (${
                BLOCOS_BOOK.filter((b) => b.categoria === nome).length
              })`}
              ativo={categoria === nome}
              onClick={() => setCategoria(categoria === nome ? null : nome)}
            />
          ))}
        </div>

        {visiveis.length === 0 ? (
          <p className="text-muted-foreground py-8">
            Nenhum bloco
            {busca.trim() !== "" && " com esse nome"}
            {soSemRegra && " sem regra"}
            {soFavoritos && " entre os favoritos"}
            {categoria && ` em “${categoria}”`}.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {visiveis.map((bloco) => {
              const chave = chaveDoBloco(bloco);
              return (
                <BlocoCard
                  key={chave}
                  bloco={bloco}
                  vigente={porBloco.get(chave)}
                  favorito={favoritos.includes(chave)}
                  onAbrir={() => setAberto(bloco)}
                  onAlternarFavorito={() => alternar(chave)}
                />
              );
            })}
          </div>
        )}

        <Paginacao
          total={filtrados.length}
          pagina={paginaAtual}
          porPagina={porPagina}
          onPagina={setPagina}
          onPorPagina={setPorPagina}
          tamanhos={TAMANHOS_DE_PAGINA}
          className="px-0 pb-0"
        />
      </div>

      {aberto && (
        <BlocoPainel
          bloco={aberto}
          vigente={porBloco.get(chaveDoBloco(aberto))}
          onFechar={() => setAberto(null)}
        />
      )}
    </Layout>
  );
}

function Alternador({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "h-11 px-4 rounded-sm border text-sm font-medium transition-colors",
        ativo
          ? "bg-brand-dark text-brand-foreground border-brand-dark"
          : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function FiltroCategoria({
  rotulo,
  ativo,
  onClick,
}: {
  rotulo: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors",
        ativo
          ? "bg-brand-dark text-brand-foreground border-brand-dark"
          : "bg-card hover:bg-muted text-muted-foreground",
      )}
    >
      {rotulo}
    </button>
  );
}
