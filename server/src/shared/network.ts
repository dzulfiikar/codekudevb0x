import { Socket } from "node:net";

export function isTcpPortOpen(ip: string, port: number, timeoutMilliseconds = 3000) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    const finish = (isOpen: boolean) => {
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(timeoutMilliseconds);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}
