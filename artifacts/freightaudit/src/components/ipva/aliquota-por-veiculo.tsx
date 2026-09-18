import { formatBrl } from "@/lib/format";
import {
  corDaDiferencaDeAliquota,
  escreverAliquota,
  escreverDiferencaDeAliquota,
  type AliquotaDoAtivo,
} from "@/lib/ipva";
import { cn } from "@/lib/utils";

/**
 * A COMPARAÇÃO DE ALÍQUOTAS — o IPVA de cada placa lido em percentual da nota.
 *
 * ---------------------------------------------------------------------------
 * Por que esta tabela existe ao lado da outra
 * ---------------------------------------------------------------------------
 * A tabela de alterações responde **quanto** mudou, em reais. Esta responde
 * **sob que régua** cada ponta cobrou — e as duas perguntas não se substituem:
 * uma queda de R$ 3.064,74 numa placa pode ser a mesma alíquota sobre uma nota
 * menor (o ativo depreciou, e a conta está certa) ou a mesma nota sob outra
 * alíquota (alguém trocou a fórmula, e aí não houve economia nenhuma). Os dois
 * casos são idênticos na coluna de reais e opostos aqui.
 *
 * O painel de cima (`AliquotaImplicita`) já dizia isso da frota inteira, em
 * média e desvio. O que faltava era o nível da placa, que é onde a conferência
 * de fato acontece: quem vai cobrar a Ambev precisa apontar **qual** veículo
 * saiu de 1,000% para 0,651%, não a média de 62 deles.
 *
 * ---------------------------------------------------------------------------
 * Todas as placas, e não só as que mudaram
 * ---------------------------------------------------------------------------
 * A lista vem de `/ipva/totais`, que lê o acervo das duas vigências — não do
 * `change_set`. Uma placa cuja alíquota ficou idêntica é resposta, e das boas: é
 * ela que mostra que a régua não se moveu ali. Por isso este modo entrou no
 * lugar do alternador "Mostrar veículos sem alteração": ele mostra a frota
 * inteira, e mostra com o número que explica o resto da tela.
 *
 * ---------------------------------------------------------------------------
 * O que a tabela se recusa a escrever
 * ---------------------------------------------------------------------------
 * **Não inventa denominador.** Ativo sem valor de nota, ou com nota zero, sai
 * com o percentual em travessão — e o IPVA em reais continua visível ao lado,
 * para que a linha diga "falta o cadastro da nota" em vez de sumir. Escrever 0%
 * ali seria anunciar isenção onde há campo em branco.
 *
 * **Não esconde o estorno.** Um IPVA negativo produz percentual negativo, e ele
 * aparece marcado. É o inverso da régua agregada, que o exclui de propósito — lá
 * ele contaminaria a dispersão de uma frota inteira; aqui ele é a única linha
 * que alguém quer abrir na planilha.
 */

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/** O IPVA em reais com o valor de nota logo abaixo — numerador e denominador juntos. */
function CelulaDeValor({ ipva, nf }: { ipva: number | null; nf: number | null }) {
  return (
    <td className="px-3 py-1.5 text-right">
      <span
        className={cn(
          "block font-mono tabular-nums",
          ipva !== null && ipva < 0 && "text-destructive",
        )}
      >
        {ipva === null ? "—" : formatBrl(ipva)}
      </span>
      {/*
        A nota vem em tinta menor, e não numa coluna própria: ela não é o
        assunto da tela — é o que torna o percentual ao lado conferível sem
        abrir outra aba. Uma coluna inteira para ela empurraria as duas
        alíquotas, que são o assunto, para fora da largura visível.
      */}
      <span className="block text-[0.7rem] text-muted-foreground">
        {nf === null ? "sem nota" : `NF ${formatBrl(nf)}`}
      </span>
    </td>
  );
}

export function TabelaDeAliquotas({
  ativos,
  rotuloBase,
  rotuloComparada,
}: {
  ativos: AliquotaDoAtivo[];
  rotuloBase: string;
  rotuloComparada: string;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Alíquota implícita de IPVA por veículo — o tributo como percentual do valor de
          nota em {rotuloBase} e em {rotuloComparada}.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60 text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-bold">
              Veículo
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-left font-bold">
              Tipo
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-bold">
              IPVA de ({rotuloBase})
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-bold">
              Alíquota de
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-bold">
              IPVA para ({rotuloComparada})
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-bold">
              Alíquota para
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-bold">
              Diferença
            </th>
          </tr>
        </thead>
        <tbody>
          {ativos.map((a) => (
            <tr
              key={`${a.entityType}-${a.entityLabel}`}
              className="border-b last:border-0 hover:bg-muted/40"
            >
              <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold">
                {a.entityLabel ?? "—"}
                {a.estorno && (
                  <span
                    className="ml-2 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 font-sans text-[0.65rem] font-semibold text-warning-foreground"
                    title="Uma das pontas é negativa: estorno ou erro de cadastro."
                  >
                    estorno
                  </span>
                )}
              </td>
              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                {ROTULO_DO_TIPO[a.entityType] ?? a.entityType}
              </td>
              <CelulaDeValor ipva={a.ipvaBase} nf={a.nfBase} />
              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                {escreverAliquota(a.aliquotaBase)}
              </td>
              <CelulaDeValor ipva={a.ipvaComparada} nf={a.nfComparada} />
              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                {escreverAliquota(a.aliquotaComparada)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums",
                  corDaDiferencaDeAliquota(a.diferenca),
                )}
              >
                {escreverDiferencaDeAliquota(a.diferenca)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
