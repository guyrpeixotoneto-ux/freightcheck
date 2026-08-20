import { useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, LockOpen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl } from "@/lib/format";
import { chaveDaCompetencia } from "@/lib/fechamento-tela";
import {
  encerrar,
  reabrir,
  type Apuracao,
  type Competencia,
  type Divergencia,
  type Documento,
  type Fonte,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

/**
 * O que a competência tem a questionar — a fila acionável e quanto ela pesa.
 *
 * Mora junto do painel que fecha a quinzena porque é o número que o resumo do
 * fechamento mostra antes do botão, e é o mesmo que a tela da competência lista
 * logo acima, em "O que perguntar à Ambev". Duas contas iguais em dois arquivos
 * divergiriam um dia por uma vírgula de filtro — e a que aparece ao lado do
 * botão de congelar é a pior das duas para estar errada.
 *
 * Informativa não entra: a fila é do que alguém tem de resolver, e um aviso da
 * conciliação não é trabalho de ninguém.
 */
export function oQueQuestionar(apuracao: Apuracao): {
  acionaveis: Divergencia[];
  aReceber: number;
} {
  const acionaveis = apuracao.divergencias.filter((d) => d.sentido !== "INFORMATIVO");
  const aReceber = acionaveis
    .filter((d) => d.sentido === "A_RECEBER")
    .reduce((soma, d) => soma + d.valor, 0);
  return { acionaveis, aReceber };
}

/**
 * O motivo da reabertura serve? A mesma régua do servidor, deste lado.
 *
 * A regra é do servidor — a rota recusa o motivo vazio e `reabrirCompetencia`
 * recusa de novo, de propósito (ver `routes/fechamento.ts`). A cópia aqui não
 * afrouxa nada: existe para que o botão não gaste uma ida e volta para dizer o
 * que já se sabia, e para que um campo em branco pareça um campo em branco em
 * vez de uma falha do sistema.
 */
export function motivoAceito(texto: string): boolean {
  return texto.trim() !== "";
}

/**
 * O que uma mudança de estado da competência invalida — sempre as três chaves.
 *
 * O estado aparece na tela da competência, em Importações, em Apurações e nas
 * duas da Visão Gerencial, e todas as outras leem
 * `["fechamento", "competencias"]` ou `["fechamento", "apuracoes"]`. Fechar ou
 * reabrir sem invalidá-las deixaria a mesma quinzena "Apurada" numa aba e
 * "Encerrada" na outra, que é a forma mais barata de fazer alguém desconfiar do
 * número certo.
 */
function atualizarFechamento(cliente: QueryClient, competenciaId: string): void {
  void cliente.invalidateQueries({ queryKey: chaveDaCompetencia(competenciaId) });
  void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
  void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
}

/**
 * Reabrir a quinzena — o caminho de volta, e ele pede motivo.
 *
 * Vive separado de `FecharQuinzena` porque o ato é procurado em lugares
 * diferentes e por razões diferentes. No fim da tela da competência e na linha
 * de Importações, é a outra metade do painel que congelou o período. Mas o
 * caso mais comum não é nenhum dos dois: é a Ambev mandar o relatório que
 * faltava *depois* de a quinzena estar fechada, e quem recebeu estar olhando
 * exatamente para o botão de enviar que não clica — por isso a lista de
 * relatórios da competência também oferece este bloco, ao lado do envio
 * travado. Três cópias do formulário seriam três opiniões sobre o que
 * descongela um período fechado, e a terceira envelheceria calada.
 *
 * **Por que começa recolhido fora do painel de fechamento.** Reabrir descongela
 * a prova de uma cobrança; um campo de texto sempre aberto no meio da lista de
 * relatórios convidaria a isso como se fosse rotina. O botão que revela o campo
 * é a mesma regra da linha de Importações: o clique abre o que se vai fazer, e
 * não o faz.
 *
 * **A competência volta para APURADA, não para ABERTA** (ver
 * `reabrirCompetencia`): a apuração que estava lá continua valendo, e é contra
 * ela que se compara o que mudar depois do arquivo novo entrar.
 */
export function ReabrirQuinzena({
  competencia,
  iniciaAberto = false,
  rotulo = "Reabrir a quinzena",
}: {
  competencia: Competencia;
  /** No painel de fechamento o formulário já vem aberto: reabrir é o assunto dele. */
  iniciaAberto?: boolean;
  /** O que o botão promete, quando o bloco começa recolhido. */
  rotulo?: string;
}) {
  const cliente = useQueryClient();
  const [aberto, setAberto] = useState(iniciaAberto);
  const [motivo, setMotivo] = useState("");

  const destravar = useMutation({
    mutationFn: (razao: string) => reabrir(competencia.id, razao),
    onSuccess: () => {
      setMotivo("");
      setAberto(iniciaAberto);
      atualizarFechamento(cliente, competencia.id);
    },
  });

  if (!aberto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <LockOpen className="w-3.5 h-3.5 mr-1.5" />
        {rotulo}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Escreva o motivo. Ele fica no registro da competência — é o que distingue
        uma correção de uma alteração silenciosa depois do fato.
      </p>
      <Textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: a Ambev mandou o 03.08.20 depois de a quinzena ter fechado."
        rows={2}
      />
      {destravar.isError && (
        <Alert variant="destructive">
          <AlertDescription>{textoDoErro(destravar.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => destravar.mutate(motivo)}
          disabled={!motivoAceito(motivo) || destravar.isPending}
        >
          <LockOpen className="w-3.5 h-3.5 mr-1.5" />
          {destravar.isPending ? "Reabrindo…" : "Reabrir competência"}
        </Button>
        {!iniciaAberto && (
          <Button
            variant="ghost"
            onClick={() => {
              setAberto(false);
              setMotivo("");
            }}
            disabled={destravar.isPending}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Fechar a quinzena — e reabri-la, com motivo.
 *
 * Vive aqui, e não dentro da competência aberta, pela mesma razão de
 * `conta-apurada`: duas telas fazem o mesmo ato. A competência aberta
 * (`pages/fechamento/competencia.tsx`), no fim do trabalho de quem enviou os
 * relatórios e apurou; e a lista de Importações
 * (`pages/fechamento/competencias.tsx`), onde quem já apurou várias fecha uma
 * quinzena atrás da outra sem entrar em cada uma. Duas cópias do mesmo bloco
 * seriam duas opiniões sobre o que congela um período — e a segunda
 * envelheceria calada.
 *
 * **O resumo aparece antes do botão, nas duas telas.** Fechar é o ato a partir
 * do qual o banco recusa escrita na competência; quem clica precisa ver o que
 * está congelando — quantos relatórios entraram, quanto foi emitido,
 * quanto continua a questionar. Um botão de fechar sem esse resumo seria mais
 * rápido e diria menos, e é justamente o que a lista não deve ganhar por estar
 * com pressa.
 *
 * **O que ele invalida.** O estado da competência aparece na tela dela, em
 * Importações, em Apurações e nas duas da Visão Gerencial — e todas as outras
 * leem `["fechamento", "competencias"]` ou `["fechamento", "apuracoes"]`.
 * Fechar sem invalidá-las deixaria a mesma quinzena "Apurada" numa aba e
 * "Encerrada" na outra, que é a forma mais barata de fazer alguém desconfiar do
 * número certo.
 */
export function FecharQuinzena({
  competencia,
  documentos,
  apuracao,
  fontes,
}: {
  competencia: Competencia;
  documentos: Documento[];
  /** A apuração vigente: sem ela não há o que fechar, e o servidor recusa. */
  apuracao: Apuracao;
  /**
   * Os relatórios que **esta** quinzena pede — o denominador de "3 de 4
   * relatórios". A primeira quinzena tem quatro e a segunda tem seis, então o
   * denominador vem recortado de fora (ver `fontesDaCompetencia`) em vez de ser
   * o catálogo inteiro.
   */
  fontes: Fonte[];
}) {
  const cliente = useQueryClient();

  const fechar = useMutation({
    mutationFn: () => encerrar(competencia.id),
    onSuccess: () => atualizarFechamento(cliente, competencia.id),
  });

  const encerrada = competencia.estado === "ENCERRADA";
  const enviados = documentos.filter((d) => d.vigente).length;
  const { acionaveis, aReceber } = oQueQuestionar(apuracao);

  if (encerrada) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Esta competência está fechada: os relatórios, a conta apurada e as
          divergências ficam como estão, e o banco recusa qualquer escrita nela. É o
          que faz o número que você cobrou continuar sendo o número que se lê daqui
          a um ano.
        </p>
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Precisa reabrir?</p>
          <ReabrirQuinzena competencia={competencia} iniciaAberto />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Tudo o que você enviou e apurou já está gravado — salvar não é o que guarda
        os dados. O que este botão faz é <strong>fechar a quinzena</strong>: a partir
        dele nada mais entra nela, e a conta apurada passa a ser o registro do que
        foi cobrado. Reabrir depois é possível, com motivo.
      </p>
      <ul className="text-sm text-muted-foreground space-y-1">
        <li>
          {/* Sem catálogo não há denominador: a frase perde o "de N" em vez de
              dizer "de 0" enquanto a consulta viaja — ou de chutar seis numa
              primeira quinzena, que tem quatro. */}
          {fontes.length > 0
            ? `• ${enviados} de ${fontes.length} relatórios enviados`
            : `• ${enviados} relatório(s) enviados`}
        </li>
        <li>• {formatBrl(apuracao.totais.emitido)} emitidos em CT-e</li>
        <li>
          • {acionaveis.length} ponto(s) a questionar, somando {formatBrl(aReceber)}
        </li>
      </ul>
      {apuracao.fontesAusentes.length > 0 && (
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            Faltam {apuracao.fontesAusentes.length} relatório(s). Dá para fechar
            assim, e o que eles sustentariam vai ficar registrado como não conferido.
          </AlertDescription>
        </Alert>
      )}
      {fechar.isError && (
        <Alert variant="destructive">
          <AlertDescription>{textoDoErro(fechar.error)}</AlertDescription>
        </Alert>
      )}
      <Button onClick={() => fechar.mutate()} disabled={fechar.isPending}>
        <Lock className="w-3.5 h-3.5 mr-1.5" />
        {fechar.isPending ? "Salvando…" : "Salvar e fechar a quinzena"}
      </Button>
    </div>
  );
}
