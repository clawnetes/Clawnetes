export const REMOTE_TUNNEL_ACCESS_PORT = 28789;

export function resolveGatewayAccessPort(targetEnvironment: string, gatewayPort: number) {
  return targetEnvironment === "cloud" ? REMOTE_TUNNEL_ACCESS_PORT : gatewayPort;
}
