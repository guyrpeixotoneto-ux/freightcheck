import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Check, Loader2, Pencil, Plus, Search, X } from "lucide-react";
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
  celulaEmRepouso,
  reduzirCelula,
  type AcaoDaCelula,
} from "@/lib/fluxos-celula";
import {
  edicaoNaLista,
  etapaNovaVazia,
  filtrarLinhas,
  linhasDaLista,
  ordenarLinhas,
  podeCriarEtapaNaLista,
  severidadeNoCatalogo,
  valoresDaColuna,
  type CampoEditavelNaLista,
  type ColunaDaLista,
  type EtapaNovaNaLista,
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
 *
 * ---------------------------------------------------------------------------
 * Cadastrar na tabela — a linha nova, no topo
 * ---------------------------------------------------------------------------
 *
 * Editar na célula resolvia a correção; faltava o começo. Um fluxo recém-criado
 * abre sem etapa nenhuma, e a única porta era o editor de seis abas, uma vez
 * por etapa. A linha "Adicionar nova etapa" fica no **topo** da tabela — e não
 * no fim — pelo motivo do modelo do pedido: é uma ação, e uma ação que só
 * aparece depois de rolar duzentas linhas é uma ação que ninguém acha.
 *
 * Ela oferece exatamente as seis colunas que a célula sabe gravar, `Enter`
 * cadastra e o campo do nome volta a receber foco já limpo: anotar as treze
 * etapas de uma reunião é digitar treze vezes, sem tirar a mão do teclado. E,
 * como todo o resto desta tela, ela **não grava** — monta o que foi digitado e
 * chama `onCriarEtapa`, que é da página.
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
  onCriarEtapa,
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

  /*
    Cadastrar exige as duas coisas: uma página que saiba gravar e a edição
    liberada. Em modo de leitura a linha some — e não fica desabilitada —, pelo
    mesmo motivo de as células não abrirem: um convite morto na primeira linha
    da tabela sugere que a tela grava quando ela não grava.
  */
  const podeCadastrar = Boolean(onCriarEtapa) && !somenteLeitura;

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
            {podeCadastrar && (
              <LinhaNova
                catalogo={catalogo}
                etapas={completo.etapas}
                areas={areas}
                responsaveis={responsaveis}
                sistemas={sistemas}
                colunas={COLUNAS.length + 3}
                aoCriar={onCriarEtapa!}
              />
            )}
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
            {linhas.length === 0
              ? podeCadastrar
                ? "Nenhuma etapa ainda. Adicione a primeira acima."
                : "Este fluxo ainda não tem etapas."
              : "Nenhuma etapa atende a este recorte."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A LINHA NOVA — cadastrar a etapa sem sair da tabela.
 *
 * Fechada, é uma linha só com um convite; aberta, é a linha da tabela com os
 * campos no lugar das colunas — a mesma ordem, a mesma largura, a mesma coluna
 * escondida quando a tela é estreita. O alinhamento não é enfeite: é o que faz
 * quem digita saber que o que está preenchendo é "Área", sem ler rótulo nenhum.
 *
 * **O que ela oferece é exatamente o que a Lista sabe gravar.** Descrição,
 * objetivo, regras, indicadores e as listas de itens continuam no editor da
 * etapa — oferecê-los aqui faria a linha virar o formulário de seis abas
 * deitado, que é justamente o que este caminho existe para evitar. A etapa
 * nasce com o essencial e cresce no painel, quando (e se) precisar.
 *
 * `Enter` cadastra e deixa a linha aberta com o nome já em foco: quem chegou da
 * reunião com treze etapas digita treze vezes seguidas. `Esc` fecha. O tipo
 * repete o da última cadastrada, menos o "Início", que vira "Processo" — um
 * fluxo tem um começo, e não treze.
 *
 * Ela **não grava**: monta o objeto e chama `aoCriar`, que é da página. Se a
 * gravação falhar, o que foi digitado continua nos campos com a frase do
 * servidor embaixo — perder as seis colunas por causa de um erro de rede é o
 * jeito mais rápido de alguém voltar a cadastrar pelo formulário.
 */
function LinhaNova({
  catalogo,
  etapas,
  areas,
  responsaveis,
  sistemas,
  colunas,
  aoCriar,
}: {
  catalogo: PropsDaVisao["catalogo"];
  etapas: PropsDaVisao["completo"]["etapas"];
  areas: string[];
  responsaveis: string[];
  sistemas: string[];
  /** Quantas colunas a tabela tem — para a linha fechada atravessar todas. */
  colunas: number;
  aoCriar: (nova: EtapaNovaNaLista) => Promise<void>;
}) {
  const listaDeAreas = useId();
  const listaDeResponsaveis = useId();
  const listaDeSistemas = useId();

  const [aberta, setAberta] = useState(false);
  const [nova, setNova] = useState<EtapaNovaNaLista>(() => etapaNovaVazia(etapas));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoDoNome = useRef<HTMLInputElement>(null);

  const trocar = (parcial: Partial<EtapaNovaNaLista>) =>
    setNova((atual) => ({ ...atual, ...parcial }));

  const fechar = () => {
    setAberta(false);
    setErro(null);
    setNova(etapaNovaVazia(etapas));
  };

  const criar = async () => {
    if (salvando || !podeCriarEtapaNaLista(nova)) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoCriar({ ...nova, nome: nova.nome.trim() });
      /*
        Os campos voltam ao vazio, o tipo permanece (menos o Início, que é um
        por fluxo) e o foco volta para o nome: a próxima etapa começa a ser
        digitada onde a anterior terminou de ser gravada.
      */
      setNova({
        nome: "",
        tipo: nova.tipo === "INICIO" ? "PROCESSO" : nova.tipo,
        area: "",
        responsavel: "",
        sistema: "",
        sla: "",
      });
      campoDoNome.current?.focus();
    } catch (falha) {
      setErro(fraseDoErro(falha));
    } finally {
      setSalvando(false);
    }
  };

  const aoTeclar = (evento: React.KeyboardEvent) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      void criar();
      return;
    }
    if (evento.key === "Escape") {
      evento.preventDefault();
      fechar();
    }
  };

  if (!aberta) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colunas} className="p-0">
          <button
            type="button"
            data-testid="abrir-linha-nova"
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-primary hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => {
              setNova(etapaNovaVazia(etapas));
              setAberta(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar nova etapa
          </button>
        </TableCell>
      </TableRow>
    );
  }

  const campo = (
    rotulo: string,
    valor: string,
    aoMudar: (v: string) => void,
    opcoes?: { lista?: string; placeholder?: string; referencia?: boolean },
  ) => (
    <Input
      ref={opcoes?.referencia ? campoDoNome : undefined}
      autoFocus={opcoes?.referencia}
      className="h-8"
      aria-label={rotulo}
      placeholder={opcoes?.placeholder}
      list={opcoes?.lista}
      readOnly={salvando}
      value={valor}
      onChange={(evento) => aoMudar(evento.target.value)}
      onKeyDown={aoTeclar}
    />
  );

  return (
    <>
      <TableRow className="bg-accent/30 hover:bg-accent/30">
        <TableCell className="text-center text-muted-foreground">
          <Plus className="mx-auto h-3.5 w-3.5" aria-hidden />
        </TableCell>
        <TableCell className="px-2 py-2">
          {campo("Nome da nova etapa", nova.nome, (v) => trocar({ nome: v }), {
            placeholder: "Nome da etapa",
            referencia: true,
          })}
        </TableCell>
        <TableCell className="hidden px-2 py-2 lg:table-cell">
          <Select value={nova.tipo} onValueChange={(v) => trocar({ tipo: v })}>
            <SelectTrigger className="h-8" aria-label="Tipo da nova etapa">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(catalogo?.tiposDeEtapa ?? []).map((t) => (
                <SelectItem key={t.valor} value={t.valor}>
                  {t.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="hidden px-2 py-2 md:table-cell">
          {campo("Área da nova etapa", nova.area, (v) => trocar({ area: v }), {
            lista: listaDeAreas,
            placeholder: "Fiscal",
          })}
          <datalist id={listaDeAreas}>
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </TableCell>
        <TableCell className="hidden px-2 py-2 lg:table-cell">
          {campo("Responsável pela nova etapa", nova.responsavel, (v) => trocar({ responsavel: v }), {
            lista: listaDeResponsaveis,
            placeholder: "Analista fiscal",
          })}
          <datalist id={listaDeResponsaveis}>
            {responsaveis.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </TableCell>
        <TableCell className="hidden px-2 py-2 lg:table-cell">
          {campo("Sistema da nova etapa", nova.sistema, (v) => trocar({ sistema: v }), {
            lista: listaDeSistemas,
            placeholder: "Rodopar",
          })}
          <datalist id={listaDeSistemas}>
            {sistemas.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </TableCell>
        <TableCell className="hidden px-2 py-2 xl:table-cell">
          {campo("Prazo (SLA) da nova etapa", nova.sla, (v) => trocar({ sla: v }), {
            placeholder: "24 h úteis",
          })}
        </TableCell>
        {/*
          Entrada e saída ficam em branco de propósito: elas saem do grafo, e
          quem acabou de nascer ainda não foi ligado a ninguém. A ligação com a
          etapa anterior é feita pela página, na gravação.
        */}
        <TableCell className="hidden xl:table-cell" />
        <TableCell className="hidden xl:table-cell" />
        <TableCell className="px-2 py-2">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              className="h-8 w-8"
              aria-label="Cadastrar a etapa"
              disabled={salvando || !podeCriarEtapaNaLista(nova)}
              onClick={() => void criar()}
            >
              {salvando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Cancelar a nova etapa"
              disabled={salvando}
              onClick={fechar}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {erro && (
        <TableRow className="bg-accent/30 hover:bg-accent/30">
          <TableCell colSpan={colunas} className="px-4 pb-2 pt-0 text-xs text-destructive">
            {erro}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * A CÉLULA QUE EDITA — e as quatro coisas que ela não faz.
 *
 * Ela **não grava**: chama `aoGravar` e espera a promessa, que é da página.
 * Ela **não desiste do que foi digitado** quando a gravação falha: o texto
 * continua na célula, com a frase do servidor embaixo — perder a digitação por
 * causa de um erro de rede é o jeito mais rápido de alguém parar de confiar na
 * tela. Ela **não grava o que não mudou**: sair de uma célula sem tocar em nada
 * é o gesto mais comum de quem está lendo a tabela, e ele não pode virar uma
 * escrita no servidor. E ela **não grava duas vezes**.
 *
 * ---------------------------------------------------------------------------
 * A gravação dupla, que é o defeito não óbvio deste componente
 * ---------------------------------------------------------------------------
 *
 * `Enter` grava e fecha o campo; fechar o campo tira o foco dele; tirar o foco
 * dispara o `blur`, que também grava. São duas requisições para uma edição — e,
 * pior, duas com o mesmo corpo montado a partir de um cache que a primeira
 * ainda não atualizou. A trava é a `travada`, uma referência (e não estado,
 * porque precisa valer **dentro** do mesmo evento, antes de qualquer
 * renderização) que fecha a sessão de edição na primeira gravação e só reabre
 * quando alguém entra na célula de novo. `Esc` também tranca: desistir e
 * escapar do campo não pode acabar gravando pelo `blur`.
 *
 * ---------------------------------------------------------------------------
 * Enter, Tab, Esc — a convenção de planilha
 * ---------------------------------------------------------------------------
 *
 * `Enter` grava e fica. `Tab` grava e abre a **próxima célula editável**, que é
 * o que faz preencher uma linha inteira ser digitar, e não clicar sete vezes;
 * `Shift+Tab` faz o caminho de volta. `Esc` desiste e restaura exatamente o que
 * estava lá. Sair do campo com o mouse grava, porque quem digita e clica na
 * linha de baixo esperava ter gravado.
 *
 * Com `Tab`, o foco vai embora na hora e a gravação segue por baixo: esperar a
 * resposta do servidor para liberar a próxima célula transformaria uma linha de
 * sete campos em sete esperas. A célula que ficou para trás mostra o giro e,
 * se falhar, fica com o texto digitado e a frase do erro à vista — sem puxar o
 * foco de volta no meio da digitação.
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
  const [estado, setEstado] = useState(() => celulaEmRepouso(edicao.valor));
  /*
    O estado também vive numa referência, e não é redundância: a trava contra a
    gravação dupla precisa valer **dentro** do mesmo evento — o `blur` que o
    `Enter` provoca acontece antes de qualquer renderização, e um estado de
    React ainda seria o antigo quando ele chegasse aqui.
  */
  const atual = useRef(estado);

  const despachar = (acao: AcaoDaCelula): string | null => {
    const passo = reduzirCelula(atual.current, acao);
    atual.current = passo.estado;
    setEstado(passo.estado);
    return passo.gravar;
  };

  /* O valor gravado mudou por fora, ou a recarga trouxe o que acabou de sair. */
  useEffect(() => {
    despachar({ tipo: "sincronizar", valorGravado: edicao.valor });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `despachar` é estável por construção: lê e escreve a mesma referência.
  }, [edicao.valor]);

  const confirmar = async (saindo: boolean) => {
    const aGravar = despachar({ tipo: "confirmar", valorGravado: edicao.valor, saindo });
    if (aGravar === null) return;
    try {
      await aoGravar(aGravar);
      despachar({ tipo: "gravou", valor: aGravar });
    } catch (falha) {
      despachar({ tipo: "falhou", frase: fraseDoErro(falha), saindo });
    }
  };

  const { editando, rascunho, salvando, erro, salvo } = estado;

  if (!editando) {
    /*
      O que a célula fechada mostra, em ordem de precedência: o texto que falhou
      (para não sumir com o que foi digitado), o texto que está sendo gravado
      neste instante, o que acabou de ser gravado enquanto a recarga não chega,
      e por fim o valor do fluxo. Sem os dois do meio, a célula voltaria a
      mostrar o valor **antigo** durante a gravação — tempo mais que suficiente
      para alguém achar que não pegou e digitar tudo de novo.
    */
    const pendente = erro !== null || salvando ? rascunho : salvo;
    const conteudo =
      pendente === null
        ? (exibido ?? vazio ?? <SemDado />)
        : pendente.trim() === ""
          ? (vazio ?? <SemDado />)
          : pendente;

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
        data-celula-editavel="texto"
        aria-label={`Editar ${rotulo}`}
        title={erro ?? "Clique para editar"}
        className="group flex w-full items-center gap-1.5 rounded px-4 py-4 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(evento) => {
          evento.stopPropagation();
          despachar({ tipo: "abrir" });
        }}
      >
        <span className="min-w-0 flex-1">
          <span className={cn(erro && "text-destructive")}>{conteudo}</span>
          {erro && <span className="mt-0.5 block text-xs text-destructive">{erro}</span>}
        </span>
        {salvando ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Pencil
            className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </button>
    );
  }

  return (
    <div
      data-celula-editavel="texto"
      className="rounded-sm px-2 py-2 ring-2 ring-inset ring-ring"
      onClick={(evento) => evento.stopPropagation()}
    >
      <div className="relative">
        <Input
          autoFocus
          className="h-8 bg-background"
          aria-label={rotulo}
          list={sugestoes.length > 0 ? listaId : undefined}
          placeholder={placeholder}
          readOnly={salvando}
          value={rascunho}
          onChange={(evento) => despachar({ tipo: "digitar", valor: evento.target.value })}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault();
              void confirmar(false);
              return;
            }
            if (evento.key === "Escape") {
              evento.preventDefault();
              despachar({ tipo: "cancelar", valorGravado: edicao.valor });
              return;
            }
            if (evento.key === "Tab") {
              /*
                O alvo é procurado **antes** de segurar o evento: sem próxima
                célula, o `Tab` continua sendo o `Tab` do navegador, e o foco
                sai da tabela como em qualquer outra tela.
              */
              const alvo = celulaVizinha(evento.currentTarget, evento.shiftKey ? -1 : 1);
              if (alvo) evento.preventDefault();
              void confirmar(true);
              /*
                A célula de texto abre já digitável; a de escolha só recebe o
                foco. Abrir um menu suspenso por causa de um `Tab` prenderia o
                foco dentro dele e acabaria com a corrida da linha — `Enter`
                abre, que é o que se espera de um seletor.
              */
              if (alvo?.dataset.celulaEditavel === "escolha") alvo.focus();
              else alvo?.click();
            }
          }}
          onBlur={() => void confirmar(true)}
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
 * A vizinha editável na ordem da tabela — a parte que se prova sem DOM.
 *
 * A ordem do `Tab` não é uma lista mantida à mão: é a ordem em que as células
 * estão no documento, que é a ordem em que a pessoa as lê. Só entra quem marca
 * `data-celula-editavel`, e só quem marca é célula que edita de verdade — a
 * coluna escondida pelo tamanho da tela sai pelo filtro de visibilidade, e
 * entrada, saída e sinais nunca entraram.
 */
export function vizinhaNaOrdem<T>(celulas: T[], atual: T, passo: 1 | -1): T | null {
  const indice = celulas.indexOf(atual);
  if (indice < 0) return null;
  const alvo = indice + passo;
  return alvo >= 0 && alvo < celulas.length ? celulas[alvo] : null;
}

function celulaVizinha(campo: HTMLElement, passo: 1 | -1): HTMLElement | null {
  const atual = campo.closest<HTMLElement>("[data-celula-editavel]");
  const tabela = campo.closest("table");
  if (!atual || !tabela) return null;
  const celulas = [...tabela.querySelectorAll<HTMLElement>("[data-celula-editavel]")].filter(
    /* A coluna que o tamanho da tela escondeu não é destino de Tab nenhum. */
    (elemento) => elemento === atual || elemento.offsetParent !== null,
  );
  return vizinhaNaOrdem(celulas, atual, passo);
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
  /* O mesmo motivo do texto: refletir a escolha antes de a recarga chegar. */
  const [salvo, setSalvo] = useState<string | null>(null);
  const gatilho = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (salvo !== null && salvo === valor) setSalvo(null);
  }, [salvo, valor]);

  /*
    Fechado o seletor, o foco volta para a célula — sem isto ele cai no corpo do
    documento e a próxima tecla não tem onde acontecer.

    A referência guarda se ele **estava** aberto, e não é detalhe: sem ela, o
    efeito rodaria na primeira renderização de todas as células e a última da
    tabela puxaria o foco para si assim que a tela abrisse.
  */
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (!editando && estavaAberto.current) gatilho.current?.focus({ preventScroll: true });
    estavaAberto.current = editando;
  }, [editando]);

  const rotuloDe = (v: string) => opcoes.find((o) => o.valor === v)?.rotulo ?? v;
  const aVista = salvo !== null ? rotuloDe(salvo) : exibido;

  if (bloqueado || opcoes.length === 0) {
    return <span className="block px-4 py-4">{aVista}</span>;
  }

  if (!editando) {
    return (
      <button
        ref={gatilho}
        type="button"
        data-celula-editavel="escolha"
        aria-label={`Editar ${rotulo}`}
        title={erro ?? "Clique para editar"}
        className="group flex w-full items-center gap-1.5 rounded px-4 py-4 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(evento) => {
          evento.stopPropagation();
          setEditando(true);
        }}
      >
        <span className={cn("min-w-0 flex-1 truncate", erro && "text-destructive")}>{aVista}</span>
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
    <div
      data-celula-editavel="escolha"
      className="rounded-sm px-2 py-2 ring-2 ring-inset ring-ring"
      onClick={(evento) => evento.stopPropagation()}
    >
      <Select
        open
        value={valor}
        onValueChange={(novo) => {
          setEditando(false);
          if (novo === valor) return;
          setSalvando(true);
          setErro(null);
          aoGravar(novo)
            .then(() => setSalvo(novo))
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
