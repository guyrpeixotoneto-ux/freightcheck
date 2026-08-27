import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Loader2, Pencil, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fraseDoErro } from "@/lib/fluxos";
import {
  edicaoNaLista,
  filtrarLinhas,
  linhasDaLista,
  ordenarLinhas,
  severidadeNoCatalogo,
  valoresDaColuna,
  type CampoEditavelNaLista,
  type ColunaDaLista,
  type FiltrosDaLista,
} from "@/lib/fluxos-analise";
import type { PropsDaVisao } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 5 — A LISTA: o processo como tabela, para auditoria.
 *
 * É a visão de quem está conferindo, não de quem está lendo. As perguntas que
 * ela responde são as de auditoria de processo: quais etapas não têm
 * responsável, quais não têm prazo, quais têm problema registrado, quantas
 * passam pelo Fiscal. Nenhuma delas se responde olhando um fluxograma.
 *
 * "Entrada" e "saída" saem do **grafo** — de onde a etapa recebe e para onde ela
 * entrega —, não de um campo cadastrado à mão. É a mesma verdade do desenho,
 * lida como linha: se alguém criar uma conexão no Fluxo, ela aparece aqui na
 * recarga seguinte, sem nada para sincronizar.
 *
 * ---------------------------------------------------------------------------
 * Processos grandes
 * ---------------------------------------------------------------------------
 *
 * A tabela não corta linha nem pagina: um recorte silencioso numa tela de
 * auditoria é pior do que uma rolagem longa — quem confere precisa saber que
 * está vendo tudo. O custo de renderizar duzentas e cinquenta linhas é
 * controlado por `content-visibility`, que deixa o navegador pular a pintura do
 * que está fora da janela sem que nada saia do DOM: a busca do navegador, a
 * leitura de tela e a contagem continuam certas.
 *
 * ---------------------------------------------------------------------------
 * Editar na célula — o motivo de a tabela aceitar digitação
 * ---------------------------------------------------------------------------
 *
 * Corrigir a área de uma etapa custava abrir o editor, achar a aba, trocar uma
 * palavra, salvar e fechar — cinco gestos para uma palavra, vezes quinze etapas
 * de um processo recém-cadastrado. É o cadastro em massa que a tela de
 * auditoria pedia: quem confere linha a linha é justamente quem descobre, linha
 * a linha, o que está errado.
 *
 * Então a célula edita: um clique abre o campo, `Enter` (ou sair do campo)
 * grava, `Esc` desiste. Seis colunas aceitam — nome, tipo, área, responsável,
 * sistema e prazo —, e as outras não aceitam por um motivo que não é preguiça:
 * `entrada` e `saída` saem do grafo e os `sinais` são calculados. Um campo de
 * texto ali prometeria uma gravação que não existe.
 *
 * A regra de quando a célula aceita mora em `edicaoNaLista`, fora daqui, porque
 * é regra e não desenho — e é testada sem DOM. A gravação mora na página: esta
 * visualização continua sem saber o que é `escritas`, e o teste de texto-fonte
 * em `fluxos-visoes.test.tsx` continua provando isso.
 *
 * Quem só quer consultar continua consultando: em modo de leitura nada abre, e
 * clicar na linha abre o painel como sempre.
 */

const COLUNAS: { chave: ColunaDaLista; rotulo: string; classe?: string }[] = [
  { chave: "numero", rotulo: "#", classe: "w-[52px]" },
  { chave: "nome", rotulo: "Etapa" },
  { chave: "tipo", rotulo: "Tipo", classe: "hidden lg:table-cell" },
  { chave: "area", rotulo: "Área", classe: "hidden md:table-cell" },
  { chave: "responsavel", rotulo: "Responsável", classe: "hidden lg:table-cell" },
  { chave: "sistema", rotulo: "Sistema", classe: "hidden lg:table-cell" },
  { chave: "sla", rotulo: "Prazo (SLA)", classe: "hidden xl:table-cell" },
];

const RECORTES: { chave: keyof FiltrosDaLista; rotulo: string }[] = [
  { chave: "comProblema", rotulo: "Com problema" },
  { chave: "comRetorno", rotulo: "Com retorno" },
  { chave: "semResponsavel", rotulo: "Sem responsável" },
  { chave: "semSla", rotulo: "Sem SLA" },
];

const SemDado = () => <span className="text-muted-foreground/50">—</span>;

export function VisaoLista({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  onEditarCampoDaEtapa,
  somenteLeitura,
}: PropsDaVisao) {
  const [filtros, setFiltros] = useState<FiltrosDaLista>({});
  const [coluna, setColuna] = useState<ColunaDaLista>("numero");
  const [crescente, setCrescente] = useState(true);

  const linhas = useMemo(() => linhasDaLista(completo), [completo]);
  const visiveis = useMemo(
    () => ordenarLinhas(filtrarLinhas(linhas, filtros), coluna, crescente),
    [linhas, filtros, coluna, crescente],
  );

  /*
    As sugestões dos campos de texto são o vocabulário que o próprio fluxo já
    usa. Não é enfeite: sem elas, cadastrar quinze etapas produz "Fiscal",
    "fiscal" e "Fiscal " — três áreas diferentes para o filtro, para a raia e
    para a contagem de handoff.
  */
  const areas = useMemo(() => valoresDaColuna(linhas, "area"), [linhas]);
  const responsaveis = useMemo(() => valoresDaColuna(linhas, "responsavel"), [linhas]);
  const sistemas = useMemo(() => valoresDaColuna(linhas, "sistema"), [linhas]);

  const trocarOrdem = (nova: ColunaDaLista) => {
    if (nova === coluna) setCrescente((v) => !v);
    else {
      setColuna(nova);
      setCrescente(true);
    }
  };

  const alternarRecorte = (chave: keyof FiltrosDaLista) =>
    setFiltros((f) => ({ ...f, [chave]: f[chave] ? undefined : true }));

  const filtrando =
    Object.values(filtros).some((v) => v !== undefined && v !== null && v !== "") ;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtros.busca ?? ""}
            onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
            placeholder="Buscar etapa…"
            aria-label="Buscar etapa"
            className="h-8 pl-8"
          />
        </div>

        <FiltroDeColuna
          rotulo="Área"
          valor={filtros.area ?? null}
          opcoes={areas}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, area: v }))}
        />
        <FiltroDeColuna
          rotulo="Responsável"
          valor={filtros.responsavel ?? null}
          opcoes={responsaveis}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, responsavel: v }))}
        />
        <FiltroDeColuna
          rotulo="Sistema"
          valor={filtros.sistema ?? null}
          opcoes={sistemas}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, sistema: v }))}
        />
        <FiltroDeColuna
          rotulo="Tipo"
          valor={filtros.tipo ?? null}
          opcoes={valoresDaColuna(linhas, "tipo")}
          rotuloDe={(v) => catalogo?.tiposDeEtapa.find((t) => t.valor === v)?.rotulo ?? v}
          aoTrocar={(v) => setFiltros((f) => ({ ...f, tipo: v }))}
        />

        {RECORTES.map((r) => (
          <Button
            key={r.chave}
            variant={filtros[r.chave] ? "default" : "outline"}
            size="sm"
            className="h-8"
            aria-pressed={Boolean(filtros[r.chave])}
            onClick={() => alternarRecorte(r.chave)}
          >
            {r.rotulo}
          </Button>
        ))}

        {filtrando && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setFiltros({})}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar
          </Button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {!somenteLeitura && (
            <span className="mr-3 hidden lg:inline">
              <Pencil className="mr-1 inline h-3 w-3" aria-hidden />
              clique numa célula para editar
            </span>
          )}
          {visiveis.length} de {linhas.length} {linhas.length === 1 ? "etapa" : "etapas"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {COLUNAS.map((c) => (
                <TableHead key={c.chave} className={c.classe}>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => trocarOrdem(c.chave)}
                    aria-label={`Ordenar por ${c.rotulo}`}
                  >
                    {c.rotulo}
                    {coluna === c.chave && (
                      <ArrowDownUp className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                </TableHead>
              ))}
              <TableHead className="hidden xl:table-cell">Entrada</TableHead>
              <TableHead className="hidden xl:table-cell">Saída</TableHead>
              <TableHead className="w-[110px]">Sinais</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((linha) => {
              const severidade = severidadeNoCatalogo(linha.diagnostico.severidade);
              const tipo = catalogo?.tiposDeEtapa.find((t) => t.valor === linha.etapa.tipo);
              const gravar = (campo: CampoEditavelNaLista) => (valor: string) =>
                onEditarCampoDaEtapa(linha.etapa.id, campo, valor);
              return (
                <TableRow
                  key={linha.etapa.id}
                  onClick={() => onSelecionarEtapa(linha.etapa.id)}
                  className={cn(
                    "cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_44px]",
                    etapaSelecionada === linha.etapa.id && "bg-muted",
                  )}
                  data-testid={`linha-${linha.etapa.nome}`}
                >
                  <TableCell className="tabular-nums text-muted-foreground">
                    {String(linha.numero).padStart(2, "0")}
                  </TableCell>
                  <TableCell className="p-0 font-medium text-foreground">
                    <CelulaDeTexto
                      rotulo={`Nome da etapa ${linha.etapa.nome}`}
                      exibido={linha.etapa.nome}
                      edicao={edicaoNaLista(linha.etapa, "nome")}
                      sugestoes={[]}
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("nome")}
                    />
                  </TableCell>
                  <TableCell className="hidden p-0 lg:table-cell">
                    <CelulaDeEscolha
                      rotulo={`Tipo da etapa ${linha.etapa.nome}`}
                      exibido={tipo?.rotulo ?? linha.etapa.tipo}
                      valor={linha.etapa.tipo}
                      opcoes={catalogo?.tiposDeEtapa ?? []}
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("tipo")}
                    />
                  </TableCell>
                  <TableCell className="hidden p-0 md:table-cell">
                    <CelulaDeTexto
                      rotulo={`Área da etapa ${linha.etapa.nome}`}
                      exibido={linha.area}
                      edicao={edicaoNaLista(linha.etapa, "area")}
                      sugestoes={areas}
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("area")}
                    />
                  </TableCell>
                  <TableCell className="hidden p-0 lg:table-cell">
                    <CelulaDeTexto
                      rotulo={`Responsável pela etapa ${linha.etapa.nome}`}
                      exibido={linha.responsavel}
                      edicao={edicaoNaLista(linha.etapa, "responsavel")}
                      sugestoes={responsaveis}
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("responsavel")}
                    />
                  </TableCell>
                  <TableCell className="hidden p-0 lg:table-cell">
                    <CelulaDeTexto
                      rotulo={`Sistema da etapa ${linha.etapa.nome}`}
                      exibido={linha.sistema}
                      edicao={edicaoNaLista(linha.etapa, "sistema")}
                      sugestoes={sistemas}
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("sistema")}
                    />
                  </TableCell>
                  <TableCell className="hidden p-0 xl:table-cell">
                    <CelulaDeTexto
                      rotulo={`Prazo (SLA) da etapa ${linha.etapa.nome}`}
                      exibido={linha.sla}
                      vazio={
                        <span className="text-xs text-muted-foreground/60">sem prazo definido</span>
                      }
                      edicao={edicaoNaLista(linha.etapa, "sla")}
                      sugestoes={[]}
                      placeholder="24 h úteis"
                      bloqueado={somenteLeitura}
                      aoGravar={gravar("sla")}
                    />
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate xl:table-cell text-muted-foreground">
                    {linha.entradas.join(", ") || <SemDado />}
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate xl:table-cell text-muted-foreground">
                    {linha.saidas.join(", ") || <SemDado />}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", severidade.ponto)} />
                      <span className="text-xs text-muted-foreground">
                        {linha.diagnostico.sinais.length > 0
                          ? linha.diagnostico.sinais.length
                          : severidade.valor === "sem-avaliacao"
                            ? "sem dados"
                            : "—"}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {visiveis.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhuma etapa atende a este recorte.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A CÉLULA QUE EDITA — e as três coisas que ela não faz.
 *
 * Ela **não grava**: chama `aoGravar` e espera a promessa, que é da página.
 * Ela **não desiste do que foi digitado** quando a gravação falha: o campo
 * continua aberto com o texto lá e a frase do servidor embaixo — perder a
 * digitação por causa de um erro de rede é o jeito mais rápido de alguém parar
 * de confiar na tela. E ela **não grava o que não mudou**: sair de uma célula
 * sem tocar em nada é o gesto mais comum de quem está lendo a tabela, e ele não
 * pode virar uma escrita no servidor.
 *
 * `Enter` grava, `Esc` desiste, sair do campo grava — a convenção de planilha,
 * que é o que a pessoa já tem na mão quando olha uma tabela dessas. A gravação
 * por saída do campo é a que evita a perda silenciosa: quem digita e clica na
 * linha de baixo esperava ter gravado.
 *
 * O clique na célula editável não abre o painel de detalhe (ele para aqui): o
 * painel continua a um clique de distância em qualquer célula que não edite —
 * o número, entrada, saída e os sinais.
 */
function CelulaDeTexto({
  rotulo,
  exibido,
  vazio,
  edicao,
  sugestoes,
  placeholder,
  bloqueado,
  aoGravar,
}: {
  rotulo: string;
  /** O que a tabela mostra — pode vir de uma lista, e não do campo gravado. */
  exibido: string | null;
  /** O que aparece quando não há valor. O travessão, por padrão. */
  vazio?: React.ReactNode;
  edicao: { editavel: boolean; valor: string; motivo?: string };
  sugestoes: string[];
  placeholder?: string;
  bloqueado: boolean;
  aoGravar: (valor: string) => Promise<void>;
}) {
  const listaId = useId();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(edicao.valor);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /*
    `Enter` grava e fecha o campo — e fechar o campo dispara o `blur`, que
    gravaria de novo. A trava é uma referência, e não estado: ela precisa valer
    dentro do mesmo evento, antes de qualquer renderização.
  */
  const gravando = useRef(false);

  /* O valor gravado mudou por fora (outra visualização, outra aba): acompanhe. */
  useEffect(() => {
    if (!editando) setRascunho(edicao.valor);
  }, [edicao.valor, editando]);

  const encerrar = () => {
    setEditando(false);
    setErro(null);
    gravando.current = false;
  };

  const confirmar = async () => {
    if (gravando.current) return;
    if (rascunho.trim() === edicao.valor.trim()) {
      encerrar();
      return;
    }
    gravando.current = true;
    setSalvando(true);
    setErro(null);
    try {
      await aoGravar(rascunho);
      encerrar();
    } catch (falha) {
      setErro(fraseDoErro(falha));
      gravando.current = false;
    } finally {
      setSalvando(false);
    }
  };

  if (!editando) {
    const conteudo = exibido ?? vazio ?? <SemDado />;
    if (bloqueado || !edicao.editavel) {
      return (
        <span
          className={cn("block px-4 py-4", !edicao.editavel && edicao.motivo && "cursor-help")}
          title={bloqueado ? undefined : edicao.motivo}
        >
          {conteudo}
          {!bloqueado && !edicao.editavel && (
            <span className="sr-only"> (só o painel da etapa edita este campo)</span>
          )}
        </span>
      );
    }
    return (
      <button
        type="button"
        aria-label={`Editar ${rotulo}`}
        title="Clique para editar"
        className="group flex w-full items-center gap-1.5 rounded px-4 py-4 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(evento) => {
          evento.stopPropagation();
          setRascunho(edicao.valor);
          setEditando(true);
        }}
      >
        <span className="min-w-0 flex-1">{conteudo}</span>
        <Pencil
          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </button>
    );
  }

  return (
    <div className="px-2 py-2" onClick={(evento) => evento.stopPropagation()}>
      <div className="relative">
        <Input
          autoFocus
          className="h-8"
          aria-label={rotulo}
          list={sugestoes.length > 0 ? listaId : undefined}
          placeholder={placeholder}
          disabled={salvando}
          value={rascunho}
          onChange={(evento) => setRascunho(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault();
              void confirmar();
            } else if (evento.key === "Escape") {
              evento.preventDefault();
              encerrar();
            }
          }}
          onBlur={() => void confirmar()}
        />
        {salvando && (
          <Loader2
            className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
      {sugestoes.length > 0 && (
        <datalist id={listaId}>
          {sugestoes.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {erro && <p className="mt-1 text-xs text-destructive">{erro}</p>}
    </div>
  );
}

/**
 * A célula de escolha — o tipo da etapa, que é vocabulário do catálogo.
 *
 * Aqui não cabe texto livre: o servidor recusa um tipo que ele não conhece, e
 * um campo aberto convidaria a digitar "validação" para receber de volta um
 * erro. Escolher já é gravar — não há o que confirmar depois de uma escolha
 * numa lista de cinco opções.
 */
function CelulaDeEscolha({
  rotulo,
  exibido,
  valor,
  opcoes,
  bloqueado,
  aoGravar,
}: {
  rotulo: string;
  exibido: string;
  valor: string;
  opcoes: { valor: string; rotulo: string }[];
  bloqueado: boolean;
  aoGravar: (valor: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (bloqueado || opcoes.length === 0) {
    return <span className="block px-4 py-4">{exibido}</span>;
  }

  if (!editando) {
    return (
      <button
        type="button"
        aria-label={`Editar ${rotulo}`}
        title="Clique para editar"
        className="group flex w-full items-center gap-1.5 rounded px-4 py-4 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(evento) => {
          evento.stopPropagation();
          setEditando(true);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{exibido}</span>
        {salvando ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Pencil
            className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
        {erro && <span className="sr-only">{erro}</span>}
      </button>
    );
  }

  return (
    <div className="px-2 py-2" onClick={(evento) => evento.stopPropagation()}>
      <Select
        open
        value={valor}
        onValueChange={(novo) => {
          setEditando(false);
          if (novo === valor) return;
          setSalvando(true);
          setErro(null);
          aoGravar(novo)
            .catch((falha: unknown) => setErro(fraseDoErro(falha)))
            .finally(() => setSalvando(false));
        }}
        onOpenChange={(aberto) => !aberto && setEditando(false)}
      >
        <SelectTrigger className="h-8" aria-label={rotulo}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {erro && <p className="mt-1 text-xs text-destructive">{erro}</p>}
    </div>
  );
}

/**
 * Um filtro de coluna — e o motivo de "Todas" ser um valor e não um vazio.
 *
 * O `Select` do Radix recusa `value=""` (é o valor reservado do estado limpo),
 * e a saída de todo mundo é uma sentinela. Ela fica **aqui**, num componente
 * só, em vez de repetida em cada filtro: quatro sentinelas escritas à mão é
 * como uma delas acaba diferente e o filtro correspondente para de limpar.
 */
function FiltroDeColuna({
  rotulo,
  valor,
  opcoes,
  rotuloDe,
  aoTrocar,
}: {
  rotulo: string;
  valor: string | null;
  opcoes: string[];
  rotuloDe?: (valor: string) => string;
  aoTrocar: (valor: string | null) => void;
}) {
  const TODAS = "__todas__";
  if (opcoes.length === 0) return null;
  return (
    <Select value={valor ?? TODAS} onValueChange={(v) => aoTrocar(v === TODAS ? null : v)}>
      <SelectTrigger className="h-8 w-auto min-w-[130px]" aria-label={`Filtrar por ${rotulo}`}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODAS}>{rotulo}: todas</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o} value={o}>
            {rotuloDe ? rotuloDe(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A etiqueta de severidade, para quem precisar dela fora da tabela. */
export function EtiquetaDeSeveridade({ severidade }: { severidade: string }) {
  const entrada = severidadeNoCatalogo(severidade as never);
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("h-2 w-2 rounded-full", entrada.ponto)} />
      {entrada.rotulo}
    </Badge>
  );
}
