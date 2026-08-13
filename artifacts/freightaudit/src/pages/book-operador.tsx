import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Info, Search } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { BlocoCard } from "@/components/book/bloco-card";
import { useFavoritos } from "@/lib/favoritos";
import { cn } from "@/lib/utils";
import {
  BLOCOS_BOOK,
  TOTAL_DECLARADO_FREIGHTECH,
  categoriasDoBook,
  chaveDoBloco,
  normalizar,
} from "@/lib/book-operador";

/**
 * Book do Operador — o índice das regras de remuneração, em vocabulário do
 * Freightech.
 *
 * **Por que esta tela existe.** O export que alimenta o FreightCheck é o
 * cadastro remunerado da frota, não o regulamento: 99 colunas por placa, e
 * nenhuma linha dizendo o que qualquer uma delas significa. O Book do Operador
 * é o outro lado — a base de blocos em que o Freightech publica *como* cada
 * pagamento é composto. Sem ela, "o IPVA caiu 77%" é um fato sem regra ao lado;
 * com ela, dá para perguntar contra o que conferir.
 *
 * **O que ela entrega hoje, dito sem rodeio.** O índice: os blocos que existem,
 * com categoria, título e descrição, buscáveis e filtráveis como lá. O
 * documento de cada bloco **não** está importado, e a tela escreve isso em vez
 * de deixar a grade sugerir o contrário. É a mesma regra que vale no resto do
 * produto — não exibir o que não se consegue sustentar — aplicada a texto em
 * vez de a número.
 *
 * **A paginação é a de lá, e não é enfeite.** Seis por página, a contagem
 * "Mostrando X - Y de Z" no rodapé, o seletor de tamanho à direita. Quem
 * navega a base do Freightech encontra um bloco lembrando em que página ele
 * estava; uma lista contínua e rolável seria mais confortável e destruiria
 * essa memória.
 */

const TAMANHOS_DE_PAGINA = [6, 12, 24, 48];

const CHAVE_FAVORITOS = "freightcheck:book-operador-favoritos";

export default function BookOperador() {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [porPagina, setPorPagina] = useState(TAMANHOS_DE_PAGINA[0]);
  const [pagina, setPagina] = useState(1);

  const { favoritos, alternar } = useFavoritos(CHAVE_FAVORITOS);
  const categorias = useMemo(categoriasDoBook, []);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return BLOCOS_BOOK.filter((bloco) => {
      if (categoria && bloco.categoria !== categoria) return false;
      if (soFavoritos && !favoritos.includes(chaveDoBloco(bloco))) return false;
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
  }, [busca, categoria, soFavoritos, favoritos]);

  /*
   * Filtrar encurta a lista, e a página em que se estava pode deixar de
   * existir — o efeito seria uma grade vazia com a paginação dizendo que há
   * resultados. Voltar para a primeira é o comportamento que não mente.
   */
  useEffect(() => {
    setPagina(1);
  }, [busca, categoria, soFavoritos, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const visiveis = filtrados.slice(inicio, inicio + porPagina);

  const naoTranscritos = TOTAL_DECLARADO_FREIGHTECH - BLOCOS_BOOK.length;

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
        <div className="rounded-md border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sky-900">
          <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />O que está aqui e o que ainda não
            está
          </div>
          <p className="text-sm">
            Esta tela é o <strong>índice</strong> dos blocos, transcrito da base
            do Freightech: categoria, título e descrição. O{" "}
            <strong>documento de cada bloco não foi importado</strong> — por
            isso nenhum cartão abre. Enquanto ele não chegar, o FreightCheck
            sabe que a regra existe e como ela se chama, mas não sabe o que ela
            diz, e não vai fingir que sabe.
          </p>
          <p className="text-sm mt-1.5">
            {BLOCOS_BOOK.length} blocos transcritos de{" "}
            {TOTAL_DECLARADO_FREIGHTECH} que a base de lá declara
            {naoTranscritos > 0 && (
              <>
                {" "}
                — {naoTranscritos}{" "}
                {naoTranscritos === 1
                  ? "não foi capturado"
                  : "não foram capturados"}{" "}
                e {naoTranscritos === 1 ? "falta" : "faltam"} aqui.
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

          <button
            type="button"
            onClick={() => setSoFavoritos((atual) => !atual)}
            aria-pressed={soFavoritos}
            className={cn(
              "h-11 px-4 rounded-sm border text-sm font-medium transition-colors",
              soFavoritos
                ? "bg-brand-dark text-brand-foreground border-brand-dark"
                : "bg-card hover:bg-muted",
            )}
          >
            Só favoritos ({favoritos.length})
          </button>
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
            Nenhum bloco com esse nome
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
                  favorito={favoritos.includes(chave)}
                  onAlternarFavorito={() => alternar(chave)}
                />
              );
            })}
          </div>
        )}

        <Paginacao
          primeiro={filtrados.length === 0 ? 0 : inicio + 1}
          ultimo={inicio + visiveis.length}
          total={filtrados.length}
          pagina={paginaAtual}
          totalPaginas={totalPaginas}
          porPagina={porPagina}
          onPagina={setPagina}
          onPorPagina={setPorPagina}
        />
      </div>
    </Layout>
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

/**
 * O rodapé de paginação do Freightech: a contagem à esquerda, as páginas no
 * meio, o tamanho à direita.
 */
function Paginacao({
  primeiro,
  ultimo,
  total,
  pagina,
  totalPaginas,
  porPagina,
  onPagina,
  onPorPagina,
}: {
  primeiro: number;
  ultimo: number;
  total: number;
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  onPagina: (pagina: number) => void;
  onPorPagina: (porPagina: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? "Nenhum resultado"
          : `Mostrando ${primeiro} - ${ultimo} de ${total} resultados`}
      </p>

      <nav className="flex items-center gap-1" aria-label="Paginação">
        <BotaoPagina
          onClick={() => onPagina(pagina - 1)}
          desabilitado={pagina <= 1}
          rotuloAcessivel="Página anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </BotaoPagina>

        {numerosDePagina(pagina, totalPaginas).map((numero, indice) =>
          numero === null ? (
            <span
              key={`reticencia-${indice}`}
              className="px-2 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <BotaoPagina
              key={numero}
              onClick={() => onPagina(numero)}
              ativo={numero === pagina}
              rotuloAcessivel={`Página ${numero}`}
            >
              {numero}
            </BotaoPagina>
          ),
        )}

        <BotaoPagina
          onClick={() => onPagina(pagina + 1)}
          desabilitado={pagina >= totalPaginas}
          rotuloAcessivel="Próxima página"
        >
          <ChevronRight className="w-4 h-4" />
        </BotaoPagina>
      </nav>

      <label className="text-sm text-muted-foreground flex items-center gap-2">
        Por página
        <select
          value={porPagina}
          onChange={(evento) => onPorPagina(Number(evento.target.value))}
          className="border border-input rounded-sm h-9 px-2 bg-card text-foreground outline-none focus:border-brand"
        >
          {TAMANHOS_DE_PAGINA.map((tamanho) => (
            <option key={tamanho} value={tamanho}>
              {tamanho}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function BotaoPagina({
  children,
  onClick,
  ativo,
  desabilitado,
  rotuloAcessivel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ativo?: boolean;
  desabilitado?: boolean;
  rotuloAcessivel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotuloAcessivel}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "min-w-9 h-9 px-2 rounded-sm text-sm font-medium inline-flex items-center justify-center transition-colors",
        ativo
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:bg-muted",
        desabilitado && "opacity-40 pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}

/**
 * As páginas visíveis no rodapé — `1 … 7 8 9 [10] 11`.
 *
 * `null` é a reticência. A primeira e a última estão sempre presentes, e ao
 * redor da atual ficam duas de cada lado: é a forma do Freightech, e ela
 * mantém o rodapé do mesmo tamanho com 11 páginas ou com 40.
 */
export function numerosDePagina(
  atual: number,
  total: number,
): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, indice) => indice + 1);
  }

  const paginas = new Set<number>([1, total]);
  for (let numero = atual - 2; numero <= atual + 2; numero++) {
    if (numero >= 1 && numero <= total) paginas.add(numero);
  }

  const ordenadas = [...paginas].sort((a, b) => a - b);
  const resultado: (number | null)[] = [];
  let anterior: number | null = null;
  for (const numero of ordenadas) {
    if (anterior !== null && numero - anterior > 1) resultado.push(null);
    resultado.push(numero);
    anterior = numero;
  }
  return resultado;
}
