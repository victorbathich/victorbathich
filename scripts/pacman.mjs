// Gera o Pac-Man do perfil (versões clara e escura) com um tema de praia.
//
// Usa a biblioteca pacman-contribution-graph diretamente, sem a action oficial,
// porque a action envia o usuário e a pontuação do jogo para um servidor externo.
// Com token, a biblioteca só consulta a API do GitHub.
//
// Variáveis de ambiente: GH_USER, GH_TOKEN e OUT_DIR (padrão: dist).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArcadeRenderer } from "pacman-contribution-graph";

// Cor original do tema da biblioteca -> cor da praia.
const THEMES = {
  light: {
    base: "github",
    colors: {
      "#ffffff": "#fff8ec", // fundo: areia clara
      "#57606a": "#8c6e4a", // nomes dos meses
      "#000000": "#d1603d", // paredes: coral
      "#ebedf0": "#f2e3c6", // dia sem contribuição: areia
      "#9be9a8": "#56bfba", // contribuições: do raso...
      "#40c463": "#2a9fab",
      "#30a14e": "#167c96",
      "#216e39": "#0b566f", // ...ao mar fundo
    },
  },
  dark: {
    base: "github-dark",
    colors: {
      "#0d1117": "#0a1c2b", // fundo: mar à noite
      "#8b949e": "#c9b48a", // nomes dos meses
      "#ffffff": "#f4d19b", // paredes: areia
      "#161b22": "#132c3b", // dia sem contribuição
      "#0e4429": "#156b78", // contribuições: do mar fundo...
      "#006d32": "#1c9593",
      "#26a641": "#2ec4b6",
      "#39d353": "#9bf6e8", // ...à espuma turquesa
    },
  },
};

function render(gameTheme, username, token) {
  return new Promise((resolve, reject) => {
    let svg = "";
    const renderer = new ArcadeRenderer({
      game: "pacman",
      platform: "github",
      username,
      gameTheme,
      playerStyle: "opportunistic",
      showMonthLabels: true,
      githubSettings: { accessToken: token },
      svgCallback: (s) => { svg = s; },
      gameOverCallback: () => resolve(svg),
      pointsIncreasedCallback: () => {},
    });
    renderer.start().catch(reject);
  });
}

// Troca todas as cores de uma vez, para uma troca não afetar a seguinte.
function recolor(svg, colors) {
  let replaced = 0;
  const out = svg.replace(/#[0-9a-f]{6}\b/gi, (hex) => {
    const to = colors[hex.toLowerCase()];
    if (!to) return hex;
    replaced++;
    return to;
  });
  return { out, replaced };
}

async function main() {
  const username = process.env.GH_USER;
  const token = process.env.GH_TOKEN;
  const outDir = process.env.OUT_DIR || "dist";
  if (!username || !token) throw new Error("defina GH_USER e GH_TOKEN");

  await mkdir(outDir, { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    const svg = await render(theme.base, username, token);
    if (!svg.startsWith("<svg")) throw new Error(`SVG ${name} vazio ou inválido`);
    const { out, replaced } = recolor(svg, theme.colors);
    if (!replaced) throw new Error(`nenhuma cor do tema ${theme.base} encontrada no SVG ${name}`);
    const file = join(outDir, `pacman-${name}.svg`);
    await writeFile(file, out);
    console.log(`${file}: ${replaced} cores trocadas`);
  }
}

main().catch((err) => {
  console.error(`Falha ao gerar o Pac-Man: ${err.message}`);
  process.exit(1);
});
