import { useAtom } from "@effect/atom-react";
import { useForm } from "react-hook-form";
import type { CustomWc } from "../../shared/generated/generated.ts";
import { customWc } from "../data-access/data-access.ts";
import { Outcome } from "./shared/components/outcome.tsx";
import { TextField } from "./shared/components/text-field.tsx";
import { issuesOf, setIssues, useSchemaResolver } from "./shared/helpers.ts";

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
		setIssues(issuesOf(await count({ payload })), setError);
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
