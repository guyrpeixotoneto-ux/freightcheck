import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS, STATUS_STYLES } from "@/components/changes/ticket-table";
import { csvComoBlob, paraNomeDeArquivo } from "@/lib/csv";
import { cn } from "@/lib/utils";
import {
  COLUNAS_DA_RELACAO,
  diaDaOperacaoDe,
  diaLegivel,
  emCaixaDeTitulo,
  gravarColunasDaRelacao,
  lerColunasDaRelacao,
  situacaoDoPrazo,
  type AlteracaoDoChamado,
  type ChamadoNaFila,
  type ColunaDaRelacao,
} from "@/lib/monitoramento-de-chamados";

/**
 * CHAMADOS DO ENVIO — a relação que o arquivo trouxe, em tabela.
 *
 * A lista irmã de `lista-de-movimentacoes.tsx`, e diferente dela no que mostra:
 * ali cada linha é um **antes → depois** apurado pelo motor; aqui cada linha é
 * o chamado como a planilha o escreveu, tenha ele se mexido ou não. O selo
 * "movimentou" na coluna do número é a ponte entre as duas.
 *
 * ---------------------------------------------------------------------------
 * Tabela, e não mais a lista de cartões
 * ---------------------------------------------------------------------------
 *
 * Os cartões nasceram do argumento de que os campos variam por chamado — uns
 * têm placa, outros têm cargo — e que uma tabela pagaria colunas vazias. O
 * argumento vale para as **movimentações**, onde cada linha fala de um campo
 * diferente; não vale aqui: esta relação é a planilha, toda linha tem as mesmas
 * colunas do export, e quem confere lê de cima para baixo procurando a linha
 * que destoa. Numa tabela isso é varrer uma coluna; em cartões, é ler 1.218
 * blocos.
 *
 * A tabela é a mesma da aba Chamados, de propósito — caixa de seleção à
 * esquerda, linha que abre no clique, detalhe embaixo, rodapé do Freightech —
 * e quem navega as duas não deveria ter de aprender duas tabelas.
 *
 * O que **não** cabe em coluna vai para o detalhe da linha, e não some: a
 * vigência, a linha do arquivo, o item inteiro e o que foi pedido em cada
 * parâmetro. O detalhe traz tudo, inclusive o que a engrenagem escondeu.
 *
 * Não há botão de revisar: revisão é ato sobre **movimentação**, e oferecer o
 * carimbo aqui criaria um segundo estado de "revisado" que a régua não conta —
 * dois números certos e a leitura errada.
 */
export function ListaDeChamados({
  chamados,
  carregando,
  dia,
  pagina,
  porPagina,
  total,
  onPagina,
  onPorPagina,
  tamanhos,
  procedencia,
}: {
  chamados: ChamadoNaFila[];
  carregando: boolean;
  /**
   * O dia da relação — a régua do prazo.
   *
   * Não é `hoje`: abrir 16/08 em setembro tem de mostrar o que 16/08 mostrava.
   * Ver `situacaoDoPrazo`.
   */
  dia: string;
  pagina: number;
  porPagina: number;
  /** O total **depois dos filtros** — é ele que diz quantas páginas existem. */
  total: number;
  onPagina: (pagina: number) => void;
  onPorPagina: (porPagina: number) => void;
  tamanhos: number[];
  /** O arquivo de onde a relação saiu, para nomear o CSV da seleção. */
  procedencia: string;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [colunas, setColunas] = useState<ColunaDaRelacao[]>(lerColunasDaRelacao);
  /*
    A seleção guarda a linha inteira, e não só o id, pela razão da tabela da aba
    Chamados: ela atravessa a paginação, e quem marca três linhas na página 1 e
    duas na página 4 quer as cinco no arquivo — guardando só o id, as três
    primeiras sairiam do CSV ao virar a página, e sairiam caladas.
  */
  const [selecionados, setSelecionados] = useState<Map<string, ChamadoNaFila>>(
    new Map(),
  );

  const visiveis = COLUNAS_DA_RELACAO.filter((c) => colunas.includes(c.chave));

  const alternarColuna = (chave: ColunaDaRelacao) => {
    const proximas = COLUNAS_DA_RELACAO.map((c) => c.chave).filter((c) =>
      c === chave ? !colunas.includes(c) : colunas.includes(c),
    );
    setColunas(proximas);
    gravarColunasDaRelacao(proximas);
  };

  const alternarLinha = (chamado: ChamadoNaFila) =>
    setSelecionados((atual) => {
      const proxima = new Map(atual);
      if (proxima.has(chamado.id)) proxima.delete(chamado.id);
      else proxima.set(chamado.id, chamado);
      return proxima;
    });

  const marcarPagina = (marcado: boolean) =>
    setSelecionados((atual) => {
      const proxima = new Map(atual);
      // Desmarcar o cabeçalho limpa **esta página**, e não a seleção inteira:
      // as linhas marcadas em outras páginas não estão à vista para serem
      // desmarcadas por engano.
      for (const c of chamados) {
        if (marcado) proxima.set(c.id, c);
        else proxima.delete(c.id);
      }
      return proxima;
    });

  const todosMarcados =
    chamados.length > 0 && chamados.every((c) => selecionados.has(c.id));

  if (carregando && chamados.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      {selecionados.size > 0 && (
        <BarraDeSelecao
          chamados={[...selecionados.values()]}
          nestaPagina={chamados.filter((c) => selecionados.has(c.id)).length}
          dia={dia}
          procedencia={procedencia}
          onLimpar={() => setSelecionados(new Map())}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-9 px-2 py-3" />
              <th className="w-10 px-2 py-3">
                <Checkbox
                  className={ESTILO_CAIXA}
                  checked={todosMarcados}
                  onCheckedChange={(marcado) => marcarPagina(marcado === true)}
                  aria-label="selecionar os chamados desta página"
                />
              </th>
              <th className="px-2.5 py-3 text-left font-semibold">Chamado</th>
              {visiveis.map((coluna) => (
                <th
                  key={coluna.chave}
                  className={cn(
                    "px-2.5 py-3 text-left font-semibold whitespace-nowrap",
                    /*
                      O assunto é a coluna elástica: `w-full` faz o navegador
                      dar a ela toda a sobra da linha e tirar dela primeiro
                      quando falta espaço. Sem isso, a sobra se espalha por
                      todas as colunas e o assunto — que é a única de tamanho
                      imprevisível — fica com reticências numa tela larga.
                    */
                    coluna.chave === "assunto" && "w-full",
                  )}
                  title={coluna.dica}
                >
                  {coluna.rotulo}
                </th>
              ))}
              <th className="w-10 px-2 py-3">
                <SeletorDeColunas colunas={colunas} onAlternar={alternarColuna} />
              </th>
            </tr>
          </thead>
          <tbody>
            {chamados.map((c) => (
              <Fragment key={c.id}>
                <tr
                  className={cn(
                    "border-b hover:bg-muted/40 cursor-pointer",
                    selecionados.has(c.id) && "bg-blue-50/70",
                    aberta === c.id && "bg-muted/30",
                  )}
                  onClick={() => setAberta(aberta === c.id ? null : c.id)}
                >
                  <td className="px-2 py-2.5 text-muted-foreground">
                    {aberta === c.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </td>
                  <td
                    className="px-2 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      className={ESTILO_CAIXA}
                      checked={selecionados.has(c.id)}
                      onCheckedChange={() => alternarLinha(c)}
                      aria-label={`selecionar o chamado ${c.externalId}`}
                    />
                  </td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap">
                    <span className="font-bold text-primary tabular-nums">
                      {c.externalId}
                    </span>
                    {/*
                      A ponte com a outra visão fica colada no número, e não
                      numa coluna própria: ela é verdadeira em pouquíssimas
                      linhas, e uma coluna quase toda vazia diria que a relação
                      está incompleta quando ela está certa.
                    */}
                    {c.movimentou && (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-50 text-amber-700"
                        title="este chamado se mexeu neste dia — o antes → depois está em Movimentações"
                      >
                        Movimentou
                      </span>
                    )}
                  </td>
                  {visiveis.map((coluna) => (
                    <td
                      key={coluna.chave}
                      className={cn(
                        "px-2.5 py-2.5",
                        // `max-w-0` é o par de `w-full` no cabeçalho: sem ele o
                        // conteúdo define o mínimo da célula e a coluna nunca
                        // encolhe — o texto vaza em vez de virar reticências.
                        coluna.chave === "assunto" && "w-full max-w-0",
                      )}
                    >
                      <Celula coluna={coluna.chave} chamado={c} dia={dia} />
                    </td>
                  ))}
                  <td />
                </tr>

                {aberta === c.id && (
                  <tr className="border-b bg-muted/30">
                    <td />
                    <td colSpan={visiveis.length + 3} className="px-2.5 pb-4 pt-1">
                      <DetalheDoChamado chamado={c} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Paginacao
        pagina={pagina}
        porPagina={porPagina}
        total={total}
        onPagina={onPagina}
        onPorPagina={onPorPagina}
        tamanhos={tamanhos}
        unidade="chamados"
      />
    </div>
  );
}

/** A mesma caixa azul da tabela da aba Chamados: marcar é apontar, não agir. */
const ESTILO_CAIXA =
  "border-input data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 data-[state=checked]:text-white";

/** Uma célula da tabela — o valor do arquivo, na forma que a coluna pede. */
function Celula({
  coluna,
  chamado,
  dia,
}: {
  coluna: ColunaDaRelacao;
  chamado: ChamadoNaFila;
  dia: string;
}) {
  switch (coluna) {
    case "status":
      return (
        <span
          className={cn(
            "inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
            STATUS_STYLES[chamado.statusBucket] ?? STATUS_STYLES.DESCONHECIDO,
          )}
          title={`agrupado como "${STATUS_LABELS[chamado.statusBucket] ?? chamado.statusBucket}"`}
        >
          {chamado.statusRaw ?? STATUS_LABELS[chamado.statusBucket] ?? "sem status"}
        </span>
      );

    case "assunto":
      /*
        O assunto é a única frase que a fonte escreve sobre o chamado, e numa
        tabela ele é o campo que mais varia de tamanho. Cortar com `title` é o
        acordo: a coluna não empurra as outras para fora da tela, e o texto
        inteiro está a um passar de mouse — e no detalhe da linha, sem corte.
      */
      return (
        <span
          className="block truncate"
          title={chamado.assunto ?? undefined}
        >
          {chamado.assunto ?? <Vazio />}
        </span>
      );

    case "unidade":
      return <Texto valor={chamado.unidade} />;

    case "tipo":
      return <Texto valor={chamado.area} />;

    case "solicitante":
      // E-mail não é dobrado em caixa de título: `Joao.Moura@` não é o mesmo
      // endereço que a fonte escreveu, e endereço é identidade.
      return (
        <span
          className="block max-w-[22ch] truncate"
          title={chamado.solicitante ?? undefined}
        >
          {chamado.solicitante ?? <Vazio />}
        </span>
      );

    case "operador":
      return <Texto valor={chamado.operador} />;

    case "abertoEm":
      return <Data iso={chamado.abertoEm} />;

    case "alteradoEmFonte":
      return <Data iso={chamado.alteradoEmFonte} />;

    case "sla":
      return <SeloDoPrazo chamado={chamado} dia={dia} />;

    case "situacao":
      return chamado.encerradoEm ? (
        <span
          className="inline-block rounded border border-input bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
          title={`encerrado em ${diaLegivel(diaDaOperacaoDe(chamado.encerradoEm))}, como o arquivo declara`}
        >
          Encerrado
        </span>
      ) : (
        <span
          className="inline-block rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 whitespace-nowrap"
          title="sem data de fechamento no arquivo"
        >
          Em aberto
        </span>
      );
  }
}

/** Texto do arquivo em caixa de título, com o original no `title`. */
function Texto({ valor }: { valor: string | null }) {
  if (valor === null || valor === "") return <Vazio />;
  return (
    <span className="block max-w-[13ch] truncate" title={valor}>
      {emCaixaDeTitulo(valor)}
    </span>
  );
}

/** Uma data do arquivo, no fuso da operação. Ver `diaDaOperacaoDe`. */
function Data({ iso }: { iso: string | null }) {
  if (iso === null) return <Vazio />;
  return (
    <span className="tabular-nums whitespace-nowrap">
      {diaLegivel(diaDaOperacaoDe(iso))}
    </span>
  );
}

/**
 * O campo que o arquivo não trouxe.
 *
 * Um traço, e não a célula em branco: em branco parece coluna quebrada, e o
 * traço diz que a pergunta foi feita e a resposta não veio.
 */
function Vazio() {
  return <span className="text-muted-foreground">—</span>;
}

/** O selo do prazo. A régua é `situacaoDoPrazo`, e ela é a do servidor. */
function SeloDoPrazo({
  chamado,
  dia,
}: {
  chamado: ChamadoNaFila;
  dia: string;
}) {
  const situacao = situacaoDoPrazo(chamado, dia);
  if (situacao === null) return <Vazio />;

  const prazo = diaLegivel(chamado.prazoPrevisto!);
  return situacao === "ATRASADO" ? (
    <span
      className="inline-block rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 whitespace-nowrap"
      title={`prazo previsto para ${prazo} e o chamado segue em aberto`}
    >
      Atrasado
    </span>
  ) : (
    <span
      className="inline-block rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-900 whitespace-nowrap"
      title={`prazo previsto para ${prazo}`}
    >
      No prazo
    </span>
  );
}

/**
 * A engrenagem do cabeçalho — o que fica à vista.
 *
 * A coluna do número não está na lista: escondê-la deixaria uma tabela de
 * atributos de chamado nenhum. A escolha sobrevive à próxima abertura em
 * `localStorage`, e é de quem olha — ver `lerColunasDaRelacao`.
 */
function SeletorDeColunas({
  colunas,
  onAlternar,
}: {
  colunas: ColunaDaRelacao[];
  onAlternar: (chave: ColunaDaRelacao) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="escolher as colunas da tabela"
        title="escolher as colunas da tabela"
      >
        <Settings2 className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Colunas da tabela
        </div>
        <div className="space-y-2">
          {COLUNAS_DA_RELACAO.map((coluna) => (
            <label
              key={coluna.chave}
              className="flex cursor-pointer items-center gap-2 text-sm normal-case"
              title={coluna.dica}
            >
              <Checkbox
                className={ESTILO_CAIXA}
                checked={colunas.includes(coluna.chave)}
                onCheckedChange={() => onAlternar(coluna.chave)}
              />
              {coluna.rotulo}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground normal-case">
          Esconder uma coluna não tira o campo do chamado: ele continua no
          detalhe da linha.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * O que a seleção vale aqui.
 *
 * Na aba Chamados a seleção soma impacto; nesta relação não há o que somar —
 * ela é o arquivo, não a apuração. O que ela faz é o que quem confere pede: o
 * recorte marcado vira CSV, com as mesmas colunas da tela mais o que só existe
 * no detalhe. Uma caixa de seleção que não leva a nada é pior do que caixa
 * nenhuma.
 */
function BarraDeSelecao({
  chamados,
  nestaPagina,
  dia,
  procedencia,
  onLimpar,
}: {
  chamados: ChamadoNaFila[];
  nestaPagina: number;
  dia: string;
  procedencia: string;
  onLimpar: () => void;
}) {
  const total = chamados.length;
  const deOutrasPaginas = total - nestaPagina;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b bg-blue-50/70 px-4 py-2.5 text-sm">
      <div>
        <span className="font-semibold tabular-nums">{total}</span>{" "}
        {total === 1 ? "chamado selecionado" : "chamados selecionados"}
        {deOutrasPaginas > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {deOutrasPaginas} de outras páginas
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => baixarCsv(chamados, dia, procedencia)}
        >
          <Download className="h-4 w-4" />
          Baixar CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={onLimpar}>
          <X className="h-4 w-4" />
          Limpar
        </Button>
      </div>
    </div>
  );
}

/**
 * O CSV do que está marcado.
 *
 * Leva **todas** as colunas, e não as que a engrenagem deixou à vista: esconder
 * uma coluna é preferência de leitura na tela, e um arquivo que obedecesse a
 * ela sairia mutilado sem avisar. Os parâmetros vão numa coluna só, no formato
 * que a linha mostra (`campo SET 4 → 7`), porque uma linha por parâmetro faria
 * o arquivo ter mais linhas do que a seleção tinha chamados.
 */
function baixarCsv(
  chamados: ChamadoNaFila[],
  dia: string,
  procedencia: string,
): void {
  const dataDoArquivo = (iso: string | null) =>
    iso ? diaLegivel(diaDaOperacaoDe(iso)) : "";

  const cabecalho = [
    "Chamado",
    "Status",
    "Assunto",
    "Unidade",
    "Tipo",
    "Solicitante",
    "Operador",
    "Responsável",
    "Aberto em",
    "Alterado na fonte",
    "Prazo previsto",
    "SLA",
    "Situação",
    "Encerrado em",
    "Vigência",
    "Categoria",
    "Item",
    "Linha do arquivo",
    "Parâmetros",
    "Movimentou no dia",
  ];

  const linhas = chamados.map((c) => [
    c.externalId,
    c.statusRaw ?? STATUS_LABELS[c.statusBucket] ?? "",
    c.assunto ?? "",
    c.unidade ?? "",
    c.area ?? "",
    c.solicitante ?? "",
    c.operador ?? "",
    c.responsavel ?? "",
    dataDoArquivo(c.abertoEm),
    dataDoArquivo(c.alteradoEmFonte),
    c.prazoPrevisto ? diaLegivel(c.prazoPrevisto) : "",
    c.sla ?? "",
    c.encerradoEm ? "Encerrado" : "Em aberto",
    dataDoArquivo(c.encerradoEm),
    c.vigencia ?? "",
    c.categoria ?? "",
    c.item ?? "",
    String(c.linhaDoArquivo),
    (c.alteracoes ?? []).map(textoDaAlteracao).join(" | "),
    c.movimentou ? "sim" : "não",
  ]);

  const url = URL.createObjectURL(csvComoBlob([cabecalho, ...linhas]));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${paraNomeDeArquivo(`chamados-${procedencia}-${dia}`)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * O detalhe da linha — o que não coube em coluna, e o que a coluna escondeu.
 *
 * Duas seções, como a tabela da aba Chamados: o que identifica o chamado no
 * arquivo, e o que a fonte declarou sobre o andamento dele. O que foi pedido em
 * cada parâmetro fica aqui porque é o conteúdo do chamado — e porque ele não
 * cabe numa célula sem virar reticências.
 */
function DetalheDoChamado({ chamado }: { chamado: ChamadoNaFila }) {
  const alteracoes = chamado.alteracoes ?? [];
  const dataDoArquivo = (iso: string | null) =>
    iso ? diaLegivel(diaDaOperacaoDe(iso)) : null;

  return (
    <div className="grid gap-6 rounded-lg border bg-card px-4 py-3 md:grid-cols-2">
      <Secao titulo="Detalhes do chamado">
        <Campo rotulo="Vigência" valor={chamado.vigencia} />
        <Campo rotulo="Linha do arquivo" valor={`Linha ${chamado.linhaDoArquivo}`} />
        <Campo rotulo="Categoria" valor={chamado.categoria} />
        <Campo rotulo="Item" valor={chamado.item ?? chamado.entidade} largo />
        <div className="col-span-3">
          <Rotulo>
            {alteracoes.length === 1 ? "Campo alterado" : "Campos alterados"}
          </Rotulo>
          <Parametros alteracoes={alteracoes} total={chamado.parametros} />
        </div>
      </Secao>

      <Secao titulo="Informações adicionais">
        <Campo
          rotulo="Prazo previsto"
          valor={chamado.prazoPrevisto ? diaLegivel(chamado.prazoPrevisto) : null}
        />
        <Campo rotulo="SLA" valor={chamado.sla} />
        <Campo rotulo="Aberto em" valor={dataDoArquivo(chamado.abertoEm)} />
        <Campo rotulo="Criado por" valor={chamado.solicitante} largo />
        <Campo
          rotulo="Encerrado em"
          valor={dataDoArquivo(chamado.encerradoEm) ?? "ainda em aberto"}
        />
        <Campo rotulo="Responsável" valor={chamado.responsavel} largo />
      </Secao>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3">{children}</dl>
    </div>
  );
}

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <dt className="text-xs text-muted-foreground">{children}</dt>
  );
}

/** Um campo do detalhe. Campo sem valor mostra o traço, e não some. */
function Campo({
  rotulo,
  valor,
  largo = false,
}: {
  rotulo: string;
  valor: string | null;
  largo?: boolean;
}) {
  return (
    <div className={cn("min-w-0", largo && "col-span-2")}>
      <Rotulo>{rotulo}</Rotulo>
      <dd className="truncate text-sm" title={valor ?? undefined}>
        {valor ?? <Vazio />}
      </dd>
    </div>
  );
}

/**
 * O que o chamado pediu, parâmetro a parâmetro.
 *
 * É o conteúdo do chamado, e era o que a relação mais escondia: "1 parâmetro"
 * dizia que havia algo a ver sem dizer o quê, e quem conferia tinha de abrir a
 * planilha para descobrir que o pedido era `quantidadeOrdenado: 4 → 7`.
 *
 * A alteração sem valores não é buraco: num export real a maioria não é `SET` —
 * é `FORM_THIS`, troca de fórmula, que muda a remuneração sem existir "de 10
 * para 12". Por isso a operação aparece ao lado do campo, e o par de valores só
 * quando há par: uma seta com dois traços diria que o dado se perdeu.
 */
function Parametros({
  alteracoes,
  total,
}: {
  alteracoes: AlteracaoDoChamado[];
  total: number;
}) {
  if (alteracoes.length === 0) {
    // Sem a relação, ainda há a contagem que o envio gravou.
    return (
      <dd className="mt-1 text-sm text-muted-foreground">
        {total > 0
          ? `${total} ${total === 1 ? "parâmetro" : "parâmetros"}`
          : "Nenhum parâmetro neste chamado"}
      </dd>
    );
  }

  return (
    <dd className="mt-1 flex flex-wrap items-center gap-1.5">
      {alteracoes.map((a, i) => (
        <span
          key={`${i}-${a.parametro}`}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
        >
          <span className="font-medium">{a.parametro}</span>
          {a.operacao && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {a.operacao}
            </span>
          )}
          {temValores(a) && (
            <span className="tabular-nums text-muted-foreground">
              {a.de ?? "—"} <span aria-hidden>→</span> {a.para ?? "—"}
            </span>
          )}
        </span>
      ))}
    </dd>
  );
}

/** O mesmo texto do chip, numa célula de CSV. */
function textoDaAlteracao(a: AlteracaoDoChamado): string {
  const cabeca = [a.parametro, a.operacao].filter(Boolean).join(" ");
  return temValores(a) ? `${cabeca} ${a.de ?? "—"} → ${a.para ?? "—"}` : cabeca;
}

/**
 * Há um par de valores para mostrar?
 *
 * O `-` do export conta como ausência: é como o Freightech escreve "não se
 * aplica" nas linhas que não são `SET`, e mostrá-lo como valor faria a linha
 * dizer "de - para -", que parece dado corrompido e não é.
 */
function temValores(a: AlteracaoDoChamado): boolean {
  const valor = (v: string | null) => v !== null && v.trim() !== "" && v.trim() !== "-";
  return valor(a.de) || valor(a.para);
}
