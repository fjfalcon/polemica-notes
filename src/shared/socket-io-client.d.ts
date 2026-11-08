declare module "socket.io-client" {
  import type { SearchSocket } from "../content/page/direct-search";
  export default function io(url: string, options: {
    transports: string[]; forceNew: boolean; reconnection: boolean;
    query: { userId: number; authKey: string; intention: string };
  }): SearchSocket;
}
