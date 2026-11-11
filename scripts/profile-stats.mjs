#!/usr/bin/env node
// Gera os cards de estatísticas do perfil (stats.svg e languages.svg).
// Roda no workflow .github/workflows/stats.yml, sem dependências externas.
//
// Variáveis de ambiente:
//   GH_TOKEN     token para a API GraphQL do GitHub (obrigatório)
//   GH_USER      usuário a consultar (obrigatório)
//   TOKEN_SCOPE  "personal" quando GH_TOKEN é um token pessoal (inclui privados) ou "public"
//   OUT_DIR      pasta de saída (padrão: dist)
//
// Pré-visualização local, sem API: node scripts/profile-stats.mjs --mock dados.json
// (mesmo formato do objeto retornado por loadFromApi).
//
// Os logs de Actions em repositório público são públicos: este script só imprime
// totais agregados, nunca nomes de repositórios.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = process.env.OUT_DIR || "dist";
const TOP_LANGUAGES = 4;

// Paleta validada contra o fundo #0D1117 (ordem fixa; ver docs do dataviz).
const SLOTS = ["#2EA043", "#4493F8", "#9E6A03", "#8957E5"];
const OTHER_COLOR = "#6E7681";
// Cada linguagem conhecida mantém sempre a mesma cor, mesmo mudando de posição.
const PREFERRED_SLOT = { TypeScript: 1, JavaScript: 2, CSS: 3, HTML: 0, PLpgSQL: 0 };

const C = {
  bg: "#0D1117",
  border: "#30363D",
  text: "#E6EDF3",
  muted: "#9DA7B3",
  green: "#3FB950",
  blue: "#58A6FF",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const W = 400;
const H = 190;

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---------------------------------------------------------------- dados

async function graphql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-script",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API respondeu ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  return json.data;
}

const CONTRIBUTIONS_QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      contributionCalendar { totalContributions }
    }
  }
}`;

const REPOSITORIES_QUERY = `
query ($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        isPrivate
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

async function loadFromApi(token, login) {
  const c = await graphql(token, CONTRIBUTIONS_QUERY, { login });
  if (!c.user) throw new Error("usuário não encontrado");
  const cc = c.user.contributionsCollection;

  const repositories = [];
  let after = null;
  do {
    const page = (await graphql(token, REPOSITORIES_QUERY, { login, after })).user.repositories;
    for (const repo of page.nodes) {
      repositories.push({
        isPrivate: repo.isPrivate,
        languages: repo.languages.edges.map((e) => ({ name: e.node.name, size: e.size })),
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return {
    contributions: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    repositories,
  };
}

function summarizeLanguages(repositories) {
  const totals = new Map();
  for (const repo of repositories) {
    for (const { name, size } of repo.languages) totals.set(name, (totals.get(name) || 0) + size);
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!sum) return [];

  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_LANGUAGES);
  const rest = sorted.slice(TOP_LANGUAGES).reduce((a, [, size]) => a + size, 0);

  // Cores: primeiro as preferidas (se o slot estiver livre), depois o primeiro slot livre.
  const used = new Set();
  const colorOf = new Map();
  for (const [name] of top) {
    const slot = PREFERRED_SLOT[name];
    if (slot !== undefined && !used.has(slot)) { used.add(slot); colorOf.set(name, SLOTS[slot]); }
  }
  for (const [name] of top) {
    if (colorOf.has(name)) continue;
    const slot = SLOTS.findIndex((_, i) => !used.has(i));
    used.add(slot);
    colorOf.set(name, SLOTS[slot]);
  }

  const items = top.map(([name, size]) => ({ name, share: size / sum, color: colorOf.get(name) }));
  if (rest > 0) items.push({ name: "Outras", share: rest / sum, color: OTHER_COLOR });
  return items;
}

// ---------------------------------------------------------------- SVG

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function card({ title, subtitle, body, footnote, label }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <title>${esc(label)}</title>
  <style>
    text { font-family: ${FONT}; }
    .title { fill: ${C.text}; font-size: 15px; font-weight: 600; }
    .sub { fill: ${C.muted}; font-size: 12px; }
    .value { fill: ${C.text}; font-size: 24px; font-weight: 600; }
    .label { fill: ${C.muted}; font-size: 12px; }
    .name { fill: ${C.text}; font-size: 13px; }
    .pct { fill: ${C.muted}; font-size: 13px; }
    .note { fill: ${C.muted}; font-size: 11px; }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <text class="title" x="24" y="36">${esc(title)}</text>
  <text class="sub" x="${W - 24}" y="36" text-anchor="end">${esc(subtitle)}</text>
${body}
  <text class="note" x="24" y="${H - 18}">${esc(footnote)}</text>
</svg>
`;
}

function statsCard(data, scope) {
  const metrics = [
    ["Contribuições", data.contributions, C.green],
    ["Commits", data.commits, C.blue],
    ["Pull requests", data.pullRequests, C.blue],
    ["Repositórios próprios", data.repositories.length, C.green],
  ];
  const body = metrics
    .map(([label, value, color], i) => {
      const x = 24 + (i % 2) * 186;
      const y = 62 + Math.floor(i / 2) * 50;
      return `  <g>
    <rect x="${x}" y="${y}" width="3" height="38" rx="1.5" fill="${color}"/>
    <text class="value" x="${x + 14}" y="${y + 21}">${nf.format(value)}</text>
    <text class="label" x="${x + 14}" y="${y + 37}">${esc(label)}</text>
  </g>`;
    })
    .join("\n");
  const footnote = scope === "personal" ? "Inclui atividade em repositórios privados" : "Somente dados públicos do perfil";
  const label = `Atividade no GitHub nos últimos 12 meses: ${metrics.map(([l, v]) => `${l} ${nf.format(v)}`).join(", ")}.`;
  return card({ title: "Atividade no GitHub", subtitle: "últimos 12 meses", body, footnote, label });
}

function languagesCard(items, scope) {
  const footnote = scope === "personal" ? "Por volume de código · inclui repositórios privados" : "Por volume de código · somente repositórios públicos";
  if (!items.length) {
    const body = `  <text class="sub" x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle">Ainda sem dados de linguagens</text>`;
    return card({ title: "Linguagens mais usadas", subtitle: "repositórios próprios", body, footnote, label: "Linguagens mais usadas: ainda sem dados." });
  }

  // Barra empilhada com 2px de respiro entre segmentos e pontas arredondadas.
  const barX = 24;
  const barW = W - 48;
  const gap = 2;
  const usable = barW - gap * (items.length - 1);
  let x = barX;
  const segments = items
    .map((it) => {
      const w = Math.max(usable * it.share, 2);
      const seg = `    <rect x="${x.toFixed(2)}" y="58" width="${w.toFixed(2)}" height="10" fill="${it.color}"/>`;
      x += w + gap;
      return seg;
    })
    .join("\n");

  const legend = items
    .map((it, i) => {
      const col = i % 2;
      const lx = 24 + col * 186;
      const ly = 98 + Math.floor(i / 2) * 26;
      const right = lx + 166;
      return `  <g>
    <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${it.color}"/>
    <text class="name" x="${lx + 18}" y="${ly}">${esc(it.name)}</text>
    <text class="pct" x="${right}" y="${ly}" text-anchor="end">${pf.format(it.share * 100)}%</text>
  </g>`;
    })
    .join("\n");

  const body = `  <defs><clipPath id="bar"><rect x="${barX}" y="58" width="${barW}" height="10" rx="5"/></clipPath></defs>
  <g clip-path="url(#bar)">
${segments}
  </g>
${legend}`;
  const label = `Linguagens mais usadas: ${items.map((it) => `${it.name} ${pf.format(it.share * 100)}%`).join(", ")}.`;
  return card({ title: "Linguagens mais usadas", subtitle: "repositórios próprios", body, footnote, label });
}

// ---------------------------------------------------------------- main

async function main() {
  const mockIndex = process.argv.indexOf("--mock");
  let data;
  let scope = process.env.TOKEN_SCOPE === "personal" ? "personal" : "public";

  if (mockIndex !== -1) {
    data = JSON.parse(await readFile(process.argv[mockIndex + 1], "utf8"));
    scope = data.scope || scope;
  } else {
    const token = process.env.GH_TOKEN;
    const login = process.env.GH_USER;
    if (!token || !login) throw new Error("defina GH_TOKEN e GH_USER");
    data = await loadFromApi(token, login);
  }

  const languages = summarizeLanguages(data.repositories);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "stats.svg"), statsCard(data, scope));
  await writeFile(join(OUT_DIR, "languages.svg"), languagesCard(languages, scope));

  console.log(`Cards gerados em ${OUT_DIR}/ (escopo: ${scope}, repositórios: ${data.repositories.length}, linguagens: ${languages.length}).`);
}

main().catch((err) => {
  console.error(`Falha ao gerar os cards: ${err.message}`);
  process.exit(1);
});
