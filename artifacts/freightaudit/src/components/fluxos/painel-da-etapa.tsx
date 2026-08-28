import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  FileText,
  Gauge,
  GitBranch,
  Hourglass,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Scale,
  Search,
  Server,
  Timer,
  Trash2,
  Unlink,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  enderecoDaAcao,
  itensPorEspecie,
  type Catalogo,
  type Etapa,
  type ResumoDeSubfluxo,
} from "@/lib/fluxos";
import {
  CAMPOS_DO_PAINEL,
  camposVaziosDoPainel,
  severidadeNoCatalogo,
  valorDoCampo,
  type CampoDaEtapaNoPainel,
  type CampoDeEscolhaDaEtapa,
  type CampoDeTextoDaEtapa,
  type CampoDoPainel,
  type DiagnosticoDaEtapa,
} from "@/lib/fluxos-analise";

/**
 * O PAINEL DA ETAPA — tudo o que o cartão não mostra, sem perder o fluxo de vista.
 *
 * É uma coluna à direita, e não um diálogo modal, de propósito: a pergunta que
 * este módulo responde é "como este processo funciona", e ler o detalhe de uma
 * etapa com o desenho tapado é ler fora de contexto. Com a coluna, o fluxograma
 * continua ali ao lado, e clicar em outro cartão troca o conteúdo do painel sem
 * fechar nada.
 *
 * A ordem das seções é a ordem das perguntas de quem está investigando um
 * processo: o que acontece aqui → quem faz → com o quê → o que manda → o que
 * costuma dar errado → o que trava → o que mediríamos → onde eu olho isso no
 * FreightCheck. A última é a que transforma um documento num mapa navegável.
 *
 * ---------------------------------------------------------------------------
 * Um painel só, para as seis visualizações
 * ---------------------------------------------------------------------------
 *
 * Fluxo, Raias, Jornada, Mapa, Lista e Gargalos abrem **este** componente. Não
 * existe um detalhe por visualização, e essa é a decisão que impede a
 * divergência futura: um painel por aba seria seis lugares para lembrar de
 * acrescentar um campo novo, e cinco lugares para esquecer.
 *
 * A única coisa que varia é o `diagnostico`, que a visualização de Gargalos
 * passa e as outras não — a resposta a "por que esta etapa está destacada?",
 * escrita com os sinais que a análise de fato encontrou.
 *
 * **Seção sem conteúdo não aparece.** Nem como título vazio, nem como "nenhum
 * item cadastrado": num painel com oito seções, sete avisos de vazio afogam o
 * que existe. O convite a cadastrar está no botão de editar, no cabeçalho.
 */

const ICONES: Record<string, typeof Server> = {
  Server,
  FileText,
  Users,
  AlertTriangle,
  Hourglass,
  Scale,
  Gauge,
  Search,
  Timer,
  Workflow,
};

function Secao({
  titulo,
  icone,
  children,
}: {
  titulo: string;
  icone?: string;
  children: React.ReactNode;
}) {
  const Icone = icone ? (ICONES[icone] ?? null) : null;
  return (
    <section className="px-5 py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {Icone && <Icone className="h-3.5 w-3.5" />}
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** Um bloco de texto livre cadastrado — preserva as quebras de linha. */
function Texto({ children }: { children: string }) {
  return <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{children}</p>;
}

/**
 * A EDIÇÃO NO LUGAR — por que ela existe ao lado do editor, e não no lugar dele.
 *
 * O painel é onde se lê a etapa; era só onde se lia. Corrigir uma palavra do
 * objetivo custava abrir um formulário de seis abas por cima do desenho, achar
 * a aba, corrigir, salvar e esperar fechar — cinco gestos, e o fluxograma
 * tapado no meio deles. Aqui o mesmo campo se corrige onde ele já está escrito.
 *
 * O editor completo **continua**: é ele que cadastra as listas (sistemas,
 * responsáveis, documentos, prazos, indicadores, ações), que troca tipo e
 * status, e que serve para preencher uma etapa inteira de uma vez. A edição no
 * lugar é para a correção pontual, que é o gesto mais comum depois que o
 * processo já está levantado.
 *
 * Três decisões que valem a explicação:
 *
 * - **Gravar é explícito.** Nada é gravado ao sair do campo. Um blur que grava
 *   transforma "cliquei fora sem querer" em escrita, e num painel que troca de
 *   conteúdo a cada clique num cartão isso aconteceria o tempo todo.
 * - **A falha mantém o que foi digitado.** A promessa de gravação vem crua de
 *   quem chamou; quando ela é recusada, o texto continua na tela com a frase do
 *   servidor embaixo. Perder o texto e voltar ao valor antigo, sem explicação,
 *   é o pior desfecho possível de uma edição.
 * - **Sem mudança, sem escrita.** Abrir e fechar sem alterar nada não manda
 *   `PUT` nenhum, porque a rota é substituição do corpo inteiro: uma gravação à
 *   toa é uma chance à toa de sobrescrever o que outra pessoa acabou de mudar.
 */
function EdicaoDeCampo({
  rotulo,
  valor,
  multilinha,
  aoSalvar,
  aoFechar,
}: {
  rotulo: string;
  valor: string;
  multilinha: boolean;
  aoSalvar: (valor: string) => Promise<void>;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState(valor);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = () => {
    if (gravando) return;
    if (texto.trim() === valor.trim()) {
      aoFechar();
      return;
    }
    setGravando(true);
    setErro(null);
    aoSalvar(texto.trim())
      .then(() => aoFechar())
      .catch((falha: unknown) => {
        setGravando(false);
        setErro(falha instanceof Error ? falha.message : "Não foi possível gravar este campo.");
      });
  };

  /*
    Esc e Enter param aqui (`stopPropagation`): no celular o painel é uma
    gaveta, e um Esc que sobe fecha a gaveta inteira em vez de cancelar a
    edição — a pessoa perderia o texto por um gesto que pediu o contrário.
  */
  const aoTeclar = (evento: React.KeyboardEvent) => {
    if (evento.key === "Escape") {
      evento.stopPropagation();
      aoFechar();
      return;
    }
    if (evento.key === "Enter" && (!multilinha || evento.ctrlKey || evento.metaKey)) {
      evento.preventDefault();
      evento.stopPropagation();
      gravar();
    }
  };

  const comuns = {
    autoFocus: true,
    value: texto,
    disabled: gravando,
    onKeyDown: aoTeclar,
    "aria-label": rotulo,
    onChange: (e: { target: { value: string } }) => setTexto(e.target.value),
  };

  return (
    <div className="space-y-2">
      {multilinha ? (
        <Textarea rows={4} className="text-sm" {...comuns} />
      ) : (
        <Input className="h-8 text-sm" {...comuns} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-7" onClick={gravar} disabled={gravando}>
          {gravando ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={aoFechar} disabled={gravando}>
          Cancelar
        </Button>
        <span className="text-[11px] text-muted-foreground/70">
          {multilinha ? "Ctrl+Enter grava · Esc cancela" : "Enter grava · Esc cancela"}
        </span>
      </div>
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}

/**
 * O alvo de clique de um campo já preenchido.
 *
 * O texto inteiro é o botão, e não um lápis de 12px ao lado: o gesto que a
 * pessoa já faz é apontar para a frase errada. O lápis aparece mesmo assim,
 * porque sem nenhuma marca ninguém descobre que o texto é clicável — no toque
 * ele fica visível, no ponteiro só quando o cursor passa por cima.
 */
function AlvoDeEdicao({
  rotulo,
  aoAbrir,
  children,
}: {
  rotulo: string;
  aoAbrir: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`Editar ${rotulo}`}
      className="group -mx-1.5 flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">{children}</span>
      <Pencil
        aria-hidden
        className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
      />
    </button>
  );
}

/**
 * UMA ESCOLHA DE CATÁLOGO EM FORMA DE ETIQUETA.
 *
 * A etiqueta continua sendo etiqueta — mesmo tamanho, mesma cor, mesmo lugar —
 * e ganha uma seta. Trocá-la por um `<select>` de formulário no cabeçalho
 * mudaria a leitura do painel em modo edição para todo mundo que só queria
 * olhar: o cabeçalho é o cartão da etapa, e ele deve continuar parecendo um.
 *
 * A escolha grava na hora, sem confirmar. É uma lista fechada de três ou quatro
 * valores, e escolher de novo desfaz — o "Salvar" que existe nos campos de
 * texto está lá porque ali o que se perde é o que foi digitado, e aqui não há o
 * que perder.
 */
function EscolhaEmBadge({
  rotulo,
  exibido,
  variante,
  opcoes,
  valorAtual,
  gravando,
  aoEscolher,
}: {
  rotulo: string;
  exibido: string;
  variante: "secondary" | "destructive" | "outline";
  opcoes: { valor: string; rotulo: string }[];
  valorAtual: string;
  gravando: boolean;
  aoEscolher: (valor: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Trocar ${rotulo}`}
          disabled={gravando}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={variante} className="cursor-pointer gap-1 pr-1.5 font-normal">
            {exibido}
            {gravando ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ChevronDown className="h-3 w-3 opacity-70" />
            )}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[10rem]">
        {opcoes.map((opcao) => (
          <DropdownMenuItem
            key={opcao.valor}
            onSelect={() => aoEscolher(opcao.valor)}
            className="gap-2"
          >
            <Check
              aria-hidden
              className={cn("h-3.5 w-3.5", opcao.valor === valorAtual ? "opacity-100" : "opacity-0")}
            />
            {opcao.rotulo}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PainelDaEtapa({
  etapa,
  catalogo,
  podeEditar,
  diagnostico,
  onEditar,
  onSalvarCampo,
  onSeguinte,
  onExcluir,
  onFechar,
  subfluxo,
  onDetalhar,
  onDesligarSubfluxo,
  detalhando,
}: {
  etapa: Etapa;
  catalogo: Catalogo | undefined;
  podeEditar: boolean;
  /** Só a visualização de Gargalos passa: por que esta etapa está destacada. */
  diagnostico?: DiagnosticoDaEtapa;
  onEditar: () => void;
  /**
   * Grava **um** campo de texto da etapa, sem passar pelo editor.
   *
   * A promessa é devolvida crua, rejeição inclusive: é o que permite o campo
   * manter o que foi digitado e mostrar a frase do servidor. Ausente, o painel
   * é só de leitura — é o que as visualizações que ainda não gravam recebem, e
   * o que os testes montam quando o assunto é o que o painel mostra.
   */
  onSalvarCampo?: (campo: CampoDaEtapaNoPainel, valor: string) => Promise<void>;
  /** Cria a próxima etapa **já ligada** a esta. */
  onSeguinte: () => void;
  onExcluir: () => void;
  onFechar: () => void;
  /** O fluxo que detalha esta etapa, quando existe. */
  subfluxo?: ResumoDeSubfluxo | null;
  /** Cria o fluxo do detalhe, já ligado. Ausente, a seção não convida a criar. */
  onDetalhar?: () => void;
  /** Desfaz a ligação — o fluxo do detalhe continua existindo. */
  onDesligarSubfluxo?: () => void;
  detalhando?: boolean;
}) {
  const tipo = catalogo?.tiposDeEtapa.find((t) => t.valor === etapa.tipo);
  const status = catalogo?.statusDaEtapa.find((s) => s.valor === etapa.status);
  const grupos = itensPorEspecie(etapa, catalogo?.especiesDeItem ?? []);

  /*
    Um campo aberto por vez, e o `null` ao trocar de etapa.

    Sem o `useEffect`, clicar em outro cartão com o objetivo aberto deixaria o
    campo aberto — só que já com o texto da etapa nova por baixo e o da antiga
    dentro do `input`, e o Salvar gravaria um na outra.
  */
  const [emEdicao, setEmEdicao] = useState<CampoDeTextoDaEtapa | null>(null);
  /* A escolha de catálogo grava sem formulário: o que se guarda é qual está no ar. */
  const [escolhendo, setEscolhendo] = useState<CampoDeEscolhaDaEtapa | null>(null);
  const [erroDaEscolha, setErroDaEscolha] = useState<string | null>(null);
  useEffect(() => {
    setEmEdicao(null);
    setErroDaEscolha(null);
  }, [etapa.id]);

  const editavel = podeEditar && onSalvarCampo !== undefined;

  const escolher = (campo: CampoDeEscolhaDaEtapa, valor: string) => {
    /* Escolher o que já está gravado não é edição — e a rota é substituição. */
    if (!onSalvarCampo || valor === (campo === "tipo" ? etapa.tipo : etapa.status)) return;
    setEscolhendo(campo);
    setErroDaEscolha(null);
    onSalvarCampo(campo, valor)
      .catch((falha: unknown) =>
        setErroDaEscolha(
          falha instanceof Error ? falha.message : `Não foi possível trocar o ${campo}.`,
        ),
      )
      .finally(() => setEscolhendo(null));
  };
  const vazios = editavel ? camposVaziosDoPainel(etapa) : [];

  /**
   * Uma seção de texto do painel — de leitura, clicável ou aberta para edição.
   *
   * A seção continua sumindo quando está vazia (a regra do painel inteiro), com
   * uma exceção: quando é ela que está sendo preenchida pela lista do rodapé.
   * Sem a exceção, clicar em "Objetivo da etapa" lá embaixo não teria onde
   * abrir o campo.
   */
  const secaoDeTexto = (campo: CampoDeTextoDaEtapa, icone?: string) => {
    const definicao = CAMPOS_DO_PAINEL.find((c) => c.campo === campo)!;
    const valor = valorDoCampo(etapa, campo);

    if (editavel && emEdicao === campo) {
      return (
        <Secao titulo={definicao.rotulo} icone={icone}>
          <EdicaoDeCampo
            rotulo={definicao.rotulo}
            valor={valor}
            multilinha={definicao.multilinha}
            aoSalvar={(texto) => onSalvarCampo!(campo, texto)}
            aoFechar={() => setEmEdicao(null)}
          />
        </Secao>
      );
    }

    if (valor.trim() === "") return null;

    return (
      <Secao titulo={definicao.rotulo} icone={icone}>
        {editavel ? (
          <AlvoDeEdicao rotulo={definicao.rotulo} aoAbrir={() => setEmEdicao(campo)}>
            <Texto>{valor}</Texto>
          </AlvoDeEdicao>
        ) : (
          <Texto>{valor}</Texto>
        )}
      </Secao>
    );
  };

  return (
    <aside
      className="flex h-full w-full flex-col overflow-y-auto border-l bg-card"
      aria-label={`Detalhes da etapa ${etapa.nome}`}
    >
      <header className="sticky top-0 z-10 border-b bg-card px-5 py-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {editavel && emEdicao === "nome" ? (
              <EdicaoDeCampo
                rotulo="Nome da etapa"
                valor={etapa.nome}
                multilinha={false}
                aoSalvar={(texto) => onSalvarCampo!("nome", texto)}
                aoFechar={() => setEmEdicao(null)}
              />
            ) : editavel ? (
              <AlvoDeEdicao rotulo="Nome da etapa" aoAbrir={() => setEmEdicao("nome")}>
                <h2 className="text-base font-semibold leading-snug text-foreground">
                  {etapa.nome}
                </h2>
              </AlvoDeEdicao>
            ) : (
              <h2 className="text-base font-semibold leading-snug text-foreground">{etapa.nome}</h2>
            )}
            {/*
              TIPO E STATUS — as duas etiquetas que agora também se trocam aqui.

              Em leitura, o status só aparece quando **não** é "Ativa": um
              selo "Ativa" repetido em toda etapa não informa nada. Em edição
              ele aparece sempre, porque uma etiqueta que só existe depois de
              mudada não tem por onde ser mudada — e o catálogo em falta
              devolve as duas para leitura, já que sem ele não há lista de
              opções para oferecer.
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {editavel && catalogo ? (
                <>
                  <EscolhaEmBadge
                    rotulo="tipo da etapa"
                    exibido={tipo?.rotulo ?? etapa.tipo}
                    variante="secondary"
                    opcoes={catalogo.tiposDeEtapa}
                    valorAtual={etapa.tipo}
                    gravando={escolhendo === "tipo"}
                    aoEscolher={(valor) => escolher("tipo", valor)}
                  />
                  <EscolhaEmBadge
                    rotulo="status da etapa"
                    exibido={status?.rotulo ?? etapa.status}
                    variante={etapa.status === "ATENCAO" ? "destructive" : "outline"}
                    opcoes={catalogo.statusDaEtapa}
                    valorAtual={etapa.status}
                    gravando={escolhendo === "status"}
                    aoEscolher={(valor) => escolher("status", valor)}
                  />
                </>
              ) : (
                <>
                  <Badge variant="secondary" className="font-normal">
                    {tipo?.rotulo ?? etapa.tipo}
                  </Badge>
                  {etapa.status !== "ATIVO" && (
                    <Badge
                      variant={etapa.status === "ATENCAO" ? "destructive" : "outline"}
                      className="font-normal"
                    >
                      {status?.rotulo ?? etapa.status}
                    </Badge>
                  )}
                </>
              )}
            </div>
            {erroDaEscolha && <p className="mt-1 text-xs text-destructive">{erroDaEscolha}</p>}
            {/*
              ÁREA E RESPONSÁVEL FICAM NO CABEÇALHO — e é lá que se corrigem.

              As duas não têm seção própria no corpo do painel: são a legenda
              do título, e é assim que se leem. Por isso cada uma é o seu
              próprio alvo de clique aqui, e por isso elas não aparecem na
              lista do rodapé — quem quer preencher a área encontra o convite
              onde a área seria lida, e não numa lista lá embaixo.
            */}
            {editavel && (emEdicao === "area" || emEdicao === "responsavel") ? (
              <div className="mt-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {emEdicao === "area" ? "Área" : "Responsável"}
                </p>
                <EdicaoDeCampo
                  rotulo={emEdicao === "area" ? "Área" : "Responsável"}
                  valor={valorDoCampo(etapa, emEdicao)}
                  multilinha={false}
                  aoSalvar={(texto) => onSalvarCampo!(emEdicao, texto)}
                  aoFechar={() => setEmEdicao(null)}
                />
              </div>
            ) : editavel ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                {(["area", "responsavel"] as const).map((campo, indice) => {
                  const rotulo = campo === "area" ? "Área" : "Responsável";
                  const valor = valorDoCampo(etapa, campo).trim();
                  return (
                    <span key={campo} className="flex items-center gap-1">
                      {indice === 1 && <span aria-hidden>·</span>}
                      <button
                        type="button"
                        onClick={() => setEmEdicao(campo)}
                        aria-label={`Editar ${rotulo}`}
                        className="rounded px-1 py-0.5 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {valor === "" ? (
                          <span className="text-muted-foreground/60">{`+ ${rotulo.toLowerCase()}`}</span>
                        ) : (
                          valor
                        )}
                      </button>
                    </span>
                  );
                })}
              </p>
            ) : (
              (etapa.area || etapa.responsavel) && (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {[etapa.area, etapa.responsavel].filter(Boolean).join(" · ")}
                </p>
              )
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onFechar} aria-label="Fechar o painel">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {podeEditar && (
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={onEditar}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar etapa
            </Button>
            {/*
              "Etapa seguinte" cria e liga num gesto só.

              Sem ele, acrescentar um passo no fim do processo é: abrir o
              diálogo pelo cabeçalho, preencher, fechar, achar o cartão novo no
              canvas (ele nasce onde couber), arrastar da borda de um até a
              borda do outro. São cinco atos para dizer "e depois disto vem
              aquilo", que é a frase mais comum de quem levanta um processo.
            */}
            <Button variant="outline" size="sm" onClick={onSeguinte}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Etapa seguinte
            </Button>
            <Button variant="ghost" size="sm" onClick={onExcluir}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Excluir
            </Button>
          </div>
        )}
      </header>

      <div className="divide-y">
        {/*
          O SUBFLUXO — primeiro no painel, e antes até do diagnóstico.

          Uma etapa que é um processo inteiro por dentro muda o que todo o resto
          significa: "quem responde" e "sistema principal" descrevem a casca, e
          o detalhe está a um clique. Quem abre o painel precisa saber disso
          antes de ler o resto — depois das oito seções, a informação chegaria
          tarde.

          Quando não há detalhe, a seção só existe para quem pode criar: em modo
          de leitura ela sumiria como qualquer outra seção vazia.
        */}
        {(subfluxo || (podeEditar && onDetalhar)) && (
          <Secao titulo="Detalhe desta etapa" icone="Workflow">
            {subfluxo ? (
              <div className="space-y-2">
                <Link
                  href={`/fluxos/${subfluxo.id}`}
                  className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 transition-colors hover:bg-primary/10"
                >
                  <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {subfluxo.nome}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {subfluxo.etapas === 0
                        ? "nenhuma etapa ainda"
                        : `${subfluxo.etapas} ${subfluxo.etapas === 1 ? "etapa" : "etapas"}`}
                      {" · "}
                      {subfluxo.categoria}
                    </span>
                  </span>
                  <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
                {podeEditar && onDesligarSubfluxo && (
                  /*
                    "Desfazer a ligação" e não "excluir": o fluxo do detalhe
                    continua existindo e continua na listagem. Apagar por aqui
                    faria um botão do painel de uma etapa destruir um processo
                    inteiro que pode ter dez etapas escritas.
                  */
                  <Button variant="ghost" size="sm" onClick={onDesligarSubfluxo}>
                    <Unlink className="mr-1.5 h-3.5 w-3.5" />
                    Desfazer a ligação
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Esta etapa cabe num processo próprio? O detalhe nasce com o nome dela, ligado
                  aqui, e é um fluxo como qualquer outro.
                </p>
                <Button variant="outline" size="sm" disabled={detalhando} onClick={onDetalhar}>
                  {detalhando ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Detalhar num subfluxo
                </Button>
              </div>
            )}
          </Secao>
        )}

        {diagnostico && (
          <Secao titulo="Por que esta etapa está destacada?" icone="AlertTriangle">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  severidadeNoCatalogo(diagnostico.severidade).ponto,
                )}
              />
              <span className="text-sm font-medium text-foreground">
                {severidadeNoCatalogo(diagnostico.severidade).rotulo}
              </span>
            </div>
            {diagnostico.sinais.length > 0 ? (
              <ul className="space-y-1">
                {diagnostico.sinais.map((sinal) => (
                  <li key={sinal.chave} className="flex gap-2 text-sm text-foreground">
                    <span aria-hidden className="text-muted-foreground">
                      •
                    </span>
                    {sinal.rotulo}
                  </li>
                ))}
              </ul>
            ) : (
              /*
                Sem sinal e sem cadastro é "dados insuficientes", não "tudo
                certo". A frase é a informação verdadeira, e é ela que diz a
                quem lê o que falta preencher.
              */
              <p className="text-sm text-muted-foreground">
                {diagnostico.severidade === "sem-avaliacao"
                  ? "Dados insuficientes — esta etapa não tem responsável, sistema, prazo nem descrição cadastrados."
                  : "Nenhum sinal encontrado no que está cadastrado."}
              </p>
            )}
          </Secao>
        )}

        {secaoDeTexto("descricao")}

        {secaoDeTexto("objetivo")}

        {secaoDeTexto("sistemaPrincipal", "Server")}

        {grupos.map(({ especie, itens }) => (
          <Secao key={especie.valor} titulo={especie.titulo} icone={especie.icone}>
            <ul className="space-y-2">
              {itens.map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-medium text-foreground">{item.nome}</span>
                    {/*
                      "Obrigatório" só aparece em documento, e só quando é
                      verdade. Um "opcional" etiquetado em cada linha seria
                      ruído: a ausência da etiqueta já diz isso.
                    */}
                    {item.obrigatorio === true && (
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        obrigatório
                      </span>
                    )}
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Abrir ${item.nome}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {item.descricao && (
                    <p className="text-sm text-muted-foreground">{item.descricao}</p>
                  )}
                </li>
              ))}
            </ul>
          </Secao>
        ))}

        {secaoDeTexto("regras", "Scale")}

        {secaoDeTexto("informacoesConsultadas", "Search")}

        {etapa.indicadores.length > 0 && (
          <Secao titulo="Indicadores" icone="Gauge">
            <ul className="space-y-2">
              {etapa.indicadores.map((indicador) => (
                <li key={indicador.id} className="text-sm">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-medium text-foreground">{indicador.nome}</span>
                    {indicador.unidade && (
                      <span className="text-xs text-muted-foreground">({indicador.unidade})</span>
                    )}
                  </div>
                  {indicador.descricao && (
                    <p className="text-sm text-muted-foreground">{indicador.descricao}</p>
                  )}
                  {/*
                    A origem é escrita como frase, e é apresentada como
                    promessa não cumprida de propósito: o indicador ainda é
                    metadado, e mostrá-lo com um número inventado ao lado seria
                    exatamente o que este produto recusa fazer.
                  */}
                  {indicador.origem && (
                    <p className="text-xs text-muted-foreground/80">
                      Fonte prevista: {indicador.origem}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground/70">
              Cadastrados, ainda não calculados — o cálculo vem com o Modo Monitoramento.
            </p>
          </Secao>
        )}

        {secaoDeTexto("observacoes", "AlertTriangle")}

        {etapa.acoes.length > 0 && (
          <Secao titulo="Consultar no FreightCheck">
            <div className="space-y-1.5">
              {etapa.acoes.map((acao) => {
                const endereco = enderecoDaAcao(acao);
                /*
                  Endereço nulo é rota que não é caminho interno. O botão
                  simplesmente não aparece — a alternativa seria oferecer uma
                  navegação que leva a lugar nenhum, e um mapa que mente sobre
                  onde as coisas estão é pior do que um mapa incompleto.
                */
                if (!endereco) return null;
                return (
                  <Button
                    key={acao.id}
                    variant="outline"
                    size="sm"
                    className="h-auto w-full justify-start py-2 text-left"
                    asChild
                  >
                    <Link href={endereco}>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{acao.titulo}</span>
                        {acao.descricao && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {acao.descricao}
                          </span>
                        )}
                      </span>
                      <ArrowUpRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </Button>
                );
              })}
            </div>
          </Secao>
        )}
        {/*
          A chave de monitoramento não tem seção: ela vive no rodapé, junto do
          número da etapa. A seção só existe no instante em que ela está sendo
          editada — assim o campo abre onde os outros abrem, sem ganhar uma
          oitava seção permanente para um identificador técnico.
        */}
        {editavel && emEdicao === "chaveMonitoramento" && secaoDeTexto("chaveMonitoramento")}

        {/*
          O QUE AINDA ESTÁ EM BRANCO — o único lugar onde o painel fala de vazio.

          Seção vazia continua sumindo, e é isso que faz o painel legível. Mas
          uma seção que sumiu não tem onde ser clicada, e a edição no lugar
          deixaria de alcançar justamente o que falta preencher. Uma lista só,
          no fim, resolve os dois: um botão curto por campo em branco, e ela
          encolhe até sumir conforme a etapa é preenchida. Quem não pode editar
          nunca a vê.
        */}
        {vazios.length > 0 && (
          <Secao titulo="Ainda em branco">
            <div className="flex flex-wrap gap-1.5">
              {vazios.map((definicao) => (
                <Button
                  key={definicao.campo}
                  variant="outline"
                  size="sm"
                  className="h-7 font-normal"
                  onClick={() => setEmEdicao(definicao.campo)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {definicao.rotulo}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground/70">
              Preenche aqui mesmo, sem abrir o editor. As listas — sistemas, documentos,
              responsáveis, prazos, indicadores — continuam em "Editar etapa".
            </p>
          </Secao>
        )}
      </div>

      <Separator />
      <p className="px-5 py-3 text-xs text-muted-foreground/70">
        Etapa {etapa.ordem + 1} do processo
        {etapa.chaveMonitoramento && !editavel ? ` · chave ${etapa.chaveMonitoramento}` : ""}
        {etapa.chaveMonitoramento && editavel && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setEmEdicao("chaveMonitoramento")}
              aria-label="Editar Chave de monitoramento"
              className="rounded px-1 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              chave {etapa.chaveMonitoramento}
            </button>
          </>
        )}
      </p>
    </aside>
  );
}
