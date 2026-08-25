/**
 * Uma linha de tendência em miniatura — sem eixo, sem rótulo, sem tooltip.
 *
 * Existe só para o cartão de KPI dizer "e para que lado isso vem andando" ao
 * lado do número grande, sem competir com ele. Não é um gráfico de verdade —
 * não tem `recharts` por trás porque não precisa: é uma polilinha normalizada
 * ao intervalo dos próprios valores, e nada além disso.
 */
export function Sparkline({
  valores,
  cor,
  largura = 72,
  altura = 28,
}: {
  valores: number[];
  cor: string;
  largura?: number;
  altura?: number;
}) {
  if (valores.length < 2) return null;

  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const amplitude = maximo - minimo || 1;
  const margem = altura * 0.12;

  const pontos = valores
    .map((valor, indice) => {
      const x = (indice / (valores.length - 1)) * largura;
      const y = altura - margem - ((valor - minimo) / amplitude) * (altura - margem * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <polyline
        points={pontos}
        fill="none"
        stroke={cor}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
