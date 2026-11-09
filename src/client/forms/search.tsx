import { useAtom } from "@effect/atom-react";
import { Exit, Match, Option } from "effect";
import { useForm } from "react-hook-form";
import type { SearchFile } from "../../shared/generated/generated.ts";
import { searchFile } from "../clients.ts";
import { Outcome, setIssues, TextField, useSchemaResolver } from "./shared.tsx";

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
		const failure = Exit.findErrorOption(await search({ payload }));
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
