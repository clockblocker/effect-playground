import { useAtom } from "@effect/atom-react";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Match, Schema } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { useId, useMemo } from "react";
import { useForm } from "react-hook-form";
import type { ReadFile } from "../../shared/generated/protocol.ts";
import { BffRpcClient } from "../clients.ts";

const readFile = BffRpcClient.mutation("ReadFile");

type ReadFailure = Atom.Failure<typeof readFile>;

/**
 * What the page says when a call fails. The domain errors say it themselves;
 * the transport error is the client's own, so its wording lives here.
 */
const describeFailure = Match.type<ReadFailure>().pipe(
	Match.tag("RpcClientError", (error) => `Request failed: ${error.message}`),
	Match.orElse((error) => error.message),
);

export function ReadFileForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof ReadFile.Request;
}) {
	// The types come from the schema, spelled out because inference through
	// toStandardSchemaV1's intersection type yields `FieldValues` and `unknown`.
	const resolver = useMemo(
		() =>
			standardSchemaResolver<
				(typeof schema)["Encoded"],
				unknown,
				(typeof schema)["Type"]
			>(Schema.toStandardSchemaV1(schema)),
		[schema],
	);
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm({ resolver, defaultValues: { name: "hello.txt" } });

	const [result, read] = useAtom(readFile, { mode: "promiseExit" });
	const nameError = useId();

	// Runs only once the values pass the schema, so a bad name sends nothing.
	const submit = handleSubmit(async (payload) => {
		await read({ payload });
	});

	return (
		<section className="panel">
			<form onSubmit={submit}>
				<input
					aria-label="File name"
					aria-invalid={errors.name !== undefined}
					aria-describedby={errors.name && nameError}
					{...register("name")}
				/>
				<button type="submit" disabled={isSubmitting}>
					Submit
				</button>
				{errors.name && (
					<p id={nameError} className="field-error">
						{errors.name.message}
					</p>
				)}
			</form>
			{AsyncResult.matchWithError(result, {
				onInitial: () => null,
				onSuccess: ({ value }) => <pre>{value.contents}</pre>,
				onError: (error) => (
					<p role="alert">{describeFailure(error)}</p>
				),
				// No typed error in the cause: a defect or an interruption.
				onDefect: () => <p role="alert">Something went wrong.</p>,
			})}
		</section>
	);
}
