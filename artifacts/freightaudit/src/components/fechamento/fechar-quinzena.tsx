import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, LockOpen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl } from "@/lib/format";
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
  const [motivo, setMotivo] = useState("");

  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", competencia.id] });
    void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
    void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
  };

  const fechar = useMutation({ mutationFn: () => encerrar(competencia.id), onSuccess: atualizar });
  const destravar = useMutation({
    mutationFn: (razao: string) => reabrir(competencia.id, razao),
    onSuccess: () => {
      setMotivo("");
      atualizar();
    },
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
          <p className="text-sm text-muted-foreground">
            Escreva o motivo. Ele fica no registro da competência — é o que distingue
            uma correção de uma alteração silenciosa depois do fato.
          </p>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: a Ambev reenviou o 03.08.15 com a VBZ 29 corrigida."
            rows={2}
          />
          {destravar.isError && (
            <Alert variant="destructive">
              <AlertDescription>{textoDoErro(destravar.error)}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            onClick={() => destravar.mutate(motivo)}
            disabled={motivo.trim() === "" || destravar.isPending}
          >
            <LockOpen className="w-3.5 h-3.5 mr-1.5" />
            {destravar.isPending ? "Reabrindo…" : "Reabrir competência"}
          </Button>
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
