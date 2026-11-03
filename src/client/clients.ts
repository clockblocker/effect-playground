import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomRpc } from "effect/reactivity";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { BffRpcs } from "../shared/rpc.ts";

// The page talks to the BFF over RPC only; the BFF's REST API is for other
// clients. Vite proxies /rpc to the BFF, so the page uses its own origin.
const origin = window.location.origin;

// The RPC client as atoms, derived from the contract:
// BffRpcClient.mutation("ReadFileBff") and BffRpcClient.mutation("ReadFileBackend").
// Its runtime is an atom too, so the protocol is built once per registry, when
// the page mounts a mutation, and kept while one stays mounted.
export class BffRpcClient extends AtomRpc.Service<BffRpcClient>()(
	"effect-playground/BffRpcClient",
	{
		group: BffRpcs,
		protocol: RpcClient.layerProtocolHttp({ url: `${origin}/rpc` }).pipe(
			Layer.provide(RpcSerialization.layerJson),
			Layer.provide(FetchHttpClient.layer),
		),
	},
) {}
