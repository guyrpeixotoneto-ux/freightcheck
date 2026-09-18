<!--
EXEMPLO DE SAÍDA — não é medição do ambiente publicado.

Este arquivo é o RELATORIO.md que `scripts/diagnostico/fase-0-publicado.sh`
produziu contra a **pilha local de produção** (bundle de produção + API em
NODE_ENV=production + Postgres local com os 124.632 fatos), em 18/09/2026.

Ele existe por uma razão só: mostrar a forma exata do que vai voltar do Replit,
para que dê para conferir o formato antes de rodar no ar. **Os números daqui não
valem como evidência do ambiente publicado** — o alvo é `localhost:3100`, o
banco está no mesmo container (daí o RTT de 0,4 ms) e a compressão é do servidor
estático local, não do host do Replit.

As três linhas que vão mudar no ar, e que são o ponto da Fase 0:
  · content-encoding do JavaScript  (aqui: gzip, porque eu o configurei assim)
  · RTT estimado até o banco        (aqui: 0,4 ms, porque o banco é local)
  · cold start                      (aqui: nunca acontece)
-->

# Fase 0 — medição do ambiente publicado

**Data:** 2026-09-18T12:36:52.783Z
**Alvo:** `http://localhost:3100`
**Sessão autenticada:** sim
**Build publicado:** revision `f7bbda5` · construído em 2026-09-18T11:06:51.135Z · pid 1637 · de pé há 5269s (desde 2026-09-18T11:07:14.919Z)
**Amostras:** 15 por endpoint na etapa 2; 3 rotas na etapa 3, espera de 75s antes da revisita

> Somente leitura: nada foi escrito no banco, na configuração ou no deployment.

---

## 1. Acesso público e entrega estática

| Recurso | content-encoding | bruto | na rede | fator | cache-control | ETag | revisita |
|---|---|--:|--:|--:|---|---|---|
| JavaScript (`/assets/index-BdnUKe7y.js`) | gzip | 3776 KB | 1008 KB | 3.7× | public, max-age=31536000, immutable | **ausente** | **sem-validador** |
| CSS (`/assets/index-CuesaPAH.css`) | gzip | 207 KB | 31 KB | 6.7× | public, max-age=31536000, immutable | **ausente** | **sem-validador** |
| index.html (`/`) | gzip | 4 KB | 2 KB | 2.5× | no-cache | **ausente** | **sem-validador** |

Negociação, como um Chrome pediria:

| accept-encoding | escolhida |
|---|---|
| `gzip, deflate, br, zstd` | gzip |
| `gzip` | gzip |
| `br` | **nenhuma** |
| `identity` | **nenhuma** |

**VEREDITO — o JavaScript chega comprimido (`gzip`, fator 3.7×).** E1 sai da fase 1.

---

## 2. Abertura autenticada, navegação interna e revisita

### 2.1 Abertura inicial e bundle

| | |
|---|---|
| arquivos `.js` | 1 |
| maior chunk | 3776 KB |
| JS na rede / bruto | 1009 KB / 3776 KB |
| FCP / DCL | 340 ms / 304 ms |
| primeira abertura utilizável | 509 ms |

**H4 — bundle único:** **CONFIRMADO**

### 2.2 Navegação interna, revisita e número de requisições

| Rota | Abertura: casca | Abertura: próprias | Abertura utilizável | Nav. interna 1ª | Req | Revisita | Req | Δ |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| /panorama | 6 | 8 | 602 ms | 482 ms | 8 | 131 ms | 8 | -73% |
| /dre | 6 | 2 | 386 ms | 390 ms | 2 | 104 ms | 2 | -73% |
| /composicao | 6 | 1 | 233 ms | 141 ms | 1 | 91 ms | 1 | -35% |

**H1 — casca de seis chamadas em toda abertura:** **CONFIRMADO**

**H3 — revisita refaz tudo:** **CONFIRMADO** — 3 de 3 rotas refizeram chamadas **75s depois** da primeira visita.

> O intervalo é parte do veredito: o maior `staleTime` do app é 60 s, e uma
> revisita medida antes disso sai falso-negativa.

### 2.3 Chamadas repetidas na mesma tela

| Rota | Chamada | Vezes |
|---|---|--:|
| /panorama | `/api/changes/range` | 2 |

---

## 3. Tempos de API e pedágio de autenticação

### 3.1 Linha de base e isolamento do pedágio

| Medição | status | p50 | p95 | p99 | min | bytes |
|---|--:|--:|--:|--:|--:|--:|
| /api/healthz (0 consultas) | 200 | 2 ms | 4 ms | 4 ms | 1 ms | 75 |
| /api/build sem cookie (0 consultas) | 200 | 2 ms | 5 ms | 5 ms | 1 ms | 130 |
| /api/build com cookie (3 consultas) | 200 | 3 ms | 3 ms | 3 ms | 3 ms | 130 |
| /api/auth/session (10 consultas) | 200 | 5 ms | 6 ms | 6 ms | 5 ms | 180 |

**Pedágio (3 consultas):** p50 **1.3 ms** · p95 0 ms

**RTT estimado até o banco:** ~**0.4 ms** por consulta

**VEREDITO — banco na mesma região.** O pedágio é barato; **D1 cai para a fase 2** e D2 (592→63 ms) vira o item de backend mais valioso.

**H2 — três consultas em toda requisição:** o isolamento só é possível porque
`/api/build` custa 0 consultas sem cookie e 3 com cookie. A diferença acima **é**
o pedágio, já incluindo o RTT até o banco.

### 3.2 Rotas de produto

| Rota | status | p50 | p95 | p99 | min | bytes | pedágio |
|---|--:|--:|--:|--:|--:|--:|--:|
| `/api/contexts` | 200 | 4 ms | 4 ms | 4 ms | 4 ms | 614 | 30% |
| `/api/change-sets` | 200 | 5 ms | 6 ms | 6 ms | 4 ms | 10697 | 26% |
| `/api/imports` | 200 | 6 ms | 6 ms | 6 ms | 5 ms | 3476 | 23% |
| `/api/curation/summary` | 200 | 4 ms | 4 ms | 4 ms | 4 ms | 568 | 32% |
| `/api/auth/session` | 200 | 5 ms | 6 ms | 6 ms | 5 ms | 180 | 24% |
| `/api/changes/families` | 200 | 79 ms | 85 ms | 85 ms | 71 ms | 124237 | 2% |
| `/api/changes/grouped` | 200 | 77 ms | 90 ms | 90 ms | 72 ms | 66452 | 2% |
| `/api/dre/fleet?escopo=CONJUNTO` | 200 | 122 ms | 194 ms | 194 ms | 112 ms | 86040 | 1% |
| `/api/curation/queue` | 200 | 227 ms | 277 ms | 277 ms | 220 ms | 58604 | 1% |
| `/api/composition/fleet` | 200 | 61 ms | 67 ms | 67 ms | 58 ms | 29121 | 2% |

---

## 4. Erros, timeouts e recursos bloqueados

Nenhuma resposta fora de 200 e nenhuma falha de transporte nas etapas de API.

### Comportamento com um endpoint em falha (503 injetado no navegador)

| esqueleto aparece em | 23 ms |
|---|---|
| a tela diz que houve erro em | 13304 ms |

**H5 — retry longo e silencioso:** **CONFIRMADO**

---

## 5. O que não é mensurável por fora — e continua pendente

| Limitação | Por que não sai daqui | Como obter |
|---|---|---|
| Aquisição de conexão do pool, execução SQL e serialização **separadas** | são etapas dentro de um processo sem instrumentação publicada; de fora só se vê a soma | `pg_stat_statements` no Neon, ou um cabeçalho `server-timing` no servidor — **as duas são mudança, não medição** |
| Consultas por requisição nas rotas de produto | exige o log do Postgres do ambiente publicado | `log_min_duration_statement` no Neon, ou `pg_stat_statements` |
| Cold start do Autoscale | uma execução só não distingue processo novo de processo antigo | rodar de novo após ~15 min de ociosidade e comparar `pid`/`startedAt` da seção de build |
| Custo com mais de uma unidade | depende do acervo real do ambiente | comparar `/api/contexts` publicado com o seed local (1 unidade) |
| Concorrência real | este diagnóstico é sequencial, de propósito: não se põe carga num ambiente de produção sem combinar | janela combinada, ou métricas do próprio deployment |
| CPU, memória, reinícios e throttling | não são observáveis por HTTP | painel do Replit |

---

## 6. Próximo passo

Envie este arquivo inteiro. Com ele eu fecho a árvore de decisão do
`docs/FASE-0.md` §3, preencho a coluna **evidência no ar** do plano, reordeno
as prioridades pelos números reais e apresento o gate de aprovação da Fase 1.

Nenhuma fase posterior foi implementada.

---

## Anexo — saída bruta

### 1. Entrega estática

```

1. index.html

2. Assets

  JavaScript
    caminho         /assets/index-BdnUKe7y.js
    content-type    text/javascript; charset=utf-8
    content-encoding gzip
    cache-control   public, max-age=31536000, immutable
    etag            <AUSENTE>
    last-modified   <AUSENTE>
    vary            <AUSENTE>
    bruto           3866331 bytes
    na rede         1032499 bytes
    fator           3.7x
  ▸ Comprimido com 'gzip'.
  ▸ Sem ETag: a revisita não tem validador para usar.

  CSS
    caminho         /assets/index-CuesaPAH.css
    content-type    text/css; charset=utf-8
    content-encoding gzip
    cache-control   public, max-age=31536000, immutable
    etag            <AUSENTE>
    last-modified   <AUSENTE>
    vary            <AUSENTE>
    bruto           211742 bytes
    na rede         31671 bytes
    fator           6.7x
  ▸ Comprimido com 'gzip'.
  ▸ Sem ETag: a revisita não tem validador para usar.

  index.html
    caminho         /
    content-type    text/html; charset=utf-8
    content-encoding gzip
    cache-control   no-cache
    etag            <AUSENTE>
    last-modified   <AUSENTE>
    vary            <AUSENTE>
    bruto           3829 bytes
    na rede         1555 bytes
    fator           2.5x
  ▸ Comprimido com 'gzip'.
  ▸ Sem ETag: a revisita não tem validador para usar.

3. Negociação, do jeito que um Chrome pede
    accept-encoding: gzip, deflate, br, zstd    → gzip
    accept-encoding: gzip                       → gzip
    accept-encoding: br                         → <nenhuma>
    accept-encoding: identity                   → <nenhuma>

Pronto.
  Cole esta saída na Fase 0. A linha que decide o plano é o content-encoding do JavaScript.
```

### 2. Pedágio e latência

```

Alvo: http://localhost:3100   ·   15 amostras por medição   ·   2026-09-18T12:34:57.640Z

1. Linha de base — rede, roteador e Node, sem uma consulta sequer

  /api/healthz (0 consultas)             200  p50     1.9  p95       4  p99       4  min     1.3       75 B
  /api/build sem cookie (0 consultas)    200  p50     1.6  p95     4.9  p99     4.9  min     1.3      130 B

2. O pedágio — as mesmas rotas, agora com sessão

  /api/build com cookie (3 consultas)    200  p50     2.9  p95     3.2  p99     3.2  min     2.7      130 B
  /api/auth/session (10 consultas)       200  p50     5.5  p95     6.4  p99     6.4  min       5      180 B

  pedágio (3 consultas)   p50 1.3 ms   p95 -1.6 ms
  RTT estimado até o banco  ~0.4 ms por consulta
    ▸ Banco na mesma região. O pedágio é barato; R4 continua alto, não crítico.

3. Rotas de produto — e quanto delas é pedágio

  /api/contexts                          200  p50     4.2  p95     4.4  p99     4.4  min     4.1      614 B   pedágio ≈ 30% do total
  /api/change-sets                       200  p50     4.9  p95     6.1  p99     6.1  min     4.2    10697 B   pedágio ≈ 26% do total
  /api/imports                           200  p50     5.6  p95     5.8  p99     5.8  min       5     3476 B   pedágio ≈ 23% do total
  /api/curation/summary                  200  p50     3.9  p95     4.4  p99     4.4  min     3.6      568 B   pedágio ≈ 32% do total
  /api/auth/session                      200  p50     5.2  p95     5.8  p99     5.8  min     4.7      180 B   pedágio ≈ 24% do total
  /api/changes/families                  200  p50    78.7  p95      85  p99      85  min    71.5   124237 B   pedágio ≈ 2% do total
  /api/changes/grouped                   200  p50    76.8  p95    90.4  p99    90.4  min    71.6    66452 B   pedágio ≈ 2% do total
  /api/dre/fleet?escopo=CONJUNTO         200  p50   121.6  p95   193.6  p99   193.6  min   112.3    86040 B   pedágio ≈ 1% do total
  /api/curation/queue                    200  p50   227.3  p95   276.6  p99   276.6  min   219.6    58604 B   pedágio ≈ 1% do total
  /api/composition/fleet                 200  p50    61.5  p95    66.5  p99    66.5  min    57.8    29121 B   pedágio ≈ 2% do total

4. Partida a frio — este processo é o mesmo de antes?

  pid 1637  ·  de pé há 5269s  ·  startedAt 2026-09-18T11:07:14.919Z  ·  revision f7bbda5
  Rode de novo depois de 15 min de ociosidade: pid diferente com a mesma revision = o Autoscale recolheu e subiu de novo.

```

### 3. Navegador

```

Alvo: http://localhost:3100   ·   2026-09-18T12:35:04.093Z

H4 — o bundle inicial

  arquivos .js            1
  na rede / bruto         1009 KB / 3776 KB   (fator 3.7x)
  maior chunk             3776 KB
  FCP / DCL               340 ms / 304 ms
  primeira abertura útil  509 ms
    ▸ CONFIRMADO: chunk único. R2 vale no ar.
    ▸ O JavaScript chegou comprimido.

H1 e H3 — a casca de toda rota, e o custo da revisita


  esperando 75s para a revisita (o maior staleTime declarado é 60 s)… pronto

  | Rota | Casca | 1ª visita | Req | Revisita | Req | Δ |
  |---|--:|--:|--:|--:|--:|--:|
  | /panorama | 66 | 482 | 8 | 131 | 8 | -73% |
  | /dre | 28 | 390 | 2 | 104 | 2 | -73% |
  | /composicao | 23 | 141 | 1 | 91 | 1 | -35% |

    ▸ H3 CONFIRMADO: 3 de 3 rotas refazem chamadas na revisita, 75s depois.
     (a casca declara staleTime de 30–60 s; com espera menor que isso o veredito sai falso-negativo)

H1 — a casca em cada abertura direta (F5)

  | Rota | Chamadas da casca | Próprias | Utilizável |
  |---|--:|--:|--:|
  | /panorama | 6 | 8 | 602 ms |
  | /dre | 6 | 2 | 386 ms |
  | /composicao | 6 | 1 | 233 ms |

    ▸ H1 CONFIRMADO: toda abertura paga a casca inteira.

Chamadas repetidas na mesma tela

  /panorama              /api/changes/range ×2

H5 — quanto tempo a tela fica calada quando uma chamada não volta

  (a resposta é trocada por 503 dentro do navegador; o deployment não é tocado)
  esqueleto aparece em          23 ms
  a tela diz que houve erro em  13304 ms
    ▸ H5 CONFIRMADO: a tela fica calada por mais de 5 s.

```
