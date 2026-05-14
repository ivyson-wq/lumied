const esbuild = require('esbuild');
const path = require('path');

const entryPoints = [
  'src/portals/gerente/index.js',
  'src/portals/pais/index.js',
  'src/portals/professora/index.js',
  'src/portals/secretaria/index.js',
  'src/portals/admin/index.js',
  'src/portals/admin-central/index.js',
  'src/portals/aluno/index.js',
];

async function build() {
  const startTime = Date.now();

  await esbuild.build({
    entryPoints,
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ['es2020'],
    format: 'iife',
    outdir: 'dist',
    entryNames: '[dir]/[name]',
    splitting: false,
    metafile: true,
    banner: { js: '/* Lumied v2.0 — bundled with esbuild */' },
  }).then(result => {
    const duration = Date.now() - startTime;
    console.log(`✓ Build completed in ${duration}ms`);

    // Print bundle sizes
    for (const [file, info] of Object.entries(result.metafile.outputs)) {
      const size = (info.bytes / 1024).toFixed(1);
      console.log(`  ${file}: ${size}KB`);
    }
  });
}

build().catch(e => { console.error('Build failed:', e); process.exit(1); });
