import { useAtom } from "@effect/atom-react";
import { Exit, Match, Option } from "effect";
import { useForm } from "react-hook-form";
import type { ReadFile } from "../../shared/generated/generated.ts";
import { readFile } from "../clients.ts";
import { Outcome, setIssues, TextField, useSchemaResolver } from "./shared.tsx";

export function ReadFileForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof ReadFile.Request;
}) {
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: useSchemaResolver(schema),
		defaultValues: { name: "hello.txt" },
	});
	const [result, read] = useAtom(readFile, { mode: "promiseExit" });

	// Runs only once the values pass the schema, so a bad name sends nothing.
	const submit = handleSubmit(async (payload) => {
		const failure = Exit.findErrorOption(await read({ payload }));
		if (Option.isSome(failure)) {
			Match.valueTags(failure.value, {
				InvalidRequest: ({ issues }) => setIssues(issues, setError),
				// Outcome shows these.
				IoFailed: () => undefined,
				RpcClientError: () => undefined,
			});
		}
	});

	return (
		<section className="panel">
			<form onSubmit={submit}>
				<TextField
					label="file name"
					field={register("name")}
					error={errors.name}
				/>
				<button type="submit" disabled={isSubmitting}>
					Submit
				</button>
			</form>
			<Outcome result={result}>
				{({ contents }) => <pre>{contents}</pre>}
			</Outcome>
		</section>
	);
}
