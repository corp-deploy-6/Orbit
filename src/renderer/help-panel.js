// Help view: static "what is this app" content, styled to match the
// Settings panel (same container/heading/hint classes, no new CSS).

const SECTIONS = [
  {
    heading: 'About Orbit',
    body: [
      'Orbit is a personal agentic OS: an Electron desktop app that gives a terminal workspace a DOS / Norton Commander look and feel, with an AI agent woven into the workflow rather than bolted on as a separate window.',
    ],
  },
  {
    heading: 'The Session screen',
    body: [
      'Sessions are a tiled terminal grid, up to four terminals at once arranged as a 2x2 quadrant layout, or as a single split layout — pick either from Settings.',
      'F2 adds a new session tile; F8 closes whichever tile is focused. F1 and F11 switch between the Session and Settings views.',
    ],
  },
  {
    heading: 'graft',
    body: [
      'graft is a prebuilt knowledge graph of this repository: small indexed nodes that explain each part of the code in prose plus a call graph of who calls what. Orbit’s agent queries it to answer questions about the codebase and to scope edits, instead of re-reading source files from scratch every time.',
      'The moving graph behind every screen (the Graph Backdrop) renders that same graph in 3D. Its opacity is adjustable from Settings, and it can be reloaded manually from there too.',
    ],
  },
  {
    heading: 'The developer',
    body: [
      'Orbit is a hobby project, built and maintained by a single developer as a personal tool rather than a commercial product.',
    ],
  },
];

export function renderHelpPanel(container) {
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'settings-panel-inner';

  for (const section of SECTIONS) {
    const heading = document.createElement('h2');
    heading.className = 'settings-heading';
    heading.textContent = section.heading;
    panel.appendChild(heading);

    for (const paragraph of section.body) {
      const p = document.createElement('p');
      p.className = 'settings-hint';
      p.textContent = paragraph;
      panel.appendChild(p);
    }
  }

  container.appendChild(panel);
}
