import { BffRpcClient } from "./clients/bff-rpc-client.ts";

export const readFile = BffRpcClient.mutation("ReadFile");
export const searchFile = BffRpcClient.mutation("SearchFile");
export const customCat = BffRpcClient.mutation("CustomCat");
export const customWc = BffRpcClient.mutation("CustomWc");
