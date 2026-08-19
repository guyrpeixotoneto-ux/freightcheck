import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, ChevronRight, Lock } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ContaApurada } from "@/components/fechamento/conta-apurada";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  lerCompetencia,
  listarApuracoes,
  listarFontes,
  NOME_DO_ESTADO,
  type Competencia,
  type Fonte,
  type ResumoDeApuracao,
} from "@/lib/fechamento";
import {
  emDiaCurto,
  MES_CURTO,
  MES_LONGO,
  nomeDaParte,
  percentualConferido,
} from "@/lib/fechamento-gerencial";
import { formatBrl } from "@/lib/format";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";

/**
 * Apurações — todas as competências numa tela só.
 *
 * **O que ela responde, e por que não é a mesma pergunta da tela de dentro.**
 * A competência aberta responde "quanto esta quinzena vale, verba a verba, e o
 * que não fecha". Esta responde outra: *onde está o trabalho*. Quais CDDs
 * ainda não receberam os cinco relatórios, quais já apuraram, quanto de CT-e
 * foi emitido no período e quanto disso continua sem resposta. É a fila do
 * fechamento vista de cima — o mesmo papel que a lista de alterações cumpre na
 * Auditoria.
 *
 * **Nenhum número nasce aqui.** `emitido`, `não conferido` e `a questionar` são
 * o que a apuração gravou quando rodou, somados por quinzena e nada mais; o
 * percentual conferido é a razão entre dois deles. A interface não recompõe
 * remuneração — ver o cabeçalho de `lib/fechamento.ts`. Por isso uma
 * competência sem apuração mostra "sem apuração" nas três colunas em vez de
 * zero: zero é um resultado, e ela não tem resultado nenhum ainda.
 *
 * **Por que agrupa por quinzena.** Porque é assim que se cobra e é assim que se
 * pergunta: ninguém quer saber do CDD Belém isolado, quer saber se a 1ª
 * quinzena de agosto já pode ser fechada. O cabeçalho de cada grupo é o total
 * do que está dentro dele, e o filtro de quinzena existe para quem já sabe qual
 * período está olhando.
 *
 * **A conta abre aqui, na própria linha.** A pergunta seguinte a "56% conferido"
 * é sempre a mesma — *conferido onde?* — e a resposta obrigava a trocar de tela,
 * o que fazia perder a fila: quem comparava dois CDDs voltava, filtrava de novo
 * e reprocurava o lugar. Clicar na quinzena, ou numa linha dela, abre logo
 * abaixo a mesma conta da competência (`components/fechamento/conta-apurada`),
 * verba a verba e com a memória de cada uma. É o mesmo componente, e não uma
 * cópia: dois desenhos do mesmo número acabariam divergindo, e o daqui seria o
 * que ninguém lembrou de corrigir.
 *
 * A conta é buscada quando a linha abre, e não junto da lista: a lista é o
 * índice de dezenas de quinzenas, e a conta de cada uma traz verbas, memória e
 * divergências. Baixar todas para mostrar uma seria pagar o fechamento inteiro
 * para ler uma linha.
 */

/**
 * O erro, na frase que a apresentação escolheu — a mesma regra de Importações:
 * `apresentar` decide entre a orientação tipada e a mensagem crua, e repeti-la
 * aqui abriria uma segunda opinião sobre o mesmo erro.
 */
function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar as apurações.";
}

/** O sentinela dos filtros: nenhum recorte aplicado. */
const TUDO = "*";

/**
 * Dinheiro sem o cifrão, com os centavos sempre presentes.
 *
 * Sem cifrão porque a coluna inteira é dinheiro e repeti-lo em cada linha só
 * gasta largura — o `R$` aparece uma vez, no total da quinzena. Com os centavos
 * sempre presentes porque uma coluna em que `612.885,40` e `612.885` se
 * alternam deixa de ser lida de cima a baixo, que é a única forma de ler uma
 * coluna de valores.
 */
const emValor = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `03.08.12.09` vira `12.09`; `2Art` continua `2Art`. */
const rotinaCurta = (rotina: string) => rotina.split(".").slice(-2).join(".");

const rotuloLongo = (c: Competencia) =>
  `${c.quinzena}ª quinzena de ${MES_LONGO[c.mes - 1]} de ${c.ano}`;

const rotuloCurto = (c: Competencia) => `${MES_CURTO[c.mes - 1]}/${c.ano} · ${c.quinzena}ª`;

/** As competências de um grupo, na ordem em que a quinzena as mostra. */
const idsDoGrupo = (grupo: Grupo) => grupo.linhas.map((l) => l.competencia.id);

/**
 * Um grupo está aberto quando não falta nenhuma competência dele por abrir.
 *
 * A lista nunca desenha grupo sem linhas, e mesmo assim o vazio é dito: `every`
 * sobre lista vazia é verdadeiro, e um grupo assim ficaria eternamente aberto —
 * seta girada, clique sem efeito.
 */
export function grupoEstaAberto(abertas: ReadonlySet<string>, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => abertas.has(id));
}

/**
 * Abrir e fechar linhas — o mesmo gesto em dois tamanhos.
 *
 * Quais competências estão abertas é um conjunto, e não "uma de cada vez":
 * conferir a quinzena é comparar CDDs, e fechar a conta de cima para ver a de
 * baixo é exatamente o que a lista existia para evitar.
 *
 * `alternarGrupo` é o cabeçalho da quinzena: abre todas as competências dela, e
 * só fecha quando não falta nenhuma — assim o clique num grupo meio aberto
 * termina de abri-lo, em vez de fechar o que já se estava lendo.
 */
export function alternarUma(abertas: ReadonlySet<string>, id: string): Set<string> {
  const proximo = new Set(abertas);
  if (!proximo.delete(id)) proximo.add(id);
  return proximo;
}

export function alternarGrupo(abertas: ReadonlySet<string>, ids: string[]): Set<string> {
  const proximo = new Set(abertas);
  const todasAbertas = ids.length > 0 && ids.every((id) => proximo.has(id));
  for (const id of ids) {
    if (todasAbertas) proximo.delete(id);
    else proximo.add(id);
  }
  return proximo;
}

/**
 * A aparência de cada estado.
 *
 * Sólido para os dois estados que pedem alguém agora — apurada espera
 * conferência, aprovada espera o encerramento. Discreto para os que não pedem:
 * a que ainda não começou e a que já acabou. É a mesma regra dos contadores da
 * lateral — destaque é para o que tem fila atrás, não para o que é importante
 * em abstrato.
 */
const APARENCIA_DO_ESTADO: Record<Competencia["estado"], string> = {
  ABERTA: "border-border bg-muted text-muted-foreground",
  EM_APURACAO: "border-border bg-muted text-muted-foreground",
  APURADA: "border-primary bg-primary text-primary-foreground",
  APROVADA: "border-primary bg-primary text-primary-foreground",
  ENCERRADA: "border-border bg-muted text-muted-foreground",
};

function Estado({ estado }: { estado: Competencia["estado"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide",
        APARENCIA_DO_ESTADO[estado],
      )}
    >
      {estado === "ENCERRADA" ? (
        <Lock className="w-3 h-3" />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {NOME_DO_ESTADO[estado]}
    </span>
  );
}

/** Uma quinzena e as competências dela, já somadas. */
interface Grupo {
  chave: string;
  amostra: Competencia;
  linhas: ResumoDeApuracao[];
  emitido: number;
  naoConferido: number;
  aQuestionar: number;
  apuradas: number;
  todasEncerradas: boolean;
}

function agrupar(linhas: ResumoDeApuracao[]): Grupo[] {
  const grupos: Grupo[] = [];
  const por = new Map<string, Grupo>();
  for (const linha of linhas) {
    const chave = linha.competencia.chave;
    let grupo = por.get(chave);
    if (!grupo) {
      // A ordem dos grupos é a ordem em que a primeira competência de cada um
      // apareceu, e a lista já vem do banco da quinzena mais recente para a
      // mais antiga. Reordenar aqui seria uma segunda opinião sobre a ordem.
      grupo = {
        chave,
        amostra: linha.competencia,
        linhas: [],
        emitido: 0,
        naoConferido: 0,
        aQuestionar: 0,
        apuradas: 0,
        todasEncerradas: true,
      };
      por.set(chave, grupo);
      grupos.push(grupo);
    }
    grupo.linhas.push(linha);
    if (linha.competencia.estado !== "ENCERRADA") grupo.todasEncerradas = false;
    if (linha.apuracao) {
      grupo.apuradas += 1;
      grupo.emitido += linha.apuracao.emitido;
      grupo.naoConferido += linha.apuracao.naoConferido;
      grupo.aQuestionar += linha.apuracao.aQuestionar;
    }
  }
  return grupos;
}

/** O resumo do grupo, na frase que ele merece. */
function resumoDoGrupo(grupo: Grupo): string {
  const contagem = `${grupo.linhas.length} competência${grupo.linhas.length === 1 ? "" : "s"}`;
  if (grupo.apuradas === 0) return `${contagem} · nenhuma apurada ainda`;

  const conferido = percentualConferido(grupo);
  const partes = [
    contagem,
    `${formatBrl(grupo.emitido)} emitidos`,
    conferido === null ? "sem emissão a conferir" : `${Math.round(conferido)}% conferido`,
    grupo.aQuestionar > 0 ? `${formatBrl(grupo.aQuestionar)} a questionar` : "nada a questionar",
  ];
  if (grupo.todasEncerradas) partes.push("todas encerradas");
  return partes.join(" · ");
}

/** Um filtro, no formato de etiqueta que a tela usa. */
function Filtro({
  rotulo,
  valor,
  aoTrocar,
  opcoes,
  tudo,
}: {
  rotulo: string;
  valor: string;
  aoTrocar: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
  tudo: string;
}) {
  const escolhida = opcoes.find((o) => o.valor === valor);
  const ativo = valor !== TUDO;
  return (
    <Select value={valor} onValueChange={aoTrocar}>
      <SelectTrigger
        className={cn(
          "h-auto w-auto gap-2 rounded-full px-4 py-2 shadow-none",
          ativo && "border-primary text-primary",
        )}
        aria-label={rotulo}
      >
        <span className="font-semibold">{rotulo}</span>
        <span className={cn("font-normal", ativo ? "text-primary/80" : "text-muted-foreground")}>
          {escolhida?.rotulo ?? tudo}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TUDO}>{tudo}</SelectItem>
        {opcoes
          .filter((o) => o.valor !== TUDO)
          .map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A conta de uma competência, dentro da linha dela.
 *
 * A chave da consulta é a mesma da competência aberta — `["fechamento",
 * "competencia", id]` —, e não por economia de nome: quem abre a conta aqui e
 * depois entra na tela de dentro a encontra pronta, e quem volta de lá reabre a
 * linha sem nova ida ao servidor. Duas chaves para o mesmo recurso dariam duas
 * cópias que podem discordar entre si.
 */
function ContaDaLinha({ competenciaId, fontes }: { competenciaId: string; fontes: Fonte[] }) {
  const dados = useQuery({
    queryKey: ["fechamento", "competencia", competenciaId],
    queryFn: () => lerCompetencia(competenciaId),
  });

  if (dados.isLoading) {
    return <p className="text-sm text-muted-foreground">Abrindo a conta…</p>;
  }
  if (dados.isError || !dados.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
      </Alert>
    );
  }
  /*
    A linha da lista já dizia se havia apuração, e mesmo assim quem manda é o
    que o servidor acabou de responder: entre carregar a lista e abrir a conta,
    alguém pode ter reaberto a competência e rodado tudo de novo.
  */
  const { apuracao } = dados.data;
  if (!apuracao) return <SemApuracao competenciaId={competenciaId} />;
  return <ContaApurada apuracao={apuracao} fontes={fontes} />;
}

/** O que dizer quando não há conta — e para onde ir fazer uma. */
function SemApuracao({ competenciaId }: { competenciaId: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Esta competência ainda não apurou — e apurar é um botão, dentro da competência,
      porque rodar grava.{" "}
      <Link
        href={`/fechamento/competencias/${competenciaId}`}
        className="text-primary hover:underline"
      >
        Abra a competência
      </Link>{" "}
      para enviar os relatórios que faltam e rodar a conta.
    </p>
  );
}

export default function Apuracoes() {
  const [quinzena, setQuinzena] = useState(TUDO);
  const [unidade, setUnidade] = useState(TUDO);
  const [transportadora, setTransportadora] = useState(TUDO);
  const [estado, setEstado] = useState(TUDO);
  /* As competências com a conta aberta — ver `alternarUma` e `alternarGrupo`. */
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set());

  const apuracoes = useQuery({
    queryKey: ["fechamento", "apuracoes"],
    queryFn: listarApuracoes,
  });
  const fontes = useQuery({ queryKey: ["fechamento", "fontes"], queryFn: listarFontes });

  const todas = useMemo(() => apuracoes.data ?? [], [apuracoes.data]);

  /*
    As opções de cada filtro são o que existe, e só. Oferecer um CDD que nunca
    abriu competência daria uma lista vazia com cara de erro; oferecer um estado
    que nada alcançou daria a mesma coisa. Um filtro que só oferece recortes com
    resultado nunca leva a tela ao vazio por escolha de quem filtra.
  */
  const opcoes = useMemo(() => {
    const quinzenas = new Map<string, string>();
    const unidades = new Map<string, string>();
    const transportadoras = new Map<string, string>();
    const estados = new Map<string, string>();
    for (const { competencia: c } of todas) {
      quinzenas.set(c.chave, rotuloCurto(c));
      unidades.set(c.unidade.codigo, `${nomeDaParte(c.unidade)} · ${c.unidade.codigo}`);
      transportadoras.set(
        c.transportadora.codigo,
        `${nomeDaParte(c.transportadora)} · ${c.transportadora.codigo}`,
      );
      estados.set(c.estado, NOME_DO_ESTADO[c.estado]);
    }
    const emLista = (m: Map<string, string>) =>
      [...m].map(([valor, rotulo]) => ({ valor, rotulo }));
    return {
      quinzenas: emLista(quinzenas),
      unidades: emLista(unidades).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
      transportadoras: emLista(transportadoras).sort((a, b) =>
        a.rotulo.localeCompare(b.rotulo, "pt-BR"),
      ),
      estados: emLista(estados),
    };
  }, [todas]);

  const grupos = useMemo(
    () =>
      agrupar(
        todas.filter(({ competencia: c }) => {
          if (quinzena !== TUDO && c.chave !== quinzena) return false;
          if (unidade !== TUDO && c.unidade.codigo !== unidade) return false;
          if (transportadora !== TUDO && c.transportadora.codigo !== transportadora) return false;
          if (estado !== TUDO && c.estado !== estado) return false;
          return true;
        }),
      ),
    [todas, quinzena, unidade, transportadora, estado],
  );

  const abertoNoGrupo = (grupo: Grupo) => grupoEstaAberto(abertas, idsDoGrupo(grupo));
  const filtrando = [quinzena, unidade, transportadora, estado].some((v) => v !== TUDO);
  const catalogo = fontes.data ?? [];

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Apurações</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O que cada competência já apurou: os relatórios que chegaram, quanto foi
          emitido em CT-e, quanto disso as fontes sustentam e quanto continua a
          questionar. Clique numa quinzena para abrir a conta aqui mesmo, verba a
          verba.
        </p>
      </header>

      <div className="p-8 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Filtro
            rotulo="Quinzena"
            valor={quinzena}
            aoTrocar={setQuinzena}
            opcoes={opcoes.quinzenas}
            tudo="todas"
          />
          <Filtro
            rotulo="Unidade"
            valor={unidade}
            aoTrocar={setUnidade}
            opcoes={opcoes.unidades}
            tudo="todas"
          />
          <Filtro
            rotulo="Transportadora"
            valor={transportadora}
            aoTrocar={setTransportadora}
            opcoes={opcoes.transportadoras}
            tudo="todas"
          />
          <Filtro
            rotulo="Estado"
            valor={estado}
            aoTrocar={setEstado}
            opcoes={opcoes.estados}
            tudo="todos"
          />
        </div>

        {apuracoes.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {textoDoErro(apuracoes.error)}
            </AlertDescription>
          </Alert>
        )}

        {apuracoes.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}

        {!apuracoes.isLoading && !apuracoes.isError && todas.length === 0 && (
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground max-w-2xl space-y-3">
            <p>
              Nenhuma competência ainda — e sem competência não há o que apurar.
            </p>
            <p>
              Abra a primeira em{" "}
              <Link href="/fechamento/competencias" className="text-primary hover:underline">
                Importações
              </Link>{" "}
              e envie os cinco relatórios que a Ambev exporta na quinzena. O que for
              apurado a partir deles aparece aqui.
            </p>
          </div>
        )}

        {!apuracoes.isLoading && todas.length > 0 && grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma competência com esse recorte. Volte um filtro para “todas”.
          </p>
        )}

        {grupos.length > 0 && (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-bold px-4 py-3">Unidade e transportadora</th>
                  <th className="text-left font-bold px-4 py-3">Relatórios</th>
                  <th className="text-right font-bold px-4 py-3">Emitido em CT-e</th>
                  <th className="text-right font-bold px-4 py-3">Conferido</th>
                  <th className="text-right font-bold px-4 py-3">A questionar</th>
                  <th className="text-left font-bold px-4 py-3">Estado</th>
                </tr>
              </thead>
              {grupos.map((grupo) => (
                <tbody key={grupo.chave}>
                  <tr className="border-b bg-muted/40">
                    <th colSpan={6} scope="colgroup" className="p-0 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => setAbertas((a) => alternarGrupo(a, idsDoGrupo(grupo)))}
                        aria-expanded={abertoNoGrupo(grupo)}
                        className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-muted/70"
                      >
                        <ChevronRight
                          className={cn(
                            "w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform",
                            abertoNoGrupo(grupo) && "rotate-90",
                          )}
                          aria-hidden
                        />
                        <span>
                          <span className="font-bold uppercase tracking-wide text-xs">
                            {rotuloLongo(grupo.amostra)}
                          </span>
                          <span className="text-muted-foreground text-xs ml-3">
                            {emDiaCurto(grupo.amostra.inicio)} a {emDiaCurto(grupo.amostra.fim)} ·{" "}
                            {resumoDoGrupo(grupo)}
                          </span>
                        </span>
                      </button>
                    </th>
                  </tr>
                  {grupo.linhas.map(({ competencia: c, relatorios, apuracao }) => {
                    const conferido = apuracao ? percentualConferido(apuracao) : null;
                    const aberta = abertas.has(c.id);
                    const alternar = () => setAbertas((a) => alternarUma(a, c.id));
                    return (
                      <Fragment key={c.id}>
                        <tr
                          onClick={alternar}
                          className={cn(
                            "border-b last:border-b-0 cursor-pointer hover:bg-muted/50",
                            aberta && "bg-muted/40",
                          )}
                        >
                          <td className="px-4 py-3 align-middle">
                            {/*
                              O botão repete o clique da linha por causa do
                              teclado: uma `<tr>` clicável não recebe foco, e sem
                              ele a conta seria inalcançável sem mouse.
                            */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                alternar();
                              }}
                              aria-expanded={aberta}
                              className="flex items-start gap-1.5 text-left"
                            >
                              <ChevronRight
                                className={cn(
                                  "w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground transition-transform",
                                  aberta && "rotate-90",
                                )}
                                aria-hidden
                              />
                              <span>
                                <span className="font-semibold">
                                  {nomeDaParte(c.unidade)}
                                  {c.unidade.nome && (
                                    <span className="text-muted-foreground font-normal">
                                      {" · "}
                                      {c.unidade.codigo}
                                    </span>
                                  )}
                                </span>
                                <span className="block text-muted-foreground text-xs mt-0.5">
                                  {nomeDaParte(c.transportadora)}
                                </span>
                              </span>
                            </button>
                          </td>

                          <td className="px-4 py-3 align-middle">
                            <div className="flex items-center gap-1.5">
                              {catalogo.map((fonte) => {
                                const chegou = relatorios.includes(fonte.tipo);
                                return (
                                  <span
                                    key={fonte.tipo}
                                    title={`${fonte.rotina} — ${fonte.nome}${chegou ? "" : " (não enviado)"}`}
                                    className={cn(
                                      "rounded px-1.5 py-1 font-mono text-[0.6875rem] leading-none",
                                      chegou
                                        ? "bg-primary text-primary-foreground"
                                        : "border border-dashed border-border text-muted-foreground/70",
                                    )}
                                  >
                                    {rotinaCurta(fonte.rotina)}
                                  </span>
                                );
                              })}
                              {catalogo.length > 0 && (
                                <span className="text-muted-foreground font-mono text-xs ml-1.5">
                                  {relatorios.length}/{catalogo.length}
                                </span>
                              )}
                            </div>
                          </td>

                          {apuracao ? (
                            <>
                              <td className="px-4 py-3 text-right font-mono tabular-nums align-middle">
                                {emValor(apuracao.emitido)}
                              </td>
                              <td className="px-4 py-3 align-middle">
                                {conferido === null ? (
                                  <div className="text-right text-muted-foreground">—</div>
                                ) : (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="font-mono tabular-nums">
                                      {Math.round(conferido)}%
                                    </span>
                                    <span
                                      className="h-1.5 w-24 rounded-full bg-muted overflow-hidden"
                                      aria-hidden
                                    >
                                      <span
                                        className="block h-full rounded-full bg-primary"
                                        style={{ width: `${Math.min(100, Math.max(0, conferido))}%` }}
                                      />
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td
                                className={cn(
                                  "px-4 py-3 text-right font-mono tabular-nums align-middle",
                                  apuracao.aQuestionar > 0
                                    ? "text-amber-700 dark:text-amber-500"
                                    : "text-muted-foreground",
                                )}
                                title={
                                  apuracao.aQuestionar > 0
                                    ? `${apuracao.aQuestionarQuantidade} divergência${apuracao.aQuestionarQuantidade === 1 ? "" : "s"} sem desfecho`
                                    : "Nenhuma divergência em aberto"
                                }
                              >
                                {apuracao.aQuestionar > 0 ? emValor(apuracao.aQuestionar) : "—"}
                              </td>
                            </>
                          ) : (
                            <>
                              {/*
                                Três traços e uma frase, e não três zeros: a
                                competência sem apuração não vale zero, ela ainda
                                não vale nada — a conta não rodou. Zero aqui seria
                                o único número inventado da tela.
                              */}
                              <td className="px-4 py-3 text-right text-muted-foreground align-middle whitespace-nowrap">
                                — sem apuração
                              </td>
                              <td className="px-4 py-3 text-right text-muted-foreground align-middle">
                                —
                              </td>
                              <td className="px-4 py-3 text-right text-muted-foreground align-middle">
                                —
                              </td>
                            </>
                          )}

                          <td className="px-4 py-3 align-middle">
                            <Estado estado={c.estado} />
                          </td>
                        </tr>
                        {aberta && (
                          <tr className="border-b last:border-b-0 bg-muted/20">
                            <td colSpan={6} className="px-4 py-4 sm:px-9">
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-3">
                                  <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                                    A conta da quinzena · {nomeDaParte(c.unidade)}
                                  </p>
                                  {/*
                                    A conta abre aqui; o resto da competência —
                                    enviar relatório, ver os dias, encerrar — é
                                    outra tela, e o caminho para ela fica onde a
                                    pergunta seguinte aparece.
                                  */}
                                  <Link
                                    href={`/fechamento/competencias/${c.id}`}
                                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                  >
                                    Abrir a competência — relatórios, dias e encerramento
                                    <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                                  </Link>
                                </div>
                                {apuracao ? (
                                  <ContaDaLinha competenciaId={c.id} fontes={catalogo} />
                                ) : (
                                  <SemApuracao competenciaId={c.id} />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}

        {filtrando && grupos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Os totais de cada quinzena são os das competências visíveis com este recorte.
          </p>
        )}
      </div>
    </Layout>
  );
}
