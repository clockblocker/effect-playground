import { useAtom } from "@effect/atom-react";
import { useForm } from "react-hook-form";
import type { SearchFile } from "../../shared/generated/generated.ts";
import { searchFile } from "../data-access/data-access.ts";
import { Outcome } from "./shared/components/outcome.tsx";
import { TextField } from "./shared/components/text-field.tsx";
import { issuesOf, setIssues, useSchemaResolver } from "./shared/helpers.ts";

export function SearchForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof SearchFile.Request;
}) {
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: useSchemaResolver(schema),
		defaultValues: { name: "hello.txt", query: "" },
	});
	const [result, search] = useAtom(searchFile, { mode: "promiseExit" });

	const submit = handleSubmit(async (payload) => {
		setIssues(issuesOf(await search({ payload })), setError);
	});

	return (
		<section className="panel">
			<form onSubmit={submit}>
				<TextField
					label="file to search"
					field={register("name")}
					error={errors.name}
				/>
				<TextField
					label="text to find"
					field={register("query")}
					error={errors.query}
				/>
				<button type="submit" disabled={isSubmitting}>
					Search
				</button>
			</form>
			<Outcome result={result}>
				{({ matches }) =>
					matches.length === 0 ? (
						<p>No line matches.</p>
					) : (
						<ol>
							{matches.map(({ line, text }) => (
								<li key={line} value={line}>
									<code>{text}</code>
								</li>
							))}
						</ol>
					)
				}
			</Outcome>
		</section>
	);
}
