import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";
import type { ProdutoDeCompra } from "@/components/compras/tipos";
import type { Cotacao } from "./tipos";

/**
 * Registrar uma proposta — o único dado que este produto não importa.
 *
 * O FreightCheck importa o modelo de remuneração da Ambev. Nota de compra,
 * fornecedor e proposta comercial nunca entraram por planilha nenhuma, e é por
 * isso que a tela Remunerado se recusava a dizer "pode comprar": faltava metade
 * da conta. Este formulário é a metade que faltava, e ele é curto de propósito
 * — item, fornecedor, preço e quantidade bastam para o motor responder; o resto
 * é opcional.
 *
 * **O que se registra aqui não vira fato canônico.** A cotação não entra em
 * vigência, não participa de comparação e não altera impacto apurado: ela é
 * declaração de quem compra, guardada ao lado do acervo. Ver a migration
 * `0101` e o cabeçalho de `lib/db/src/schema/compras.ts`.
 */
export function NovaCotacao({
  produtos,
  itemInicial,
  contexto,
  aoRegistrar,
}: {
  produtos: ProdutoDeCompra[];
  itemInicial?: string | null;
  /** A query de recorte que o resto da tela já carrega. */
  contexto: string;
  aoRegistrar: (cotacao: Cotacao) => void;
}) {
  const [item, setItem] = useState(itemInicial ?? produtos[0]?.chave ?? "");
  const [fornecedor, setFornecedor] = useState("");
  const [preco, setPreco] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * Da grafia brasileira para número.
   *
   * O campo é preenchido com um fornecedor no telefone, e ninguém digita
   * `3080.00` nessa hora: digita `3.080,00`. Mandar a string crua ao servidor
   * faria `Number("3.080,00")` virar `NaN` e a proposta ser recusada com um
   * "informe o preço" para quem acabou de informá-lo.
   */
  const numero = (bruto: string): number | null => {
    const limpo = bruto.trim().replace(/[^\d.,-]/g, "");
    if (limpo === "") return null;
    const normalizado = limpo.includes(",")
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo;
    const n = Number(normalizado);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  async function registrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    const precoNumero = numero(preco);
    if (item === "") return setErro("Escolha o item.");
    if (fornecedor.trim() === "") return setErro("Informe o fornecedor.");
    if (precoNumero === null) return setErro("Informe o preço por unidade.");

    setEnviando(true);
    try {
      const cotacao = await fetchJson<Cotacao>(
        `/agente-compras/cotacoes${contexto}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            item,
            fornecedor: fornecedor.trim(),
            precoUnitario: precoNumero,
            quantidade: numero(quantidade),
            evidencia: evidencia.trim() || null,
          }),
        },
      );
      setFornecedor("");
      setPreco("");
      setQuantidade("");
      setEvidencia("");
      aoRegistrar(cotacao);
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "Não foi possível registrar a proposta.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={registrar} className="superficie p-4 space-y-3">
      <h3 className="font-bold text-sm">Registrar uma proposta</h3>
      <p className="text-xs text-muted-foreground">
        O acervo traz a remuneração; a proposta vem de você. Com as duas na
        mesa, o preço-alvo e o teto passam a ter contra o que ser comparados.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold space-y-1">
          <span>Item</span>
          <select
            value={item}
            onChange={(e) => setItem(e.target.value)}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm font-normal"
          >
            {produtos.map((p) => (
              <option key={p.chave} value={p.chave}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold space-y-1">
          <span>Fornecedor</span>
          <Input
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
            placeholder="Quem enviou a proposta"
          />
        </label>

        <label className="text-xs font-semibold space-y-1">
          <span>Preço por unidade</span>
          <Input
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            placeholder="3.080,00"
            inputMode="decimal"
          />
        </label>

        <label className="text-xs font-semibold space-y-1">
          <span>Quantidade</span>
          <Input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            placeholder="80"
            inputMode="numeric"
          />
        </label>
      </div>

      <label className="text-xs font-semibold space-y-1 block">
        <span>Evidência</span>
        <Input
          value={evidencia}
          onChange={(e) => setEvidencia(e.target.value)}
          placeholder="Número da proposta, link do portal, caminho do arquivo"
        />
      </label>

      {erro && <p className="text-xs text-rose-600">{erro}</p>}

      <Button type="submit" size="sm" disabled={enviando}>
        {enviando ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Plus className="w-4 h-4" />
        )}
        Registrar proposta
      </Button>
    </form>
  );
}
