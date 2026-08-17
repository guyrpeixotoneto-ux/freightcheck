import { CalendarRange, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * O recorte De / Até — **um só, para as duas abas que o respeitam**.
 *
 * Existe como componente e não como dois blocos de JSX porque o recorte não é
 * enfeite de tela: ele muda quais vigências entram na conta, e Impacto e
 * Cliente precisam concordar sobre isso ao ponto de o usuário poder trocar de
 * aba no meio de uma pergunta. Duas cópias divergiriam na primeira vez que
 * alguém corrigisse uma delas.
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

/** `2026-08-01` → `01/08/26`, como a planilha do cliente escreve. */
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano.slice(2)}` : iso;
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
}: {
  disponiveis: string[];
  rotulos?: Record<string, string>;
  janela: JanelaDeVigencias;
  onJanela: (j: JanelaDeVigencias) => void;
  noRecorte?: number;
}) {
  /*
    Com uma vigência só não há recorte a fazer, e um seletor de um item é uma
    promessa de variedade que o dado não tem — a mesma regra que a barra de
    contexto já aplica à unidade e ao canal.
  */
  if (disponiveis.length < 2) return null;

  const de = janela.de ?? disponiveis[0];
  const ate = janela.ate ?? disponiveis[disponiveis.length - 1];
  const recortado = janela.de !== undefined || janela.ate !== undefined;
  const rotulo = (d: string) => rotulos?.[d] ?? dataCurta(d);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <CalendarRange className="w-3.5 h-3.5" />
        Vigências
      </span>

      <Select value={de} onValueChange={(v) => onJanela({ ...janela, de: v })}>
        <SelectTrigger className="h-8 w-56 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {disponiveis.map((d) => (
            <SelectItem key={d} value={d} disabled={d > ate}>
              {rotulo(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-muted-foreground">até</span>

      <Select value={ate} onValueChange={(v) => onJanela({ ...janela, ate: v })}>
        <SelectTrigger className="h-8 w-56 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {disponiveis.map((d) => (
            <SelectItem key={d} value={d} disabled={d < de}>
              {rotulo(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span
        className={cn(
          "text-xs",
          noRecorte !== undefined && noRecorte < 2
            ? "text-warning-foreground"
            : "text-muted-foreground",
        )}
      >
        {noRecorte === undefined
          ? null
          : noRecorte < 2
            ? /*
                Uma vigência só não tem par para comparar, e "nada mudou" seria
                a resposta errada para a pergunta certa. A tela diz qual dos
                dois é, porque de fora eles são idênticos.
              */
              "uma vigência só — não há par para comparar"
            : `${noRecorte} de ${disponiveis.length} vigências`}
      </span>

      {recortado && (
        <button
          onClick={() => onJanela({})}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
          série inteira
        </button>
      )}
    </div>
  );
}
