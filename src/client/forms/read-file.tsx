import { useAtom } from "@effect/atom-react";
import { useForm } from "react-hook-form";
import type { ReadFile } from "../../shared/generated/protocol.ts";
import { BffRpcClient } from "../clients.ts";
import {
	Outcome,
	setFailure,
	TextField,
	useSchemaResolver,
} from "./shared.tsx";

const readFile = BffRpcClient.mutation("ReadFile");

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
		setFailure(await read({ payload }), setError);
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
			<Outcome result={result} error={errors.root?.server}>
				{({ contents }) => <pre>{contents}</pre>}
			</Outcome>
		</section>
	);
}
