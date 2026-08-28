import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  FileText,
  Gauge,
  GitBranch,
  Hourglass,
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
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  enderecoDaAcao,
  itensPorEspecie,
  type Catalogo,
  type Etapa,
  type ResumoDeSubfluxo,
} from "@/lib/fluxos";
import { severidadeNoCatalogo, type DiagnosticoDaEtapa } from "@/lib/fluxos-analise";

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

export function PainelDaEtapa({
  etapa,
  catalogo,
  podeEditar,
  diagnostico,
  onEditar,
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

  return (
    <aside
      className="flex h-full w-full flex-col overflow-y-auto border-l bg-card"
      aria-label={`Detalhes da etapa ${etapa.nome}`}
    >
      <header className="sticky top-0 z-10 border-b bg-card px-5 py-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-foreground">{etapa.nome}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
            </div>
            {(etapa.area || etapa.responsavel) && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {[etapa.area, etapa.responsavel].filter(Boolean).join(" · ")}
              </p>
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

        {etapa.descricao && (
          <Secao titulo="O que acontece aqui">
            <Texto>{etapa.descricao}</Texto>
          </Secao>
        )}

        {etapa.objetivo && (
          <Secao titulo="Objetivo da etapa">
            <Texto>{etapa.objetivo}</Texto>
          </Secao>
        )}

        {etapa.sistemaPrincipal && (
          <Secao titulo="Sistema principal" icone="Server">
            <Texto>{etapa.sistemaPrincipal}</Texto>
          </Secao>
        )}

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

        {etapa.regras && (
          <Secao titulo="Regras de negócio" icone="Scale">
            <Texto>{etapa.regras}</Texto>
          </Secao>
        )}

        {etapa.informacoesConsultadas && (
          <Secao titulo="Informações que consulta" icone="Search">
            <Texto>{etapa.informacoesConsultadas}</Texto>
          </Secao>
        )}

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

        {etapa.observacoes && (
          <Secao titulo="Observações">
            <Texto>{etapa.observacoes}</Texto>
          </Secao>
        )}

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
      </div>

      <Separator />
      <p className="px-5 py-3 text-xs text-muted-foreground/70">
        Etapa {etapa.ordem + 1} do processo
        {etapa.chaveMonitoramento ? ` · chave ${etapa.chaveMonitoramento}` : ""}
      </p>
    </aside>
  );
}
