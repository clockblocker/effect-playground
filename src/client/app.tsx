import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { type Effect, Schema } from "effect";
import { useId, useMemo, useState } from "react";
import { type UseFormRegisterReturn, useForm } from "react-hook-form";
import { ReadFileRequest } from "../shared/generated/reader-protocol.ts";
import { Reader } from "../shared/reader.ts";
import type { RestFiles, RpcFilesClient } from "./clients.ts";
import { runtime } from "./clients.ts";
import { type Outcome, readerLabels, rest, rpc } from "./read-file.ts";

// What a panel's form holds: the generated request, so the 5–25 rule and its
// messages come from the C++ struct, plus which reader to send it to.
const ReadFileForm = Schema.Struct({
	...ReadFileRequest.fields,
	reader: Reader,
});
type ReadFileForm = typeof ReadFileForm;

export function App() {
	return (
		<main className="panels">
			<ReaderPanel title="REST" schema={ReadFileForm} readers={rest} />
			<ReaderPanel title="RPC" schema={ReadFileForm} readers={rpc} />
		</main>
	);
}

function ReaderPanel({
	title,
	schema,
	readers,
}: {
	title: string;
	/** Validates the form; its type is the form's values. */
	schema: ReadFileForm;
	// One function per reader; the switch picks which one a submit calls.
	readers: Record<
		Reader,
		(
			name: string,
		) => Effect.Effect<Outcome, never, RestFiles | RpcFilesClient>
	>;
}) {
	// The types come from the schema, spelled out because inference through
	// toStandardSchemaV1's intersection type yields `FieldValues` and `unknown`.
	const resolver = useMemo(
		() =>
			standardSchemaResolver<
				ReadFileForm["Encoded"],
				unknown,
				ReadFileForm["Type"]
			>(Schema.toStandardSchemaV1(schema)),
		[schema],
	);
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver,
		defaultValues: {
			name: "hello.txt",
			reader: "bun",
		} satisfies ReadFileForm["Encoded"],
	});
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const nameError = useId();

	// Runs only once the values pass the schema, so a bad name sends nothing.
	const submit = handleSubmit(async (values) => {
		// The error channel is `never`, so this promise only rejects on a defect.
		setOutcome(
			await runtime.runPromise(readers[values.reader](values.name)),
		);
	});

	return (
		<section className="panel">
			<h2>{title}</h2>
			<form onSubmit={submit}>
				<input
					aria-label="File name"
					aria-invalid={errors.name !== undefined}
					aria-describedby={errors.name && nameError}
					{...register("name")}
				/>
				<ReaderSwitch field={register("reader")} />
				<button type="submit" disabled={isSubmitting}>
					Submit
				</button>
				{errors.name && (
					<p id={nameError} className="field-error">
						{errors.name.message}
					</p>
				)}
			</form>
			{outcome?.kind === "contents" && <pre>{outcome.text}</pre>}
			{outcome?.kind === "error" && <p role="alert">{outcome.message}</p>}
		</section>
	);
}

const readerOrder: readonly Reader[] = ["bun", "cpp"];

function ReaderSwitch({ field }: { field: UseFormRegisterReturn<"reader"> }) {
	// Radios group by form and name, so each panel's "reader" is its own group.
	return (
		<fieldset className="reader-switch">
			<legend className="visually-hidden">Reader</legend>
			{readerOrder.map((reader) => (
				<label key={reader}>
					<input type="radio" value={reader} {...field} />
					{readerLabels[reader]}
				</label>
			))}
		</fieldset>
	);
}
