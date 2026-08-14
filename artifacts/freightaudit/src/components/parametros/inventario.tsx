import { useQuery } from "@tanstack/react-query";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJsonOrNull } from "@/lib/api";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";

/**
 * O inventário: uma linha por ativo, uma coluna por atributo.
 *
 * É a tela mais larga do Freightech — CARRETA abre com a placa à esquerda e
 * cinquenta colunas ao lado — e a que o operador usa para conferir um ativo
 * específico. Aqui ela é a mesma tabela, com a mesma ordem de colunas, lida do
 * nosso modelo canônico.
 *
 * **Três diferenças, e nenhuma é enfeite.**
 *
 * 1. **Célula sem valor não vira zero.** O Freightech mostra `0` onde o dado
 *    não veio; aqui a célula fica vazia com o motivo no `title`. Numa tabela de
 *    custo, "não informado" e "zero" são a diferença entre um ativo sem
 *    contrato e um ativo de graça.
 * 2. **Coluna que o dicionário não conhece é dita, não escondida.** Se o cartão
 *    pede uma coluna que o export não tem, ela aparece na nota acima da tabela.
 *    Sumir com ela faria a tabela parecer completa.
 * 3. **Colunas e ordenação são de quem lê.** Cinquenta colunas não cabem numa
 *    tela; o trilho lateral guarda quais ficam à mostra, por cartão.
 */

interface OndeEstaASerie {
  aliasTypes: { entityType: string; attributes: number }[];
  otherDeliveries: {
    entityType: string;
    contextLabel: string;
    effectiveDate: string;
    periodLabel: string;
    sourceLabel: string;
    sameContext: boolean;
  }[];
  receivedNotPromoted: {
    filename: string;
    sheetName: string;
    sheetRole: string;
    roleReason: string;
    importStatus: string;
    receivedAt: string;
  }[];
}

interface TabelaEntidades {
  seriesDelivered: boolean;
  attributesKnown: number;
  elsewhere: OndeEstaASerie;
  entityType: string;
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  columns: { code: string; title: string }[];
  missingColumns: string[];
  rows: {
    entityId: string;
    label: string | null;
    values: Record<string, { value: string | null; nullReason: string | null }>;
  }[];
}

type LinhaInventario = TabelaEntidades["rows"][number];

/**
 * Onde a série está, nomeada por vigência e contexto.
 *
 * Existe porque "não está aqui" é meia resposta. Quem importou a planilha
 * precisa saber para onde ela foi — e a diferença entre "outra vigência, mesmo
 * contexto" e "outra unidade" muda o que a pessoa faz em seguida, então as
 * entregas do contexto atual vêm primeiro e ditas como tal.
 */
function ListaDeEntregas({
  entregas,
}: {
  entregas: TabelaEntidades["elsewhere"]["otherDeliveries"];
}) {
  if (entregas.length === 0) return null;

  const ordenadas = [...entregas].sort(
    (a, b) => Number(b.sameContext) - Number(a.sameContext),
  );
  // Muitas vigências da mesma série viram uma lista sem foco; as primeiras já
  // dizem para onde ir, e o restante é contado em vez de despejado.
  const visiveis = ordenadas.slice(0, 6);

  return (
    <div className="text-xs text-muted-foreground space-y-1 pt-1">
      <p className="font-medium text-foreground">Onde esta série aparece:</p>
      <ul className="space-y-0.5">
        {visiveis.map((entrega) => (
          <li key={`${entrega.sourceLabel}-${entrega.entityType}-${entrega.contextLabel}`}>
            <span className="font-mono">{entrega.entityType}</span> · {entrega.periodLabel}{" "}
            · {entrega.contextLabel} ·{" "}
            <span className="font-mono">{entrega.sourceLabel}</span>
            {entrega.sameContext && " — mesmo contexto, outra vigência"}
          </li>
        ))}
      </ul>
      {ordenadas.length > visiveis.length && (
        <p>e mais {ordenadas.length - visiveis.length} entrega(s).</p>
      )}
    </div>
  );
}

export function TabelaInventario({
  entidade,
  atributos,
  contexto,
  idDaTabela,
}: {
  entidade: string;
  atributos: string[];
  contexto: URLSearchParams;
  idDaTabela: string;
}) {
  const query = new URLSearchParams(contexto);
  query.set("entityType", entidade);
  query.set("attributes", atributos.join(","));

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventario", entidade, query.toString()],
    queryFn: () => fetchJsonOrNull<TabelaEntidades>(`/entities/table?${query}`),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (error) {
    return <ApiErrorNotice error={error} what="O inventário não pôde ser carregado." />;
  }

  if (!data) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
        Nenhuma vigência deste contexto tem estes ativos.
      </div>
    );
  }

  /*
    Quando não voltou nada, dizer **por quê** — e a causa não é a que a tela
    supunha.

    A mensagem antiga era sempre a mesma: "estas 38 colunas não existem no
    dicionário do export". Ela é verdadeira e responde à pergunta errada quando
    a causa real é outra: o arquivo daquele equipamento nunca foi importado
    neste contexto. Aí não há coluna alguma dele no dicionário, todas as 38
    caem em `missingColumns`, e a frase culpa o cartão por uma planilha que
    falta.

    Depois "falta importar" também virou a resposta errada — dita para quem
    tinha acabado de importar `Modelo_Carreta.xlsx`. Uma tabela vazia tem
    quatro causas, e cada uma manda fazer uma coisa diferente:

    1. O arquivo entrou com **outra identidade** (MODELOCARRETA, do tempo em
       que o nome da aba era o tipo) → reimportar.
    2. O arquivo está em **outro contexto ou vigência** → trocar o filtro.
    3. O arquivo **chegou e parou** antes de virar vigência → ler o motivo.
    4. O arquivo **nunca chegou** → importar.

    A ordem abaixo é a das causas mais específicas primeiro; "importe" é a
    última coisa que a tela diz, e só quando procurou nas outras três.
  */
  if (data.rows.length === 0 && data.attributesKnown === 0) {
    const outraIdentidade = data.elsewhere.aliasTypes[0];

    /*
      "Nunca foi importado" é a conclusão certa só quando o banco não sabe de
      nada parecido. Quem acabou de subir `Modelo_Carreta.xlsx` e lê essa frase
      conclui, com razão, que a tela está mentindo: o arquivo chegou — o que
      não chegou foi a identidade que este cartão procura. Antes da correção de
      `deriveEntityType`, a aba `Modelo_Carreta` virava o tipo MODELOCARRETA, e
      corrigir a regra não reescreve o que já entrou no banco.
    */
    if (outraIdentidade) {
      return (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm space-y-2">
          <p className="font-medium">
            O arquivo de <span className="font-mono">{data.entityType}</span> chegou, mas
            entrou com outra identidade:{" "}
            <span className="font-mono">{outraIdentidade.entityType}</span>.
          </p>
          <p className="text-muted-foreground">
            O dicionário tem {outraIdentidade.attributes} colunas sob{" "}
            <span className="font-mono">{outraIdentidade.entityType}</span> e nenhuma sob{" "}
            <span className="font-mono">{data.entityType}</span> — é o nome da aba lido
            como sendo o próprio tipo, de uma importação anterior à correção dessa regra.
            Os dados estão certos e a identidade está errada, e por isso este cartão não
            os encontra.
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Reimportar a planilha não resolve</strong>{" "}
            — o ativo é reconhecido pela placa, então a reimportação reaproveita a mesma
            linha dele com o tipo antigo ainda gravado, e ainda deixa duas cópias de cada
            coluna e duas vigências vivas para o mesmo arquivo. O conserto é a correção de
            identidade, que a atualização do sistema aplica sobre o que já está no banco,
            sem tocar em nenhum fato.
          </p>
          <ListaDeEntregas entregas={data.elsewhere.otherDeliveries} />
        </div>
      );
    }

    if (data.elsewhere.otherDeliveries.length > 0) {
      return (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm space-y-2">
          <p className="font-medium">
            <span className="font-mono">{data.entityType}</span> foi importado, mas não
            neste contexto.
          </p>
          <p className="text-muted-foreground">
            O filtro atual — {data.periodLabel}, com o contexto escolhido acima — não
            alcança nenhuma dessas entregas. Trocar a vigência ou a unidade traz a tabela
            de volta; não falta importar nada.
          </p>
          <ListaDeEntregas entregas={data.elsewhere.otherDeliveries} />
        </div>
      );
    }

    /*
      O arquivo chegou e parou no caminho — e "parou" são dois estados que
      pedem coisas opostas.

      A primeira versão desta mensagem tinha uma frase só, mandando corrigir a
      planilha e reimportar. Ela está certa quando o classificador **recusou** a
      aba, e está errada — contradizendo a linha de cima — quando a aba foi
      aceita como `SOURCE` e a importação está parada em `PREVIEWED`: aí a
      planilha não tem defeito nenhum, a leitura terminou, e o que falta é
      alguém aprovar. Mandar corrigir uma planilha boa é pior do que não dizer
      nada: manda mexer no que está certo e esconde o passo que falta.

      `roleReason` também deixa de aparecer quando a aba foi aceita. Ele é a
      justificativa do classificador, não um defeito, e apresentá-lo como "o
      motivo registrado" logo depois de um pedido de correção fazia a aceitação
      parecer recusa.
    */
    const parado = data.elsewhere.receivedNotPromoted[0];
    if (parado) {
      const abaAceita = parado.sheetRole === "SOURCE";
      const falhou = parado.importStatus === "FAILED";
      const esperandoAprovacao = abaAceita && !falhou;

      return (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm space-y-2">
          <p className="font-medium">
            {esperandoAprovacao ? (
              <>
                O arquivo <span className="font-mono">{parado.filename}</span> chegou e está
                esperando aprovação.
              </>
            ) : (
              <>
                O arquivo <span className="font-mono">{parado.filename}</span> chegou, mas
                não virou vigência.
              </>
            )}
          </p>

          {esperandoAprovacao ? (
            <p className="text-muted-foreground">
              A aba <span className="font-mono">{parado.sheetName}</span> foi aceita como
              fonte de fatos e a importação está em{" "}
              <span className="font-mono">{parado.importStatus}</span> — a leitura terminou,
              e o passo que falta é humano. As colunas de{" "}
              <span className="font-mono">{data.entityType}</span> entram no dicionário na
              aprovação, não na leitura:{" "}
              <strong className="text-foreground">nada na planilha precisa ser mexido</strong>.
              Abra Importações e aprove.
            </p>
          ) : (
            <p className="text-muted-foreground">
              A aba <span className="font-mono">{parado.sheetName}</span> foi classificada
              como <span className="font-mono">{parado.sheetRole}</span>
              {falhou ? " e a importação falhou" : ""}, então nenhuma coluna de{" "}
              <span className="font-mono">{data.entityType}</span> entrou no dicionário.{" "}
              {falhou
                ? "A tela de Importações mostra o motivo da falha."
                : "O motivo registrado pelo classificador:"}{" "}
              {!falhou && <em>{parado.roleReason}</em>}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Nada foi descartado — o arquivo está inteiro no RAW.{" "}
            {esperandoAprovacao
              ? "A tela de Importações mostra os avisos deste arquivo antes de você aprovar."
              : "Corrigir a planilha e reimportar é o caminho; a tela de Importações mostra o resto dos avisos deste arquivo."}
          </p>
        </div>
      );
    }

    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm space-y-2">
        <p className="font-medium">
          Nenhum arquivo de <span className="font-mono">{data.entityType}</span> foi
          importado neste contexto.
        </p>
        <p className="text-muted-foreground">
          Não é que este cartão peça colunas erradas: o dicionário não conhece{" "}
          <strong className="text-foreground">nenhuma</strong> coluna deste equipamento —
          nem sob outro nome, nem em outra vigência ou unidade, e nenhum arquivo com uma
          aba deste equipamento chegou a ser recebido. As {atributos.length} colunas do
          cartão existem no Freightech e continuarão sem dado até a importação — o que
          falta é o arquivo, e não o cartão.
        </p>
      </div>
    );
  }

  if (data.rows.length === 0 && !data.seriesDelivered) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm space-y-2">
        <p className="font-medium">
          {data.periodLabel} não trouxe a série{" "}
          <span className="font-mono">{data.entityType}</span>.
        </p>
        <p className="text-muted-foreground">
          O equipamento existe no dicionário — {data.attributesKnown} colunas dele são
          conhecidas — mas o arquivo desta vigência não veio. A ausência não está contada
          como zero; escolha outra vigência ou importe a que falta.
        </p>
        <ListaDeEntregas entregas={data.elsewhere.otherDeliveries} />
      </div>
    );
  }

  /*
    A coluna de identidade só entra quando a placa **não voltou** — e a
    diferença entre "não voltou" e "não foi pedida" é o que importa aqui.
    CARRETA e CAVALO pedem a placa como primeira coluna, e repetir um "Ativo"
    idêntico ao lado seria a mesma informação duas vezes na tela mais larga do
    produto. Mas se o dicionário não conhecer aquela coluna, ela não volta — e
    olhar só para o que foi pedido deixaria a tabela sem nenhuma identidade,
    setenta e cinco colunas de números sem dizer de qual caminhão são.
  */
  const jaTemIdentidade = data.columns.some((coluna) => coluna.code.endsWith(".placa"));

  const colunas: ColunaTabela<LinhaInventario>[] = [
    ...(jaTemIdentidade
      ? []
      : [
          {
            titulo: "Ativo",
            alinhar: "left" as const,
            fixa: true,
            valor: (linha: LinhaInventario) => linha.label ?? "",
            celula: (linha: LinhaInventario) =>
              linha.label ? (
                <span className="font-mono font-medium">{linha.label}</span>
              ) : (
                <span className="text-muted-foreground italic text-xs">sem placa</span>
              ),
          },
        ]),
    ...data.columns.map(
      (coluna): ColunaTabela<LinhaInventario> => ({
        titulo: coluna.title,
        alinhar: "center",
        fixa: coluna.code.endsWith(".placa"),
        valor: (linha) => {
          const celula = linha.values[coluna.code];
          if (!celula || celula.value === null) return null;
          // Ordena por número quando o valor é número: numa coluna de custo,
          // ordenar "9.547,99" como texto o põe depois de "18.269,97".
          const numero = Number(celula.value);
          return Number.isFinite(numero) && celula.value.trim() !== ""
            ? numero
            : celula.value;
        },
        celula: (linha) => {
          const celula = linha.values[coluna.code];
          if (!celula) {
            return (
              <span className="text-muted-foreground" title="Coluna ausente neste ativo">
                —
              </span>
            );
          }
          if (celula.value === null) {
            return (
              <span
                className="text-muted-foreground italic text-xs"
                title={`Sem valor: ${celula.nullReason}`}
              >
                sem valor
              </span>
            );
          }
          return <span>{celula.value}</span>;
        },
      }),
    ),
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">{data.rows.length}</strong>{" "}
        {data.rows.length === 1 ? "ativo" : "ativos"} · {data.columns.length}{" "}
        {data.columns.length === 1 ? "coluna" : "colunas"} — {data.periodLabel}
        {data.sourceLabels.length > 0 && (
          <>
            {" · "}
            <span className="font-mono">{data.sourceLabels.join(", ")}</span>
          </>
        )}
        .
      </p>

      {data.missingColumns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.missingColumns.length}{" "}
          {data.missingColumns.length === 1
            ? "coluna deste cartão não existe no dicionário do export e ficou de fora"
            : "colunas deste cartão não existem no dicionário do export e ficaram de fora"}
          :{" "}
          <span className="font-mono">{data.missingColumns.join(", ")}</span>.{" "}
          {data.missingColumns.length === 1
            ? "Ela aparece no Freightech e não chega aqui."
            : "Elas aparecem no Freightech e não chegam aqui."}
        </p>
      )}

      <TabelaFreightech
        id={idDaTabela}
        colunas={colunas}
        linhas={data.rows}
        chave={(linha) => linha.entityId}
        vazio={
          <span className="text-sm text-muted-foreground">
            Nenhum ativo deste tipo nesta vigência.
          </span>
        }
      />
    </div>
  );
}
