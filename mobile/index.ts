import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// On the web, Skia runs on CanvasKit (WebAssembly), which has to load before any module that
// imports Skia is evaluated. Native needs none of this. The wasm comes from a CDN pinned to the
// version React Native Skia depends on, so nothing has to be copied into the repository.
if (Platform.OS === 'web') {
  const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  const { version } = require('canvaskit-wasm/package.json');
  LoadSkiaWeb({ locateFile: (file: string) => 'https://cdn.jsdelivr.net/npm/canvaskit-wasm@' + version + '/bin/full/' + file }).then(() => {
    registerRootComponent(require('./App').default);
  });
} else {
  registerRootComponent(require('./App').default);
}
