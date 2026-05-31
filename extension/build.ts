import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [
    'src/background/index.ts',
    'src/content/index.ts',
    'src/popup/index.ts',
    'src/options/index.ts',
  ],
  bundle: true,
  outdir: 'dist',
  format: 'esm' as const,
  sourcemap: true,
  target: 'chrome120',
  minify: !isWatch,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete');
}
