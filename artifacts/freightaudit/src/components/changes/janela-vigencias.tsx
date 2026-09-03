import { AlertTriangle, CalendarRange, CheckCircle2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dataCurta } from "@/lib/justificativas";
import { cn } from "@/lib/utils";

/**
 * O recorte De / Até — **um só, para as quatro abas de Alterações**.
 *
 * Existe como componente e não como quatro blocos de JSX porque o recorte não é
 * enfeite de tela: ele muda quais vigências entram na conta, e as abas precisam
 * concordar sobre isso ao ponto de o usuário poder trocar de aba no meio de uma
 * pergunta. Quatro cópias divergiriam na primeira vez que alguém corrigisse uma
 * delas.
 *
 * O que **não** é igual nas quatro é o eixo por baixo, e vale ter isso à vista:
 * Planilha, Impacto e Cliente escolhem entre as vigências que aquela unidade
 * importou; Chamados escolhe entre as que os próprios chamados declaram. As
 * datas querem dizer a mesma coisa, mas uma pode existir de um lado e não do
 * outro — ver `disponiveis` e a nota sobre a ponta escolhida abaixo.
 *
 * **As opções vêm do servidor, e não de um calendário.** Este produto não tem
 * dias: tem vigências, e as escolhíveis são exatamente as que o contexto
 * entregou (`context.periodosDisponiveis`). Um seletor de datas deixaria
 * escolher 15/03, que não é vigência nenhuma, e a resposta seria um recorte
 * vazio indistinguível de "nada mudou".
 *
 * **O "Até" não oferece datas anteriores ao "De".** Um intervalo invertido é
 * recusado pelo servidor com a frase certa, mas deixar escolhê-lo na tela seria
 * oferecer um erro — e o servidor continua conferindo, porque a URL colada no
 * chat não passa por este componente.
 */
export interface JanelaDeVigencias {
  de?: string;
  ate?: string;
}

/** `?de=&ate=` para a query, só com o que foi escolhido. */
export function janelaParaQuery(janela: JanelaDeVigencias): string {
  const params = new URLSearchParams();
  if (janela.de) params.set("de", janela.de);
  if (janela.ate) params.set("ate", janela.ate);
  const texto = params.toString();
  return texto === "" ? "" : `&${texto}`;
}

export function SeletorDeJanela({
  /** Todas as vigências do contexto, da mais antiga à mais recente. */
  disponiveis,
  /** Rótulo de cada vigência, quando a tela souber — `EMPURRADA_2_7_2026`. */
  rotulos,
  janela,
  onJanela,
  /** Quantas vigências caem no recorte, como o servidor as contou. */
  noRecorte,
  /**
   * Se esta leitura precisa de **duas** vigências para dizer alguma coisa.
   *
   * Verdadeiro onde a resposta é uma comparação — Planilha, Impacto, Cliente
   * medem a diferença entre vigências vizinhas, e um recorte de uma só devolve
   * "nada mudou" quando a resposta certa é "não há par". Falso na aba Chamados,
   * onde cada chamado se sustenta sozinho: uma vigência ali é um recorte
   * legítimo, e avisar sobre ele seria inventar um problema.
   */
  precisaDePar = true,
}: {
  disponiveis: string[];
  rotulos?: Record<string, string>;
  janela: JanelaDeVigencias;
  onJanela: (j: JanelaDeVigencias) => void;
  noRecorte?: number;
  precisaDePar?: boolean;
}) {
  /*
    A ponta escolhida entra na lista mesmo quando não é uma vigência **daqui**.

    As quatro abas partilham um recorte só, e os eixos não são idênticos: o das
    três primeiras são as vigências do contexto, e o da aba Chamados são as que
    os chamados declaram. Uma ponta escolhida de um lado pode não existir do
    outro, e um `Select` cujo valor não está entre os itens desenha um campo
    **vazio** — a tela mostraria "sem recorte" enquanto respondia recortada.
    Aqui ela aparece, marcada, e o botão de limpar continua ao lado.
  */
  const escolhidas = [janela.de, janela.ate].filter(
    (d): d is string => d !== undefined,
  );
  const opcoes = [...new Set([...disponiveis, ...escolhidas])].sort();

  /*
    Com uma opção só não há recorte a fazer, e um seletor de um item é uma
    promessa de variedade que o dado não tem — a mesma regra que a barra de
    contexto já aplica à unidade e ao canal.
  */
  if (opcoes.length < 2) return null;

  const de = janela.de ?? opcoes[0];
  const ate = janela.ate ?? opcoes[opcoes.length - 1];
  const recortado = janela.de !== undefined || janela.ate !== undefined;
  const daqui = (d: string) => disponiveis.includes(d);
  const rotulo = (d: string) => rotulos?.[d] ?? dataCurta(d);

  const item = (d: string, desabilitado: boolean) => (
    <SelectItem key={d} value={d} disabled={desabilitado}>
      {rotulo(d)}
      {!daqui(d) && (
        <span className="text-xs text-muted-foreground"> · sem dado aqui</span>
      )}
    </SelectItem>
  );

  /*
    Quantas vigências o recorte alcançou — e se isso basta para responder.

    O sinal fica ao lado do número porque as duas leituras são diferentes de
    longe e idênticas de perto: "6 de 6" com um visto verde é a comparação
    inteira; a mesma frase sem sinal nenhum era lida como enfeite do seletor. E
    quando o recorte não alcança um par, o triângulo diz que a tela abaixo não
    vai responder — antes de ela abrir vazia.
  */
  const bastam =
    noRecorte === undefined || noRecorte >= (precisaDePar ? 2 : 1);
  const contagem =
    noRecorte === undefined
      ? null
      : noRecorte === 0
        ? // Zero é o recorte que não alcançou nada — diferente de "nada mudou",
          // e diferente de uma vigência só.
          "nenhuma vigência aqui dentro do recorte"
        : precisaDePar && noRecorte < 2
          ? /*
              Uma vigência só não tem par para comparar, e "nada mudou" seria a
              resposta errada para a pergunta certa. A tela diz qual dos dois é,
              porque de fora eles são idênticos.
            */
            "uma vigência só — não há par para comparar"
          : `${noRecorte} de ${disponiveis.length} vigências`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CalendarRange className="w-4 h-4" />
        Vigências
      </span>

      <Select value={de} onValueChange={(v) => onJanela({ ...janela, de: v })}>
        <SelectTrigger className="h-10 w-60 rounded-lg text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{opcoes.map((d) => item(d, d > ate))}</SelectContent>
      </Select>

      <span className="text-sm text-muted-foreground">até</span>

      <Select value={ate} onValueChange={(v) => onJanela({ ...janela, ate: v })}>
        <SelectTrigger className="h-10 w-60 rounded-lg text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{opcoes.map((d) => item(d, d < de))}</SelectContent>
      </Select>

      {contagem !== null && (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm",
            bastam ? "text-muted-foreground" : "text-warning-foreground",
          )}
        >
          {bastam ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          {contagem}
        </span>
      )}

      {recortado && <LimparRecorte onLimpar={() => onJanela({})} />}
    </div>
  );
}

/**
 * O desfazer do recorte, fora do seletor.
 *
 * Existe separado porque o lugar onde ele mais faz falta é justamente onde o
 * seletor não está: quando o servidor **recusa** o recorte. As pontas são
 * conferidas contra as vigências do contexto e uma ponta que ele não tem volta
 * como 400 com a lista das que existem — resposta certa, e escolhida de
 * propósito em vez de aparar em silêncio. Só que todas as abas escondem o
 * conteúdo (o seletor junto) quando a leitura falha, e o recorte fica aceso sem
 * nada na tela que o apague. Recarregar a página era a única saída.
 *
 * Isso deixou de ser hipótese quando a aba Chamados passou a recortar pelo eixo
 * dela: um chamado pode nomear uma vigência que aquela unidade nunca importou.
 */
export function LimparRecorte({ onLimpar }: { onLimpar: () => void }) {
  return (
    <button
      onClick={onLimpar}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <X className="w-3.5 h-3.5" />
      série inteira
    </button>
  );
}

/**
 * O aviso de falha com a saída ao lado, quando há recorte para desfazer.
 *
 * Envolve o `ApiErrorNotice` de quem lê com recorte, e não o substitui: a frase
 * do servidor continua sendo a resposta — ela nomeia a ponta recusada e lista as
 * vigências que existem —, e o que faltava era poder agir sobre ela sem sair da
 * tela. Sem recorte aceso não acrescenta nada, e some.
 */
export function RecusaDoRecorte({
  janela,
  onJanela,
  children,
}: {
  janela: JanelaDeVigencias;
  onJanela?: (j: JanelaDeVigencias) => void;
  children: React.ReactNode;
}) {
  const recortado = janela.de !== undefined || janela.ate !== undefined;
  if (!recortado || !onJanela) return <>{children}</>;

  return (
    <div className="space-y-2">
      {children}
      <LimparRecorte onLimpar={() => onJanela({})} />
    </div>
  );
}
