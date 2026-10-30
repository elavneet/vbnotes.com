import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Keeps one invisible WebView alive so iOS/Android start the web content
 * process at launch. Without it the first note took ~1.4 s to appear instead
 * of ~0.4 s, because the process spun up only when the editor opened.
 */
export function WebViewWarmup() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOn(true), 400);
    return () => clearTimeout(id);
  }, []);
  if (!on) return null;
  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView source={{ html: '<html><body></body></html>' }} style={styles.hidden} />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
