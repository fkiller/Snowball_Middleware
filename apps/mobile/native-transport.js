import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { createPinnedSessionReader } from './pinned-remote.mjs';

export const developmentReader = createPinnedSessionReader(requireOptionalNativeModule('SnowballGatewayTransport'), {
  development: __DEV__, platform: Platform.OS,
});
