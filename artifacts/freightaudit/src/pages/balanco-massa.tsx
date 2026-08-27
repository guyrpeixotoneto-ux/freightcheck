import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Check, FileSpreadsheet, Scale } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  NATUREZAS,
  natureza,
  type BalancoImportacao,
  type BalancoResumo,
  type DestinoNatureza,
} from "@/components/balanco/tipos";

/**
 * Balanço de Massa — a conta de conservação da importação.
 *
 * Todas as outras telas deste produto respondem à mesma pergunta, cada uma do
 * seu jeito: *de onde veio este número?* É a pergunta certa, e a rastreabilidade
 * até a célula de origem é o que o produto tem de mais seu.
 *
 * Esta tela faz a pergunta inversa, que nenhuma outra fazia: **toda célula que o
 * arquivo trouxe chegou a algum lugar?** As duas são necessárias, e só a
 * segunda pega o defeito que não se vê. Número inventado aparece — está lá, na
 * tela, errado. Dado que sumiu não aparece em lugar nenhum: uma coluna que a
 * Freightec renomeou e o leitor deixou de reconhecer não produz erro, produz um
 * total menor, com todas as parcelas exibidas conferindo perfeitamente entre si.
 * Ninguém audita o que não é exibido.
 *
 * Então a tela exibe: quanta massa entrou, por quais destinos declarados ela
 * saiu, e quanto sobrou sem destino. **Zero é a única resposta aceitável para o
 * resíduo**, e por isso ele aparece mesmo quando é zero — um indicador que só
 * aparece quando há problema é indistinguível de um indicador quebrado.
 *
 * Três coisas que esta tela deliberadamente **não** faz:
 *
 * 1. **Não fala em dinheiro.** A conta é de células e de fatos. Misturar reais
 *    aqui daria a entender que o que falta tem preço estimável, e não tem: se a
 *    massa não entrou, ninguém sabe quanto ela valia.
 * 2. **Não recalcula o pipeline.** Ela classifica o que ficou gravado. Uma
 *    segunda implementação das regras de leitura concordaria com a primeira
 *    inclusive quando as duas estivessem erradas.
 * 3. **Não filtra por unidade nem por canal.** O balanço é sobre o arquivo, e um
 *    arquivo é de uma importação só. Um recorte aqui sugeriria que existe massa
 *    "de outra unidade" explicando a que falta.
 */
export default function BalancoMassa() {
  const [escolhida, setEscolhida] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["balance"],
    queryFn: () => fetchJson<BalancoResumo[]>("/balance"),
  });

  const importacoes = lista.data ?? [];
  const selecionada = escolhida ?? importacoes[0]?.importRunId ?? null;

  const detalhe = useQuery({
    queryKey: ["balance", selecionada],
    queryFn: () => fetchJson<BalancoImportacao>(`/balance/${selecionada}`),
    enabled: selecionada !== null,
  });

  const naoFecham = importacoes.filter((b) => !b.fecha);
  const celulas = importacoes.reduce((total, b) => total + b.entrada, 0);
  const residuo = importacoes.reduce((total, b) => total + b.residuo, 0);
  const perdas = importacoes.reduce((total, b) => total + b.porNatureza.PERDA, 0);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Scale className="w-6 h-6 text-primary" />
          Rastreio de Dados
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Toda célula que entrou por um arquivo tem de sair por um destino
          declarado. Esta tela faz essa conta, importação por importação, e mostra
          o que sobrou sem destino — que é o único jeito de descobrir que um dado
          sumiu, já que o que falta não aparece em tela nenhuma.
        </p>
      </header>

      <div className="p-8 space-y-8">
        {lista.error && (
          <ApiErrorNotice
            error={lista.error}
            what="O balanço das importações não pôde ser carregado."
          />
        )}

        {lista.isLoading && (
          <p className="text-sm text-muted-foreground">Conferindo a massa…</p>
        )}

        {!lista.isLoading && !lista.error && importacoes.length === 0 && (
          <div className="rounded-md border bg-card p-8 text-center">
            <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">Nenhum arquivo importado ainda.</p>
            <p className="text-sm text-muted-foreground mt-1">
              O balanço existe por importação: ele começa a ter o que conferir
              quando o primeiro export do Freightec entrar por Importações.
            </p>
          </div>
        )}

        {importacoes.length > 0 && (
          <>
            <Veredito
              importacoes={importacoes.length}
              naoFecham={naoFecham.length}
              celulas={celulas}
              residuo={residuo}
              perdas={perdas}
            />

            <ListaDeImportacoes
              importacoes={importacoes}
              selecionada={selecionada}
              onSelecionar={setEscolhida}
            />

            {detalhe.error && (
              <ApiErrorNotice
                error={detalhe.error}
                what="O detalhe desta importação não pôde ser carregado."
              />
            )}

            {detalhe.isLoading && (
              <p className="text-sm text-muted-foreground">Abrindo a conta…</p>
            )}

            {detalhe.data && <Detalhe balanco={detalhe.data} />}
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * O veredito de todas as importações, em uma frase.
 *
 * "Fecha" e "não fecha" não são graus da mesma coisa. Ou toda a massa tem
 * destino, ou existe célula que sumiu — e nesse caso o número de células
 * perdidas é a única informação que importa nesta faixa.
 */
function Veredito({
  importacoes,
  naoFecham,
  celulas,
  residuo,
  perdas,
}: {
  importacoes: number;
  naoFecham: number;
  celulas: number;
  residuo: number;
  perdas: number;
}) {
  const fecha = naoFecham === 0;

  return (
    <section
      className={cn(
        "rounded-md border-l-4 bg-card border p-6",
        fecha ? "border-l-emerald-500" : "border-l-red-600",
      )}
    >
      <div className="flex items-start gap-3">
        {fecha ? (
          <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <h2 className="font-bold uppercase tracking-wide text-sm">
            {fecha ? "O balanço fecha" : "O balanço não fecha"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            {fecha ? (
              <>
                As {n(celulas)} células recebidas em{" "}
                {importacoes === 1 ? "uma importação" : `${importacoes} importações`}{" "}
                têm destino declarado, e nenhuma sobrou sem explicação.
                {perdas > 0 && (
                  <>
                    {" "}
                    <strong>Fechar não é o mesmo que aproveitar tudo</strong>:{" "}
                    {n(perdas)}{" "}
                    {perdas === 1
                      ? "célula foi recusada"
                      : "células foram recusadas"}{" "}
                    com motivo, e a lista abaixo diz quais e onde.
                  </>
                )}
              </>
            ) : (
              <>
                {naoFecham === 1
                  ? "Uma importação não fecha"
                  : `${naoFecham} importações não fecham`}
                : {n(residuo)}{" "}
                {residuo === 1 ? "célula entrou e sumiu" : "células entraram e sumiram"}{" "}
                sem que o sistema saiba dizer para onde. Isso é defeito de leitura,
                não configuração.
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-5 pt-5 border-t">
        <Numero rotulo="Importações" valor={n(importacoes)} />
        <Numero rotulo="Células recebidas" valor={n(celulas)} />
        <Numero
          rotulo="Perda declarada"
          valor={n(perdas)}
          tom={perdas > 0 ? "atencao" : undefined}
          nota="o arquivo trazia e o sistema recusou, com motivo"
        />
        <Numero
          rotulo="Sem destino"
          valor={n(residuo)}
          tom={residuo > 0 ? "erro" : "ok"}
          nota="zero é a única resposta aceitável"
        />
      </dl>
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "ok" | "atencao" | "erro";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </dt>
      <dd
        className={cn(
          "text-2xl font-bold tabular-nums mt-0.5",
          tom === "erro" && "text-red-700",
          tom === "atencao" && "text-amber-700",
          tom === "ok" && "text-emerald-700",
        )}
      >
        {valor}
      </dd>
      {nota && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{nota}</p>}
    </div>
  );
}

function ListaDeImportacoes({
  importacoes,
  selecionada,
  onSelecionar,
}: {
  importacoes: BalancoResumo[];
  selecionada: string | null;
  onSelecionar: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide mb-3">
        Importações
      </h2>
      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Arquivo</th>
              <th className="text-left px-4 py-2 font-medium">Situação</th>
              <th className="text-right px-4 py-2 font-medium">Células</th>
              <th className="text-left px-4 py-2 font-medium w-[28%]">
                Para onde foram
              </th>
              <th className="text-right px-4 py-2 font-medium">Sem destino</th>
              <th className="text-left px-4 py-2 font-medium">Balanço</th>
              <th className="w-px" />
            </tr>
          </thead>
          <tbody>
            {importacoes.map((b) => (
              <tr
                key={b.importRunId}
                onClick={() => onSelecionar(b.importRunId)}
                className={cn(
                  "border-b last:border-0 cursor-pointer hover:bg-muted/40",
                  b.importRunId === selecionada && "bg-accent",
                )}
              >
                <td className="px-4 py-2.5">
                  <span className="font-medium">{b.filename}</span>
                  <span className="block font-mono text-[0.6875rem] text-muted-foreground">
                    {b.contentSha256.slice(0, 12)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {b.status}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {n(b.entrada)}
                </td>
                <td className="px-4 py-2.5">
                  <Barra porNatureza={b.porNatureza} total={b.entrada} />
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums",
                    b.residuo > 0 && "text-red-700 font-bold",
                  )}
                >
                  {n(b.residuo)}
                </td>
                <td className="px-4 py-2.5">
                  {b.fecha ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <Check className="w-3.5 h-3.5" /> fecha
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                      <AlertTriangle className="w-3.5 h-3.5" /> não fecha
                    </span>
                  )}
                </td>
                {/*
                  A ponta que faltava: esta tela diz **que** uma importação não
                  fecha; o porquê — mapeamento de colunas, avisos de leitura, o
                  que foi ignorado — mora no envio, em Importações. Sem endereço
                  por execução, o único caminho era a lista inteira, e quem
                  chegava tinha de reencontrar entre dezenas de envios o nome que
                  acabara de ler aqui.

                  `stopPropagation` porque a linha inteira já tem um clique
                  próprio, que abre o detalhe **desta** tela: são dois destinos
                  diferentes, e o de dentro não pode disparar o de fora.
                */}
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Link
                    href={`/importacoes?run=${encodeURIComponent(b.importRunId)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    ver o envio
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A massa inteira numa barra, na proporção em que saiu.
 *
 * Uma fatia de uma célula em 43 mil é invisível, e é justamente a que precisa
 * ser vista — então perda e resíduo têm largura mínima. A barra é ilustração; os
 * números ao lado é que são a conta, e por isso nenhuma leitura desta tela
 * depende de medir a barra com o olho.
 */
function Barra({
  porNatureza,
  total,
}: {
  porNatureza: Record<DestinoNatureza, number>;
  total: number;
}) {
  if (total === 0) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex h-3 w-full rounded-sm overflow-hidden bg-muted">
      {NATUREZAS.map((nat) => {
        const valor = porNatureza[nat.code] ?? 0;
        if (valor === 0) return null;
        const proporcao = (valor / total) * 100;
        const largura =
          (nat.code === "PERDA" || nat.code === "RESIDUO") && proporcao < 1.5
            ? 1.5
            : proporcao;
        return (
          <div
            key={nat.code}
            className={nat.barra}
            style={{ width: `${largura}%` }}
            title={`${nat.nome}: ${n(valor)} células`}
          />
        );
      })}
    </div>
  );
}

function Detalhe({ balanco }: { balanco: BalancoImportacao }) {
  return (
    <div className="space-y-8">
      <Etapa1 balanco={balanco} />
      <Etapa2 balanco={balanco} />
      <Etapa3 balanco={balanco} />
    </div>
  );
}

function TituloEtapa({
  numero,
  titulo,
  descricao,
  fecha,
}: {
  numero: number;
  titulo: string;
  descricao: string;
  fecha: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold uppercase tracking-wide">
          Etapa {numero} — {titulo}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">{descricao}</p>
      </div>
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-sm",
          fecha ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
        )}
      >
        {fecha ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        {fecha ? "fecha" : "não fecha"}
      </span>
    </div>
  );
}

function Etapa1({ balanco }: { balanco: BalancoImportacao }) {
  const destinos = balanco.destinos.filter((d) => d.celulas > 0);
  const amostras = balanco.etapa1.amostras;

  return (
    <section>
      <TituloEtapa
        numero={1}
        titulo="do arquivo ao preparo"
        descricao={`${n(balanco.entrada)} células foram capturadas de "${balanco.filename}". Abaixo, para onde cada uma foi.`}
        fecha={balanco.fecha}
      />

      {!balanco.capturaConfere && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>A captura não confere.</strong> A importação registrou{" "}
          {n(balanco.entradaRegistrada)} células capturadas e hoje existem{" "}
          {n(balanco.entrada)} na camada RAW. RAW é imutável: uma diferença aqui
          só pode ter vindo de uma exclusão de importação que levou mais do que
          devia.
        </p>
      )}

      <div className="mb-4">
        <Barra porNatureza={balanco.porNatureza} total={balanco.entrada} />
        <ul className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
          {NATUREZAS.filter((nat) => (balanco.porNatureza[nat.code] ?? 0) > 0).map(
            (nat) => (
              <li key={nat.code} className="flex items-center gap-2 text-xs">
                <span className={cn("w-2.5 h-2.5 rounded-sm", nat.barra)} />
                <span className="font-medium">{nat.nome}</span>
                <span className="tabular-nums text-muted-foreground">
                  {n(balanco.porNatureza[nat.code])} — {nat.resumo}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Destino</th>
              <th className="text-right px-4 py-2 font-medium">Células</th>
              <th className="text-right px-4 py-2 font-medium">Do arquivo</th>
              <th className="text-left px-4 py-2 font-medium w-[55%]">
                Por que a célula parou aqui
              </th>
            </tr>
          </thead>
          <tbody>
            {destinos.map((d) => {
              const nat = natureza(d.natureza);
              return (
                <tr key={d.code} className="border-b last:border-0 align-top">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium">
                      <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", nat.barra)} />
                      {d.nome}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right tabular-nums",
                      d.natureza === "RESIDUO" && "font-bold text-red-700",
                    )}
                  >
                    {n(d.celulas)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {pct(d.celulas, balanco.entrada)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {d.explicacao}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
        Por aba
      </h3>
      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Aba</th>
              <th className="text-left px-4 py-2 font-medium">Papel</th>
              <th className="text-right px-4 py-2 font-medium">Células</th>
              <th className="text-right px-4 py-2 font-medium">Viraram fato</th>
              <th className="text-right px-4 py-2 font-medium">Perda</th>
              <th className="text-right px-4 py-2 font-medium">Sem destino</th>
            </tr>
          </thead>
          <tbody>
            {balanco.etapa1.porAba.map((aba) => (
              <tr key={aba.sheetName} className="border-b last:border-0 align-top">
                <td className="px-4 py-2.5 font-medium">{aba.sheetName}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[26rem]">
                  <span className="font-mono text-[0.6875rem] uppercase">{aba.role}</span>
                  <span className="block">{aba.roleReason}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(aba.celulas)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(aba.virouFato)}</td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums",
                    aba.perda > 0 && "text-amber-700 font-semibold",
                  )}
                >
                  {n(aba.perda)}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums",
                    aba.residuo > 0 && "text-red-700 font-bold",
                  )}
                >
                  {n(aba.residuo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {amostras.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
            Onde estão as células que não entraram
          </h3>
          <p className="text-xs text-muted-foreground mb-2 max-w-3xl">
            O endereço de cada uma na planilha de origem, até oito por destino.
            Sem endereço não há conserto: quem vai falar com a Freightec precisa
            dizer qual aba, qual linha e qual coluna.
          </p>
          <div className="rounded-md border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Destino</th>
                  <th className="text-left px-4 py-2 font-medium">Aba</th>
                  <th className="text-left px-4 py-2 font-medium">Célula</th>
                  <th className="text-left px-4 py-2 font-medium">Coluna</th>
                  <th className="text-left px-4 py-2 font-medium">Conteúdo</th>
                </tr>
              </thead>
              <tbody>
                {amostras.map((a, i) => (
                  <tr key={`${a.code}-${i}`} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs">{rotuloDoDestino(balanco, a.code)}</td>
                    <td className="px-4 py-2 text-xs">{a.sheetName}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {a.columnLetter}
                      {a.rowIndex}
                    </td>
                    <td className="px-4 py-2 text-xs">{a.columnHeader ?? "— sem cabeçalho —"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {a.rawValue ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Etapa2({ balanco }: { balanco: BalancoImportacao }) {
  const { etapa2 } = balanco;

  return (
    <section>
      <TituloEtapa
        numero={2}
        titulo="do preparo à vigência"
        descricao="O que foi preparado tem de estar promovido — ou a importação tem de dizer por que ainda não está. Esperar não é perder, e a diferença aparece aqui."
        fecha={etapa2.fecha}
      />

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-6 rounded-md border bg-card p-5 mb-4">
        <Numero rotulo="Fatos preparados" valor={n(etapa2.preparados)} />
        <Numero
          rotulo="Células de origem"
          valor={n(etapa2.celulasDeOrigem)}
          nota="uma célula, um fato"
          tom={etapa2.celulasDeOrigem === etapa2.preparados ? undefined : "erro"}
        />
        <Numero rotulo="Promovidos" valor={n(etapa2.promovidos)} />
        <Numero
          rotulo="Não promovidos"
          valor={n(etapa2.naoPromovidos)}
          tom={etapa2.naoPromovidos > 0 ? "atencao" : undefined}
        />
      </dl>

      {etapa2.porQueNaoPromoveu && (
        <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          {etapa2.porQueNaoPromoveu}
        </p>
      )}

      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Vigência</th>
              <th className="text-left px-4 py-2 font-medium">Situação</th>
              <th className="text-right px-4 py-2 font-medium">Preparados</th>
              <th className="text-right px-4 py-2 font-medium">Promovidos</th>
              <th className="text-right px-4 py-2 font-medium">Com lastro no arquivo</th>
              <th className="text-left px-4 py-2 font-medium">Balanço</th>
            </tr>
          </thead>
          <tbody>
            {etapa2.vigencias.map((v) => (
              <tr key={v.label} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs">{v.label}</span>
                  {v.effectiveDate && (
                    <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">
                      {v.effectiveDate}
                      {v.revision !== null && v.revision > 1 && ` · revisão ${v.revision}`}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {v.status ?? "ainda sem vigência"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(v.preparados)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(v.promovidos)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {n(v.comLastroNoArquivo)}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {v.fecha ? (
                    <span className="text-emerald-700 font-semibold">fecha</span>
                  ) : v.snapshotId === null ? (
                    <span className="text-muted-foreground">aguardando aprovação</span>
                  ) : (
                    <span className="text-red-700 font-semibold">não fecha</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A terceira etapa é a que surpreende quem abre a tela pela primeira vez.
 *
 * A massa chegou inteira ao canônico e, ainda assim, quase nada dela pode entrar
 * numa soma: só o fato cuja semântica alguém confirmou é somável. Não é perda —
 * o dado está lá, conferível, com lastro na célula de origem —, mas também não é
 * disponibilidade. Exibir "41.850 fatos promovidos" sem dizer que 37.944 deles
 * não podem ser somados seria verdade contando pela metade.
 */
function Etapa3({ balanco }: { balanco: BalancoImportacao }) {
  const { etapa3 } = balanco;

  if (etapa3.fatos === 0) {
    return (
      <section>
        <TituloEtapa
          numero={3}
          titulo="o portão da semântica"
          descricao="Nada foi promovido nesta importação, então não há fato para o portão avaliar."
          fecha
        />
      </section>
    );
  }

  const proporcao = (etapa3.podeSomar / etapa3.fatos) * 100;

  return (
    <section>
      <TituloEtapa
        numero={3}
        titulo="o portão da semântica"
        descricao="Fato promovido não é fato somável. Só entra numa conta financeira o atributo cuja semântica foi confirmada por uma pessoa; o resto existe, é conferível, e fica parado até alguém confirmar."
        fecha
      />

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-6 rounded-md border bg-card p-5 mb-4">
        <Numero rotulo="Fatos no canônico" valor={n(etapa3.fatos)} />
        <Numero
          rotulo="Pode somar"
          valor={n(etapa3.podeSomar)}
          nota="semântica confirmada"
          tom="ok"
        />
        <Numero
          rotulo="Sem preço"
          valor={n(etapa3.semPreco)}
          nota="presumido ou desconhecido"
          tom={etapa3.semPreco > 0 ? "atencao" : undefined}
        />
        <Numero
          rotulo="Registram ausência"
          valor={n(etapa3.ausencias)}
          nota="célula vazia ou sentinela — ausência não é zero"
        />
      </dl>

      <div className="flex h-3 w-full rounded-sm overflow-hidden bg-muted mb-2">
        <div className="bg-emerald-500" style={{ width: `${proporcao}%` }} />
        <div className="bg-amber-500" style={{ width: `${100 - proporcao}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {pct(etapa3.podeSomar, etapa3.fatos)} dos fatos desta importação podem
        entrar numa soma hoje. O caminho para mudar esse número é a Curadoria.
      </p>

      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Semântica</th>
              <th className="text-right px-4 py-2 font-medium">Fatos</th>
              <th className="text-right px-4 py-2 font-medium">Destes, ausências</th>
              <th className="text-left px-4 py-2 font-medium w-[50%]">O que significa</th>
            </tr>
          </thead>
          <tbody>
            {etapa3.porSemantica.map((s) => (
              <tr key={s.status} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{s.status}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{n(s.fatos)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {n(s.ausencias)}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {SEMANTICA[s.status] ?? "Estado não descrito nesta tela."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SEMANTICA: Record<string, string> = {
  CONFIRMED:
    "Uma pessoa confirmou o que a coluna mede, em que unidade e com que periodicidade. É o único estado que autoriza somar.",
  PRESUMED:
    "O motor propôs uma leitura com o motivo escrito, e ninguém confirmou ainda. Serve para reconhecer o atributo; não serve para somá-lo.",
  UNKNOWN:
    "A coluna entrou e o produto não afirma nada sobre o que ela mede. É a resposta honesta enquanto não houver evidência.",
};

function rotuloDoDestino(balanco: BalancoImportacao, code: string): string {
  return balanco.destinos.find((d) => d.code === code)?.nome ?? code;
}

function n(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function pct(parte: number, total: number): string {
  if (total === 0) return "—";
  const valor = (parte / total) * 100;
  // Uma fatia pequena e não nula nunca vira "0%": é justamente a que interessa.
  if (valor > 0 && valor < 0.1) return "<0,1%";
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
