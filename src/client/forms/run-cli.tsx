import { useAtom } from "@effect/atom-react";
import { Exit, Match, Option } from "effect";
import { useForm } from "react-hook-form";
import type { CustomCat } from "../../shared/generated/generated.ts";
import { customCat } from "../data-access/data-access.ts";
import { Outcome, setIssues, TextField, useSchemaResolver } from "./shared.tsx";

export function RunCliForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof CustomCat.Request;
}) {
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: useSchemaResolver(schema),
		defaultValues: { inputFile: "", outputFile: "" },
	});
	const [result, run] = useAtom(customCat, { mode: "promiseExit" });

	const submit = handleSubmit(async (payload) => {
		const failure = Exit.findErrorOption(await run({ payload }));
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
					label="input file"
					field={register("inputFile")}
					error={errors.inputFile}
				/>
				<TextField
					label="output file"
					field={register("outputFile")}
					error={errors.outputFile}
				/>
				<button type="submit" disabled={isSubmitting}>
					Copy
				</button>
			</form>
			<Outcome result={result}>
				{({ bytesCopied }) => <p>Copied {bytesCopied} bytes.</p>}
			</Outcome>
		</section>
	);
}
