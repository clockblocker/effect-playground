import { AsyncResult } from "effect/reactivity";
import { RpcClientError } from "effect/rpc";
import type { ReactNode } from "react";
import { isInvalidRequest } from "../../../../shared/helpers/procedure.ts";

interface Failure {
	readonly _tag: string;
	readonly message: string;
}

export function Outcome<A>({
	result,
	children,
}: {
	result: AsyncResult.AsyncResult<A, Failure>;
	children: (value: A) => ReactNode;
}) {
	return (
		AsyncResult.builder(AsyncResult.map(result, children))
			.onInitial(() => null)
			.onSuccess((node) => node)
			.onWaiting(() => null)
			.onError(failureOf)
			// Before onInterrupt: a defect beside an interruption still shows.
			.onDefect(() => <Alert>Something went wrong.</Alert>)
			.onInterrupt(() => null)
			.exhaustive()
	);
}

function failureOf(error: Failure): ReactNode {
	if (isInvalidRequest(error)) return null;
	if (error instanceof RpcClientError.RpcClientError) {
		return <Alert>{`Request failed: ${transportMessage(error)}`}</Alert>;
	}
	return <Alert>{error.message}</Alert>;
}

function Alert({ children }: { children: ReactNode }) {
	return <p role="alert">{children}</p>;
}

function transportMessage({ reason }: RpcClientError.RpcClientError): string {
	if (reason._tag !== "HttpError") return reason.message;
	const { cause } = reason;
	return cause instanceof Error && cause.message !== ""
		? cause.message
		: reason.kind;
}
