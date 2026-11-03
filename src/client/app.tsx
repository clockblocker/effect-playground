import { useAtom } from "@effect/atom-react";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useId, useMemo } from "react";
import { useForm } from "react-hook-form";
import { ReadFile } from "../shared/generated/protocol.ts";
import { describeFailure, readFile } from "./read-file.ts";

// The generated request, so the 5–25 rule and its messages come from the C++
// struct.
const ReadFileForm = ReadFile.Request;
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
		} satisfies ReadFileForm["Encoded"],
	});

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
