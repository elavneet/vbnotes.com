import { useWindowDimensions } from 'react-native';

/** Three-pane layout from 960px, permanent sidebar from 1180px. */
export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return { width, isWide: width >= 960, isDesktop: width >= 1180 };
}
