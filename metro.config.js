// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * Two packages bring far more into the app's bundle than it uses:
 * - lowlight's main file also loads all of highlight.js's 190 languages (about 1 MB); the app
 *   registers its own few (src/editor/highlight.ts), so it takes lowlight's core alone.
 * - tentap's own editor page (about 600 KB) is only a fallback; see src/editor/noTentapPage.ts.
 */
const LOWLIGHT_CORE = path.join(__dirname, 'node_modules/lowlight/lib/index.js');
const NO_TENTAP_PAGE = path.join(__dirname, 'src/editor/noTentapPage.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lowlight') return { type: 'sourceFile', filePath: LOWLIGHT_CORE };
  if (moduleName.endsWith('simpleWebEditor/build/editorHtml') && context.originModulePath.includes('@10play/tentap-editor')) {
    return { type: 'sourceFile', filePath: NO_TENTAP_PAGE };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
