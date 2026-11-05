// Do not send credentials until the mobile app can verify the Snowball
// gateway's own identity through the entire connection. Tailscale HTTPS alone
// may terminate at Serve and cannot prove the backend process is the gateway.
// This is a build-time product gate, not a user-configurable safety override.
// The separately labelled iOS 18+ Debug experiment uses a native pinned reader;
// it does not open this production/Expo Go/Android bearer entry point.
export const VERIFIED_GATEWAY_CONNECTION_AVAILABLE = false;
