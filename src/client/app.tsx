import { useAtom } from "@effect/atom-react";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useId, useMemo, useState } from "react";
import { type UseFormRegisterReturn, useForm } from "react-hook-form";
import { ReadFile } from "../shared/generated/backend-protocol.ts";
import { Reader } from "../shared/reader.ts";
import { describeFailure, type ReadFailure, reads } from "./read-file.ts";

// What the form holds: the generated request, so the 5–25 rule and its
// messages come from the C++ struct, plus which reader to send it to.
const ReadFileForm = Schema.Struct({
	...ReadFile.Request.fields,
	reader: Reader,
});
type ReadFileForm = typeof ReadFileForm;

export function App() {
	return (
		<main className="panels">
			<ReaderPanel schema={ReadFileForm} />
		</main>
	);
}

function ReaderPanel({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: ReadFileForm;
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
			reader: "bff",
		} satisfies ReadFileForm["Encoded"],
	});
	// One mutation per reader; the switch picks which one a submit runs. In
	// promiseExit mode a run resolves with its Exit once the result settles,
	// failure or not, so isSubmitting covers the whole request.
	const [bff, readBff] = useAtom(reads.bff, { mode: "promiseExit" });
	const [backend, readBackend] = useAtom(reads.backend, {
		mode: "promiseExit",
	});
	const run = { bff: readBff, backend: readBackend };
	// The reader of the latest settled submit, so flipping the switch alone
	// doesn't change what's shown. Before the first submit both are Initial.
	const [shown, setShown] = useState<Reader>("bff");
	const result: AsyncResult.AsyncResult<ReadFile.Success, ReadFailure> =
		shown === "bff" ? bff : backend;
	const nameError = useId();

	// Runs only once the values pass the schema, so a bad name sends nothing.
	const submit = handleSubmit(async ({ reader, name }) => {
		await run[reader]({ payload: { name } });
		setShown(reader);
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
			{AsyncResult.matchWithError(result, {
				onInitial: () => null,
				// RPC answers with the success struct; the page shows its contents.
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

const readerOrder: readonly Reader[] = ["bff", "backend"];
const readerLabels: Record<Reader, string> = {
	bff: "BFF",
	backend: "Backend",
};

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
