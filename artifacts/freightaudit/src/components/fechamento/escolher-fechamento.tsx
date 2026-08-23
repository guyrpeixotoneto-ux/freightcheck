import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MES_LONGO } from "@/lib/fechamento-gerencial";
import { listarPartes, tiposParaLerNoAmbiente } from "@/lib/fechamento";
import { useOperacaoDoFechamento } from "@/lib/base-do-fechamento";

/**
 * QUAL FECHAMENTO — a mesma pergunta em toda tela que responde sobre um mês.
 *
 * Cinco campos, e nenhum deles é decorativo: um fechamento é a trinca (unidade,
 * transportadora, tipo de operação) num período, e faltando qualquer um deles
 * não há o que ler. Duas telas fazem a pergunta hoje — Resumo geral e
 * Conciliação —, e ela é um componente só porque uma segunda cópia divergiria
 * no primeiro campo novo: quem lesse o Resumo escolheria a operação por um
 * caminho e a Conciliação por outro, sobre o mesmo mês.
 *
 * **Nada é escolhido em silêncio.** Não há valor padrão para unidade,
 * transportadora nem tipo: a tela que os recebe vazios diz que estão vazios, e
 * não adivinha o primeiro da lista. Mês e ano têm padrão porque o calendário
 * responde por eles.
 */
export interface FechamentoEscolhido {
  unidade: string;
  transportadora: string;
  tipoDeOperacao: string;
  ano: number;
  mes: number;
}

export const ANOS_DO_FECHAMENTO = [0, 1, 2].map((n) => new Date().getFullYear() - n);

export function EscolherFechamento({
  valores,
  onTrocar,
}: {
  valores: FechamentoEscolhido;
  /** Troca um campo — quem chama decide se isso vira URL, estado ou consulta. */
  onTrocar: (campo: keyof FechamentoEscolhido, valor: string) => void;
}) {
  const partes = useQuery({ queryKey: ["fechamento", "partes"], queryFn: listarPartes });
  /*
    O que este seletor pode oferecer no campo Tipo é o que o **ambiente**
    alcança: a operação do fechamento aberto, e o `NAO_INFORMADO` de quem ainda
    não disse qual é. A lista inteira estava aqui desde antes de os dois
    fechamentos existirem, e com eles ela virou um dropdown capaz de desmentir a
    porta pela qual a pessoa entrou — o Rota mostrando a conta da empurrada, com
    "Fechamento Rota" escrito no topo.
  */
  const operacao = useOperacaoDoFechamento();
  const tipos = tiposParaLerNoAmbiente(operacao);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Qual fechamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="unidade">Unidade (CDD)</Label>
            <Select value={valores.unidade} onValueChange={(v) => onTrocar("unidade", v)}>
              <SelectTrigger id="unidade">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {(partes.data?.unidades ?? []).map((p) => (
                  <SelectItem key={p.codigo} value={p.codigo}>
                    {p.nome ? `${p.codigo} — ${p.nome}` : p.codigo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/*
            O tipo vem logo depois da unidade porque é com ela que ele forma a
            operação: "CAMAÇARI · EMPURRADA" é uma coisa e "CAMAÇARI · ROTA" é
            outra, com contas separadas desde a `0046`.

            A lista é a de **ler dentro deste ambiente**
            (`tiposParaLerNoAmbiente`): a operação do fechamento aberto e o
            `NAO_INFORMADO` do backfill. Quem abre não pode escolher o segundo —
            seria dizer "não sei" num campo obrigatório —, mas todo fechamento
            anterior à `0046` o carrega, e um seletor sem ele deixa esse acervo
            sem endereço nestas telas: a unidade certa, a transportadora certa, o
            mês certo, e mesmo assim nada. A operação do **outro** fechamento
            também não está aqui, e por outro motivo: ela não é escolha desta
            tela, é o ambiente — e o ambiente se troca no topo.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="tipo-de-operacao">Tipo</Label>
            <Select
              value={valores.tipoDeOperacao}
              onValueChange={(v) => onTrocar("tipoDeOperacao", v)}
            >
              <SelectTrigger id="tipo-de-operacao">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {tipos.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transportadora">Transportadora</Label>
            <Select
              value={valores.transportadora}
              onValueChange={(v) => onTrocar("transportadora", v)}
            >
              <SelectTrigger id="transportadora">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {(partes.data?.transportadoras ?? []).map((p) => (
                  <SelectItem key={p.codigo} value={p.codigo}>
                    {p.nome ? `${p.codigo} — ${p.nome}` : p.codigo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mes">Mês</Label>
            <Select value={String(valores.mes)} onValueChange={(v) => onTrocar("mes", v)}>
              <SelectTrigger id="mes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MES_LONGO.map((nome, i) => (
                  <SelectItem key={nome} value={String(i + 1)}>
                    {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ano">Ano</Label>
            <Select value={String(valores.ano)} onValueChange={(v) => onTrocar("ano", v)}>
              <SelectTrigger id="ano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANOS_DO_FECHAMENTO.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * O fechamento está escolhido? — as três partes da chave, e não o mês.
 *
 * Exportada para que as telas façam a mesma pergunta com a mesma resposta: mês
 * e ano sempre têm valor, e checá-los junto faria a tela achar que há escolha
 * onde não há.
 */
export function fechamentoEscolhido(valores: FechamentoEscolhido): boolean {
  return (
    valores.unidade !== "" &&
    valores.transportadora !== "" &&
    valores.tipoDeOperacao !== ""
  );
}
