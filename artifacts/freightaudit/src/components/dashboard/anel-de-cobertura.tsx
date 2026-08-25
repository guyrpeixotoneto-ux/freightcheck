/**
 * O anel de cobertura — a mesma fração de `coberturaDePreco` (Dashboard),
 * desenhada como progresso circular em vez de fração escrita.
 *
 * Não recalcula nada: recebe o percentual já pronto e só decide quantos graus
 * do círculo pintar. `--brand` é o mesmo token do resto da tela — nenhuma cor
 * nova nasce aqui.
 */
export function AnelDeCobertura({
  percentual,
  tamanho = 56,
  espessura = 6,
}: {
  percentual: number;
  tamanho?: number;
  espessura?: number;
}) {
  const raio = (tamanho - espessura) / 2;
  const circunferencia = 2 * Math.PI * raio;
  const fracao = Math.max(0, Math.min(100, percentual)) / 100;
  const preenchido = fracao * circunferencia;

  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="shrink-0">
      <circle
        cx={tamanho / 2}
        cy={tamanho / 2}
        r={raio}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={espessura}
      />
      <circle
        cx={tamanho / 2}
        cy={tamanho / 2}
        r={raio}
        fill="none"
        stroke="hsl(var(--brand))"
        strokeWidth={espessura}
        strokeDasharray={`${circunferencia} ${circunferencia}`}
        strokeDashoffset={circunferencia - preenchido}
        strokeLinecap="round"
        transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground font-bold"
        style={{ fontSize: tamanho * 0.24 }}
      >
        {Math.round(percentual)}%
      </text>
    </svg>
  );
}
