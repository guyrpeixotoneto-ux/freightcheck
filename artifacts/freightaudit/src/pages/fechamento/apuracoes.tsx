import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Lock } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  listarApuracoes,
  listarFontes,
  NOME_DO_ESTADO,
  type Competencia,
  type ResumoDeApuracao,
} from "@/lib/fechamento";
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

const MES_CURTO = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `2026-08-15` vira `15/08` — o dia dentro do mês que o grupo já nomeou. */
const emDiaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

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

const nomeDaParte = (p: { codigo: string; nome: string | null }) => p.nome ?? p.codigo;

/** `03.08.12.09` vira `12.09`; `2Art` continua `2Art`. */
const rotinaCurta = (rotina: string) => rotina.split(".").slice(-2).join(".");

const rotuloLongo = (c: Competencia) =>
  `${c.quinzena}ª quinzena de ${MES_LONGO[c.mes - 1]} de ${c.ano}`;

const rotuloCurto = (c: Competencia) => `${MES_CURTO[c.mes - 1]}/${c.ano} · ${c.quinzena}ª`;

/**
 * Quanto do emitido a apuração conseguiu sustentar, em porcentagem.
 *
 * `naoConferido` é a parte do CT-e emitido que nenhuma das cinco fontes
 * explica; o conferido é o resto. Devolve `null` quando não houve emissão
 * alguma — `0/0` não é 100% conferido nem 0%, é uma quinzena sem o que
 * conferir, e desenhar uma barra cheia ali seria mentir por arredondamento.
 */
function percentualConferido(a: { emitido: number; naoConferido: number }): number | null {
  if (a.emitido <= 0) return null;
  return ((a.emitido - a.naoConferido) / a.emitido) * 100;
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

export default function Apuracoes() {
  const [, navegar] = useLocation();
  const [quinzena, setQuinzena] = useState(TUDO);
  const [unidade, setUnidade] = useState(TUDO);
  const [transportadora, setTransportadora] = useState(TUDO);
  const [estado, setEstado] = useState(TUDO);

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

  const filtrando = [quinzena, unidade, transportadora, estado].some((v) => v !== TUDO);
  const catalogo = fontes.data ?? [];

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Apurações</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O que cada competência já apurou: os relatórios que chegaram, quanto foi
          emitido em CT-e, quanto disso as fontes sustentam e quanto continua a
          questionar.
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
                    <th
                      colSpan={6}
                      scope="colgroup"
                      className="px-4 py-2.5 text-left font-normal"
                    >
                      <span className="font-bold uppercase tracking-wide text-xs">
                        {rotuloLongo(grupo.amostra)}
                      </span>
                      <span className="text-muted-foreground text-xs ml-3">
                        {emDiaCurto(grupo.amostra.inicio)} a {emDiaCurto(grupo.amostra.fim)} ·{" "}
                        {resumoDoGrupo(grupo)}
                      </span>
                    </th>
                  </tr>
                  {grupo.linhas.map(({ competencia: c, relatorios, apuracao }) => {
                    const conferido = apuracao ? percentualConferido(apuracao) : null;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navegar(`/fechamento/competencias/${c.id}`)}
                        className="border-b last:border-b-0 cursor-pointer hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 align-middle">
                          <Link
                            href={`/fechamento/competencias/${c.id}`}
                            className="font-semibold hover:underline"
                          >
                            {nomeDaParte(c.unidade)}
                            {c.unidade.nome && (
                              <span className="text-muted-foreground font-normal">
                                {" · "}
                                {c.unidade.codigo}
                              </span>
                            )}
                          </Link>
                          <div className="text-muted-foreground text-xs mt-0.5">
                            {nomeDaParte(c.transportadora)}
                          </div>
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
