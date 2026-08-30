import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Radio, CalendarRange } from "lucide-react";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * De que unidade, canal e vigência o Assistente vai falar — **escolhido**.
 *
 * **O que existia antes.** O recorte era exibido acima da resposta e nunca
 * escolhido: os dois links do produto para `/assistente` são nus, e sem
 * `scopeHash` o servidor cai no primeiro contexto que o banco devolve — o de
 * vigência mais recente. Numa base multi-unidade isso quer dizer que a unidade
 * da resposta muda sozinha quando chega uma importação nova, sem que ninguém
 * tenha mexido em nada. Mostrar a escolha sem permitir a escolha é a metade
 * pior das duas.
 *
 * **O estado mora na URL, não aqui.** É a mesma regra das outras telas deste
 * produto: o endereço volta ao mesmo lugar e pode ser mandado para outra
 * pessoa. É também o que faz o link da barra lateral carregar o recorte de
 * onde a pessoa estava — sem um store global e sem a tela precisar saber quem
 * a chamou.
 *
 * **Um campo com uma opção só não finge ser escolha.** Enquanto houver uma
 * unidade no banco, ela aparece como rótulo, não como seletor: um `<select>` de
 * um item é uma promessa de variedade que o dado não tem. É a mesma decisão da
 * barra de contexto da tela de Alterações.
 */

export interface ContextoDisponivel {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periodosDisponiveis: string[];
}

export interface RecorteEscolhido {
  scopeHash?: string;
  canal?: string;
  period?: string;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function rotuloDaVigencia(data: string): string {
  const [ano, mes] = data.split("-");
  return MESES[Number(mes) - 1] ? `${MESES[Number(mes) - 1]}/${ano}` : data;
}

function nomeDaUnidade(c: ContextoDisponivel): string {
  const unidade = c.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? c.scopeHash.slice(0, 8);
}

/**
 * O recorte lido da URL, completado com o que o banco tem.
 *
 * **A unidade escolhida vence; o resto se ajusta.** Quando alguém troca de
 * unidade, o canal e a vigência que estavam na URL podem não existir na nova —
 * e mantê-los produziria um pedido que o servidor recusa, ou pior, que ele
 * atende com outro recorte. Aqui eles caem para o que a unidade nova tem.
 */
export function completarRecorte(
  contextos: ContextoDisponivel[],
  pedido: RecorteEscolhido,
): { atual: ContextoDisponivel | null; period: string | undefined } {
  if (contextos.length === 0) return { atual: null, period: undefined };

  const daUnidade = pedido.scopeHash
    ? contextos.filter((c) => c.scopeHash === pedido.scopeHash)
    : contextos;
  const base = daUnidade.length > 0 ? daUnidade : contextos;

  const atual =
    base.find((c) => (c.channel ?? "") === (pedido.canal ?? "")) ?? base[0]!;
  const period =
    pedido.period && atual.periodosDisponiveis.includes(pedido.period)
      ? pedido.period
      : undefined;
  return { atual, period };
}

export function SeletorDeRecorte({
  recorte,
  aoTrocar,
}: {
  recorte: RecorteEscolhido;
  aoTrocar: (novo: RecorteEscolhido) => void;
}) {
  const contextos = useQuery({
    queryKey: ["assistant-contexts"],
    queryFn: () => fetchJson<ContextoDisponivel[]>("/contexts"),
  });

  const lista = useMemo(() => contextos.data ?? [], [contextos.data]);
  const { atual, period } = useMemo(
    () => completarRecorte(lista, recorte),
    [lista, recorte],
  );

  /*
    Sem contexto resolvido não há o que escolher, e o silêncio aqui é honesto:
    a tela de erro da API já aparece acima quando o servidor não responde, e um
    seletor vazio ao lado dela seria ruído.
  */
  if (!atual) return null;

  const unidades = [...new Map(lista.map((c) => [c.scopeHash, c])).values()];
  const canais = lista.filter((c) => c.scopeHash === atual.scopeHash);
  const vigencias = atual.periodosDisponiveis;

  const campo =
    "text-xs bg-transparent border-0 outline-none focus-visible:ring-1 focus-visible:ring-brand rounded-sm px-1 py-0.5 cursor-pointer text-foreground font-semibold";
  /*
    `shrink-0` e um respiro menor no celular.

    Estes três campos vivem numa linha que rola de lado num telefone (ver
    abaixo): sem `shrink-0` o flex os espremeria até o rótulo caber — que é o
    contrário do que uma linha rolável quer — e o `py-2` de tela grande é
    altura que, no celular, sai da conversa.
  */
  const caixa =
    "flex shrink-0 items-center gap-2 border border-input rounded-lg px-2.5 py-1.5 md:px-3 md:py-2 bg-card";

  return (
    /*
      Alinhado à direita só quando ele está à direita.

      Abaixo de `md` o cabeçalho empilha (ver `assistente.tsx`) e estes campos
      ocupam a linha inteira: encostados na borda direita, eles ficavam
      desalinhados do título que está logo acima, à esquerda.
    */
    <div
      className="flex flex-col items-start md:items-end gap-1.5 min-w-0 w-full md:w-auto"
      data-testid="seletor-de-recorte"
    >
      {/*
        NO CELULAR OS TRÊS CAMPOS SÃO UMA LINHA QUE ROLA, E NÃO DUAS QUE QUEBRAM.

        Somados eles são mais largos que um telefone, então o `flex-wrap` os
        jogava para uma segunda linha: dois andares de campo em cima de uma
        conversa que já começa depois do cabeçalho da casca. Numa linha só que
        rola de lado, o terceiro campo aparece cortado na borda — que é como se
        diz "tem mais aqui" sem gastar um andar — e a conversa ganha a altura
        que a segunda linha tomava.

        De `md` para cima nada muda: volta a ser o mesmo bloco que quebra à
        direita do título.
      */}
      <div className="flex w-full md:w-auto flex-nowrap md:flex-wrap items-center justify-start md:justify-end gap-2 overflow-x-auto md:overflow-visible">
      <div className={caixa}>
        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        {unidades.length > 1 ? (
          <select
            className={campo}
            aria-label="Unidade"
            value={atual.scopeHash}
            onChange={(e) => aoTrocar({ scopeHash: e.target.value })}
          >
            {unidades.map((c) => (
              <option key={c.scopeHash} value={c.scopeHash}>
                {nomeDaUnidade(c)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium px-1">{nomeDaUnidade(atual)}</span>
        )}
      </div>

      <div className={caixa}>
        <Radio className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        {canais.length > 1 ? (
          <select
            className={campo}
            aria-label="Canal"
            value={atual.channel ?? ""}
            onChange={(e) =>
              aoTrocar({ scopeHash: atual.scopeHash, canal: e.target.value || undefined })
            }
          >
            {canais.map((c) => (
              <option key={c.channel ?? ""} value={c.channel ?? ""}>
                {c.channel ?? "sem canal"}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium px-1">{atual.channel ?? "sem canal"}</span>
        )}
      </div>

      <div className={caixa}>
        <CalendarRange className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        <select
          className={campo}
          aria-label="Vigência"
          value={period ?? ""}
          onChange={(e) =>
            aoTrocar({
              scopeHash: atual.scopeHash,
              ...(atual.channel !== null ? { canal: atual.channel } : {}),
              ...(e.target.value ? { period: e.target.value } : {}),
            })
          }
        >
          {/*
            "A mais recente" é uma opção de verdade, e não o item vazio de um
            seletor mal preenchido: ela é o que a pessoa quer na maioria dos
            dias, e escolhê-la faz a conversa acompanhar a próxima importação
            em vez de ficar presa numa data que hoje é a última e amanhã não é.
          */}
          <option value="">todas as vigências</option>
          {vigencias.map((v) => (
            <option key={v} value={v}>
              {rotuloDaVigencia(v)}
            </option>
          ))}
        </select>
        </div>
      </div>

      {/*
        A frase fica **abaixo** dos três campos, e não ao lado deles.

        Ao lado ela competia com os seletores pela mesma linha e encolhia a
        primeira coisa que a pessoa procura ali — a unidade. Embaixo ela lê
        como legenda dos três, que é o que ela é.
      */}
      <span className={cn("text-2xs text-muted-foreground", "hidden sm:inline")}>
        as respostas descrevem este recorte
      </span>
    </div>
  );
}
