import { useAtom } from "@effect/atom-react";
import { Exit, Match, Option } from "effect";
import { useForm } from "react-hook-form";
import type { CustomWc } from "../../shared/generated/generated.ts";
import { customWc } from "../data-access/data-access.ts";
import { Outcome, setIssues, TextField, useSchemaResolver } from "./shared.tsx";

export function CountForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof CustomWc.Request;
}) {
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: useSchemaResolver(schema),
		defaultValues: { file: "hello.txt" },
	});
	const [result, count] = useAtom(customWc, { mode: "promiseExit" });

	const submit = handleSubmit(async (payload) => {
		const failure = Exit.findErrorOption(await count({ payload }));
		if (Option.isSome(failure)) {
			Match.valueTags(failure.value, {
				InvalidRequest: ({ issues }) => setIssues(issues, setError),
				// Outcome shows these.
				IoFailed: () => undefined,
				CliFailed: () => undefined,
				RpcClientError: () => undefined,
			});
		}
	});

	return (
		<section className="panel">
			<form onSubmit={submit}>
				<TextField
					label="file to count"
					field={register("file")}
					error={errors.file}
				/>
				<button type="submit" disabled={isSubmitting}>
					Count
				</button>
			</form>
			<Outcome result={result}>
				{({ lines, words, bytes }) => (
					<p>
						{lines} lines, {words} words, {bytes} bytes.
					</p>
				)}
			</Outcome>
		</section>
	);
}
