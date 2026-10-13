const { transformSync } = require('esbuild');

// Preserve classic-script global names: legacy HTML handlers and workspace
// declarations share a window namespace. No bundling or dead-code elimination.
function optimizeWebAsset(body, extension) {
  if (!['js', 'css'].includes(extension)) return String(body);
  return transformSync(String(body), {
    loader: extension, target: 'es2022', minifyWhitespace: true,
    minifySyntax: true, minifyIdentifiers: true, treeShaking: false,
    legalComments: 'none', charset: 'utf8',
  }).code;
}
module.exports = { optimizeWebAsset };
