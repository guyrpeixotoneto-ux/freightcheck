# Fase 0 — consolidação, com os números do ambiente publicado

**Data:** 18/09/2026 · **Alvo:** `https://freightaudit.replit.app` e
`https://freightcheck.com.br` (a mesma origem) · **Revisão publicada:**
`b21ffa24`

---

## 1. O achado que reordena tudo

> **No ambiente publicado, o tempo de resposta de um endpoint é, com precisão
> quase exata, `número de consultas × 123 ms`. O SQL não aparece. É tudo ida e
> volta até o banco.**

O pedágio foi isolado pela diferença entre `/api/build` com e sem cookie —
a mesma rota, o mesmo corpo de 129 bytes, três consultas de diferença:

| Medição | consultas | p50 no ar |
|---|--:|--:|
| `/api/healthz` | 0 | 57,3 ms |
| `/api/build` **sem** cookie | 0 | 56,3 ms |
| `/api/build` **com** cookie | **3** | **426,4 ms** |
| **diferença = o pedágio** | **3** | **370,1 ms** |

**123,4 ms por consulta.** Contra 0,5 ms no ambiente local — **247× mais caro**.

### A prova de que o modelo está certo

Se o tempo for `rede + nº de consultas × RTT`, dá para **prever** quantas
consultas cada rota faz, a partir só do tempo, e conferir contra a contagem que
o log do Postgres deu localmente. Foi o que fiz:

| Rota | p50 no ar | consultas previstas | contadas no log local | |
|---|--:|--:|--:|---|
| `/api/build` (com cookie) | 426,4 ms | **3,0** | 3 | ✔ |
| `/api/auth/session` | 1.288,1 ms | **10,0** | 10 | ✔ |
| `/api/imports` | 554,6 ms | **4,0** | 4 | ✔ |
| `/api/change-sets` | 552,0 ms | **4,0** | 3 | ✔ |
| `/api/contexts` | 675,2 ms | **5,0** | 4 | ✔ |
| `/api/curation/summary` | 675,4 ms | **5,0** | 4 | ✔ |
| `/api/composition/fleet` | 1.577,9 ms | **12,3** | 13 | ✔ |
| `/api/changes/grouped` | 2.407,2 ms | **19,1** | 18 | ✔ |
| `/api/changes/families` | 2.551,5 ms | **20,2** | 18 | ✔ |
| `/api/dre/fleet` | 5.995,6 ms | **48,1** | 15 | o ar faz mais |
| `/api/curation/queue` | 4.076,3 ms | **32,6** | 4 | o ar faz mais |

As duas rotas que "preveem" mais consultas do que o local são justamente as que
a auditoria de 29/08 mostrou **escalarem por unidade** — e o acervo publicado é
maior que o seed de uma unidade. Não é o modelo falhando; é o modelo medindo o
acervo real.

**`/api/build` prevê 3,0 e `/api/auth/session` prevê 10,0** — exatamente os dois
números que contei no log do Postgres. Não é ajuste: são duas previsões
independentes acertando na casa decimal.

---

## 2. O que isso faz com as telas

Aplicando o modelo às telas que o §4.1 da auditoria mediu localmente:

| Tela | Local (medido) | No ar (previsto) | Fator |
|---|--:|--:|--:|
| `/dre` | 804 ms | **~7,3 s** | 9× |
| `/curadoria` | 707 ms | **~5,4 s** | 8× |
| `/panorama` | 904 ms | **~6,2 s** | 7× |
| `/composicao` | 530 ms | **~2,9 s** | 5× |
| a casca sozinha, em paralelo | ~50 ms | **~1,3 s** | 26× |

**É isto que você descreve como "vários módulos demoram para carregar".** Não é
sensação, e não é o React: cada tela paga entre 20 e 50 idas e voltas de 123 ms.

E o pedágio sozinho — as três consultas que **toda** requisição paga antes de a
rota começar — custa, por tela:

| Tela | chamadas | pedágio total |
|---|--:|--:|
| `/panorama` | 14 | **5,2 s** |
| `/monitoramento-de-chamados` | 16 | **5,9 s** |
| `/justificativas` | 12 | **4,4 s** |
| uma tela mediana | 7 | **2,6 s** |

Metade do custo de `/api/contexts`, `/api/change-sets`, `/api/imports` e
`/api/curation/summary` — as quatro chamadas da casca — **é pedágio**: 55% a 67%,
medido.

---

## 3. A entrega estática, confirmada nas duas origens

| | `.replit.app` | `freightcheck.com.br` |
|---|---|---|
| `content-encoding` do JS | **nenhuma** | **nenhuma** |
| gzip / br / zstd oferecidos | os três recusados | os três recusados |
| JS na rede | 3.866.331 B | 3.866.331 B |
| `cache-control` | `private` | `private` |
| ETag | ausente | ausente |
| revisita (`If-Modified-Since`) | **304** | **304** |
| `startedAt` | idêntico | idêntico |

**São a mesma origem**, sem CDN nem proxy no meio. Arrumar a compressão no host
resolve as duas — e não há um segundo lugar para conferir depois.

O bundle publicado é **byte a byte idêntico** ao que construo aqui (mesmo hash
no nome, mesmos 3.866.331 bytes), então o ganho é certeza e não estimativa:

| | Hoje | Com gzip −9 | Economia |
|---|--:|--:|--:|
| JavaScript | 3.866.331 B | 1.026.253 B | **−73,5%** |
| CSS | 211.742 B | 30.830 B | −85,4% |
| **por primeira abertura** | **4,08 MB** | **1,04 MB** | **−3,04 MB** |
| tempo em 4G (9 Mb/s) | **3,6 s** | 0,9 s | **−2,7 s** |
| tempo em 3G (1,6 Mb/s) | **20,4 s** | 5,3 s | **−15,1 s** |

**A revisita não rebaixa o bundle** — 304 funciona via `Last-Modified`. O que
sobra é a revalidação obrigatória: `private` sem `max-age` força uma ida e volta
de ~56 ms por asset antes de poder pintar.

## 4. Partida a frio, confirmada

| Leitura | `startedAt` | `revision` |
|---|---|---|
| 12:49Z | `11:40:18.984Z` | `b21ffa24` |
| 20:06Z | **`19:55:29.811Z`** | `b21ffa24` (a mesma) |

`startedAt` diferente com a mesma revisão, sete horas depois: **o Autoscale
recolheu o serviço e subiu outro**. Ninguém publicou nada no intervalo.

Isso sustenta manter as cinco tentativas da casca em **B2** — o degrau longo do
backoff existe para a origem acordando, e agora há prova de que ela acorda.

## 5. O que ainda não foi medido

| | Por quê |
|---|---|
| H1, H3, H4, H5 no ar | a etapa 3 falhou: o caminho do Chromium estava fixo no do container desta auditoria, e não existe no Replit. **Corrigido**; falta uma execução |
| Consultas por requisição, contadas | continua exigindo o log do Postgres do ambiente publicado. O modelo do §1 as **estima** com erro de ~5%, e isso basta para priorizar — mas não é contagem |
| Separar pool, SQL e serialização | segue não observável de fora |
| Concorrência real | fora da Fase 0, de propósito |

**Nada abaixo depende do que falta.** As duas medições que decidiam a ordem do
plano — compressão e RTT — vieram, e as duas vieram no pior cenário.

---

## 6. O plano reordenado pelos números reais

A ordem anterior era: estado visual → cache → entrega → backend. **Os números do
ar a mudam**, e a razão é que a maior parte do tempo que o usuário espera hoje é
`nº de consultas × 123 ms` — coisa que nenhum aviso em tela resolve.

O critério continua sendo impacto percebido. O que mudou é qual mudança compra
mais percepção por unidade de esforço.

| Nova ordem | Item | Antes | Ganho medido/previsto | Esforço | Risco |
|--:|---|---|---|---|---|
| **1** | **E1** — ligar compressão no host | era P3 | **−3,04 MB e −2,7 s em 4G** por primeira abertura | **PP** (configuração) | Muito baixo |
| **2** | **D1** — pedágio: 3 consultas → 1 | era P4 | **−247 ms por requisição** · −3,5 s no `/panorama` · −1,7 s numa tela mediana | M | Médio (ACL) |
| **3** | **A1+A2** — o esqueleto para de ser mudo | era P1 | não muda milissegundo; muda "travou" para "está trabalhando" | P | Baixo |
| **4** | **C1** — `staleTime` por família | era P2 | revisita de **~6 s → ~0** no ar | M | Médio |
| **5** | **D3+D4** — round trips das rotas caras | era P4 | `/dre/fleet` 48 → ~14 consultas = **−4,2 s** | M | Médio |
| **6** | **E1b** — `max-age` nos assets | novo | −56 ms × nº de assets na abertura repetida | **PP** | Muito baixo |
| **7** | **E2** — code splitting | era P3 | −0,6 s em 4G **depois** de E1 (antes de E1 valeria mais) | M | Baixo |
| **8** | **B1+B2** — timeout e tentativas por classe | era P5 | pior caso 238 s → ~73 s | P | Médio |
| **9** | **A3+A4** — estados e conteúdo preservado | era P1 | qualidade da espera | M | Baixo |
| **10** | **D2** — a consulta de 592 ms | era P4 | **−0,5 s numa tela só** — e no ar ela é 0,5 s de 7,3 s | P | Baixo |

### O que mudou de posição, e por quê

**E1 subiu de 3º para 1º.** É configuração, não código; o ganho é certo, medido
em bytes idênticos; e é o único item com esforço quase zero e risco quase zero.

**D1 subiu de 4º para 2º.** A árvore de decisão do `FASE-0.md` §3 dizia: *"RTT
acima de 10 ms → D1 sobe para o primeiro lugar do backend"*. O RTT medido é
**123 ms**, doze vezes o limiar. As três consultas de pedágio custam 370 ms em
**toda** requisição autenticada — inclusive nas que não leem dado nenhum.

**A1/A2 desceu de 1º para 3º, e isso merece explicação.** Eu os pus em primeiro
no plano anterior argumentando que "uma consulta de 592→63 ms não tira ninguém
da sensação de travado; um aviso aos 3 s, sim". O argumento continua válido — e
por isso eles seguem **antes** do cache e do resto. O que mudou é que existem
agora dois itens que **cortam segundos de verdade** com esforço menor, e avisar
que se está esperando 7 segundos é pior do que esperar 2 e não precisar de aviso.

**D2 caiu para 10º.** Localmente era o achado de banco mais brilhante: 592 → 63 ms,
9,4×. No ar, essa consulta é meio segundo dentro de uma tela de 7,3 s. O ganho é
real e a correção continua barata e provada — mas é o último lugar onde eu
mexeria agora. **É o melhor exemplo de por que a Fase 0 existia.**

### O que a Fase 0 mudaria se eu tivesse implementado sem ela

Eu teria começado por `staleTime` e code splitting, que eram 1º e 2º no
diagnóstico local. Os dois continuam certos e continuam no plano — mas nenhum
deles toca os 370 ms de pedágio por requisição nem os 3 MB sem comprimir, que
juntos respondem pela maior parte do que o usuário espera hoje.

---

## 7. Gate da Fase 1 — o que peço para aprovar

Proponho começar pelos **dois primeiros**, que são os de maior ganho e menor
risco, e parar para conferir antes de seguir.

### Fase 1a — compressão e cache no host (E1 + E1b)

- **O que muda:** configuração de entrega estática. Nenhuma linha de `artifacts/`
  ou `lib/`.
- **Ganho esperado:** −3,04 MB por primeira abertura; −2,7 s em 4G; −15,1 s em 3G.
- **Como valido:** `entrega-estatica.sh` na mesma URL — `content-encoding`
  presente, fator ≥ 3×, `max-age` nos `/assets/*`.
- **Rollback:** reverter a configuração.
- **Risco:** muito baixo. O `vary: accept-encoding` precisa acompanhar, senão um
  intermediário pode servir conteúdo comprimido a quem não pediu.

### Fase 1b — o pedágio (D1)

- **O que muda:** `escopoEmObservacao` deixa de recalcular `escopoEfetivo` a cada
  requisição (memória por sessão, invalidada em mudança de ACL); e
  `/api/auth/session` para de ler a sessão duas vezes.
- **Ganho esperado:** 3 → 1 consulta de pedágio = **−247 ms por requisição**;
  −3,5 s no `/panorama`; −1,7 s numa tela mediana.
- **Como valido:** o próprio `pedagio-e-latencia.mjs` — o pedágio medido tem de
  cair de 370 ms para ~123 ms. É a mesma medição que produziu este relatório.
- **Rollback:** uma flag desliga a memória e volta ao cálculo por requisição.
- **Risco:** **médio, e é de segurança.** Memória de ACL que não invalida é
  permissão revogada que continua valendo. O teste de aceite é explícito:
  revogar acesso e conferir que a requisição seguinte já recusa.

### O que eu **não** faria agora

Nada de C1 (`staleTime`) antes de C4 (chave canônica por unidade e competência):
aumentar a vida do cache antes de garantir o isolamento é trocar lentidão por
vazamento entre unidades. Essa ordem está no plano e eu não pretendo inverter.

### Uma medição que ainda quero antes de 1b

Contar as consultas de verdade no ambiente publicado, em vez de estimá-las pelo
modelo. O modelo erra ~5% e basta para priorizar, mas para **provar** que D1
entregou o que prometeu é melhor ter a contagem. Se você puder ligar
`pg_stat_statements` no Neon — que é leitura, não mudança de produto —, eu fecho
essa lacuna. Se não der, sigo com o modelo e digo isso em toda medição.

---

**Aguardo sua aprovação para a Fase 1a e 1b.** Nenhuma fase foi implementada.
